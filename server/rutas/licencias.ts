/**
 * `/api/licencias`. Etapa 8b, D43.
 *
 * ============================================================================
 * LA KEY TIENE SU PROPIO ENDPOINT Y NO SALE POR NINGÚN OTRO.
 * ============================================================================
 *
 * Es un secreto del §5 con las mismas reglas que `bios_password`: el listado y
 * el detalle devuelven `tiene_key` —un booleano— y nunca el valor. Para leerla
 * hay que pedirla explícitamente, ser admin, y la lectura queda registrada.
 *
 * Ese endpoint está calcado del de BIOS a propósito, incluido el orden: la fila
 * de auditoría se escribe ANTES de responder, así que si el registro falla, la
 * respuesta no sale. Un secreto leído sin rastro es peor que un error.
 */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoAuditoria from '../../db/repositorios/auditoria.js';
import * as repoLicencias from '../../db/repositorios/licencias.js';
import { estadoLicencia } from '../../db/esquema.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp, noEncontrado } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

const esquemaFiltros = z.object({
  estado: z.enum(estadoLicencia.enumValues).optional(),
  equipo: uuid.optional(),
  sin_equipo: z.coerce.boolean().optional(),
  revision: z.coerce.boolean().optional(),
  q: z.string().trim().max(120).optional(),
  pagina: z.coerce.number().int().min(1).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
});

function validar<T>(esquema: z.ZodType<T>, entrada: unknown): T {
  const r = esquema.safeParse(entrada);
  if (!r.success) {
    throw new ErrorHttp(400, 'Entrada inválida', {
      campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })),
    });
  }
  return r.data;
}

export function registrarRutasLicencias(app: Express): void {
  ruta(
    app,
    'get',
    '/api/licencias',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const f = validar(esquemaFiltros, req.query);
      const [pagina, resumen] = await Promise.all([
        repoLicencias.listar(f),
        repoLicencias.resumen(),
      ]);
      // El resumen viaja con el listado para que la pantalla pueda enseñar
      // «12 sin equipo» sin una segunda petición: es el número que dice si hace
      // falta pedir los ficheros de otra sede.
      res.json({ ...pagina, resumen });
    }),
  );

  ruta(
    app,
    'get',
    '/api/licencias/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const licencia = await repoLicencias.porId(id);
      if (!licencia) throw noEncontrado('Licencia');
      res.json({ licencia });
    }),
  );

  /**
   * La key en claro. `admin`, de una en una, y con su fila en `auditoria`.
   *
   * El registro va ANTES del `res.json`: si falla, la respuesta no sale. Es el
   * mismo orden que `/api/equipos/:id/bios` y por el mismo motivo.
   */
  ruta(
    app,
    'get',
    '/api/licencias/:id/key',
    'admin',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const secreto = await repoLicencias.descifrarKey(id);
      if (!secreto) throw noEncontrado('Licencia');

      await repoAuditoria.registrar({
        tabla: 'licencias',
        registro_id: id,
        accion: 'descifrar_key_licencia',
        usuario_app_id: req.usuario?.id ?? null,
        ip: req.ip ?? null,
        // Se registra QUE se leyó, nunca el valor leído.
        despues: { campos: ['key'] },
      });

      res.json(secreto);
    }),
  );

  /**
   * Activar la licencia en un equipo, o soltarla.
   *
   * `equipo_id: null` la suelta. Es `admin` porque mover una licencia de un
   * equipo a otro es una decisión de inventario, no una consulta.
   */
  ruta(
    app,
    'post',
    '/api/licencias/:id/activar',
    'admin',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const datos = validar(z.object({ equipo_id: uuid.nullable() }), req.body);
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const licencia = await repoLicencias.activar(id, datos.equipo_id, {
          usuarioId,
          ip: req.ip ?? null,
        });
        res.json({ licencia });
      } catch (e) {
        if (e instanceof repoLicencias.LicenciaNoEncontrada) {
          throw noEncontrado('Licencia o equipo');
        }
        throw e;
      }
    }),
  );

  /** Cierra la marca de revisión, con su constancia. Como en `equipos`. */
  ruta(
    app,
    'post',
    '/api/licencias/:id/revisada',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const datos = validar(
        z.object({ nota: z.string().trim().min(1).max(500).nullable().optional() }),
        req.body,
      );
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const licencia = await repoLicencias.cerrarRevision(id, datos.nota ?? null, {
          usuarioId,
          ip: req.ip ?? null,
        });
        res.json({ licencia });
      } catch (e) {
        if (e instanceof repoLicencias.LicenciaNoEncontrada) throw noEncontrado('Licencia');
        throw e;
      }
    }),
  );
}
