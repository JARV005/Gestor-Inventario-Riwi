/**
 * `/api/actas`. Etapa 5a: el acta en la base. El PDF es 5b.
 *
 * El acta se emite **sobre movimientos que ya ocurrieron** — no al revés. El
 * cliente manda la persona y los equipos; el servidor busca el movimiento que
 * documenta cada uno y se niega si no existe.
 */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoActas from '../../db/repositorios/actas.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp, noEncontrado } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

const esquemaEmitir = z.object({
  tipo: z.enum(['Entrega', 'Devolución']),
  empleado_id: uuid,
  // Al menos uno: un acta sin equipos no documenta nada, y el tope evita que
  // una petición pida cinco mil bloqueos de fila en una sola transacción.
  equipos: z.array(uuid).min(1, { message: 'un acta necesita al menos un equipo' }).max(50),
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

export function registrarRutasActas(app: Express): void {
  ruta(
    app,
    'get',
    '/api/actas',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const f = validar(z.object({ empleado: uuid.optional() }), req.query);
      res.json({ actas: await repoActas.listar(f) });
    }),
  );

  /**
   * El documento, en bytes. Antes de `/api/actas/:id` no hace falta —las rutas
   * no chocan— pero sí antes de nada que capture `:id` de forma más amplia.
   *
   * `Content-Disposition: attachment`: el PDF se descarga, no se abre dentro de
   * la página. Un visor embebido en la misma pantalla que lo emitió invita a
   * darlo por firmado.
   */
  ruta(
    app,
    'get',
    '/api/actas/:id/pdf',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const doc = await repoActas.pdfDe(id);
      if (!doc) {
        // Distingue las dos causas: no existe, o existe sin documento (las
        // emitidas en la 5a, antes de que hubiera PDF).
        const acta = await repoActas.porId(id);
        if (!acta) throw noEncontrado('Acta');
        throw new ErrorHttp(
          409,
          'Esa acta se emitió antes de que existiera la generación de PDF y no tiene documento.',
        );
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${doc.consecutivo}.pdf"`,
      );
      // Para poder comprobar la descarga sin abrir el fichero.
      res.setHeader('X-Acta-Hash', doc.hash);
      res.setHeader('X-Acta-Plantilla', doc.plantilla);
      res.send(doc.pdf);
    }),
  );

  /**
   * «¿El documento guardado es el que estos datos producen?» — distinta de
   * «¿los bytes están intactos?», que la responde el hash contra el binario.
   */
  ruta(
    app,
    'get',
    '/api/actas/:id/verificar',
    'admin',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const r = await repoActas.recalcularHash(id);
      if (!r) throw noEncontrado('Acta');
      res.json({ ...r, coincide: r.hash_guardado === r.hash_recalculado });
    }),
  );

  ruta(
    app,
    'get',
    '/api/actas/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const acta = await repoActas.porId(id);
      if (!acta) throw noEncontrado('Acta');
      res.json({ acta });
    }),
  );

  ruta(
    app,
    'post',
    '/api/actas',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const datos = validar(esquemaEmitir, req.body);
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const r = await repoActas.emitir(datos, { usuarioId, ip: req.ip ?? null });
        const acta = await repoActas.porId(r.acta.id);
        res.status(201).json({ acta });
      } catch (e) {
        // 409 y no 400: la petición está bien formada y lo que falla es el
        // estado de la base. «Ese equipo nunca se le entregó a esta persona»
        // es algo que era cierto ayer y puede serlo mañana.
        if (e instanceof repoActas.SinMovimientoQueDocumentar) {
          throw new ErrorHttp(409, e.message);
        }
        if (e instanceof repoActas.EmpleadoNoEncontrado) throw noEncontrado('Empleado');
        if (e instanceof repoActas.EquipoNoEncontrado) throw noEncontrado('Equipo');
        throw e;
      }
    }),
  );
}
