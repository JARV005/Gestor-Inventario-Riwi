/**
 * `/api/equipos`.
 *
 * Las mutaciones de estado —asignar, devolver, reservar, liberar, trasladar y
 * dar de baja— NO están aquí: viven en `rutas/movimientos.ts`, porque escriben
 * en `equipos`, `movimientos` y `auditoria` en la misma transacción y porque
 * qué transición es legal se decide en un solo sitio
 * (`db/transiciones.ts`). Aquí quedan el CRUD y las lecturas.
 */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoAuditoria from '../../db/repositorios/auditoria.js';
import * as repoEquipos from '../../db/repositorios/equipos.js';
import {
  categoriaEquipo,
  condicionEquipo,
  estadoEquipo,
  licenciaTipo,
  propiedadEquipo,
} from '../../db/esquema.js';
import { CODIGOS } from '../../db/motivos.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp, noEncontrado } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

/** Los valores válidos salen del propio enum de la BD, no de una copia. */
const camposEquipo = z.object({
  categoria: z.enum(categoriaEquipo.enumValues),
  etiqueta: z.string().trim().min(1).max(60).nullable().optional(),
  nombre_equipo: z.string().trim().max(120).nullable().optional(),
  marca: z.string().trim().max(80).nullable().optional(),
  modelo: z.string().trim().max(120).nullable().optional(),
  serial: z.string().trim().max(120).nullable().optional(),
  serial_cargador: z.string().trim().max(120).nullable().optional(),
  propiedad: z.enum(propiedadEquipo.enumValues).optional(),
  sistema_operativo: z.string().trim().max(120).nullable().optional(),
  licencia_tipo: z.enum(licenciaTipo.enumValues).nullable().optional(),
  tamano_pantalla: z.string().trim().max(40).nullable().optional(),
  procesador: z.string().trim().max(120).nullable().optional(),
  disco: z.string().trim().max(80).nullable().optional(),
  ram: z.string().trim().max(40).nullable().optional(),
  estado: z.enum(estadoEquipo.enumValues),
  condicion: z.enum(condicionEquipo.enumValues).nullable().optional(),
  sede_id: uuid.nullable().optional(),
  empleado_id: uuid.nullable().optional(),
  sesion_usuario: z.string().trim().max(200).nullable().optional(),
  notas: z.string().trim().max(2000).nullable().optional(),
  /**
   * Pesos colombianos, como cadena: `numeric(14,2)` no cabe en un `number` de
   * JavaScript sin perder precisión, y `pg` lo devuelve como texto por lo
   * mismo. Se valida la forma aquí para que un «12.345,67» no llegue a
   * Postgres como error de sintaxis.
   *
   * Estaba fuera del esquema mientras nadie escribía equipos. Al conectar
   * `NewDeviceModal` resultó que el formulario ya pedía el costo y la API lo
   * descartaba sin decir nada: se tecleaba un número y no llegaba a la base.
   */
  costo: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, { message: 'importe inválido; usar punto decimal' })
    .nullable()
    .optional(),
});

const esquemaCrear = camposEquipo;
const esquemaActualizar = camposEquipo.partial();

const esquemaFiltros = z.object({
  estado: z.enum(estadoEquipo.enumValues).optional(),
  categoria: z.enum(categoriaEquipo.enumValues).optional(),
  sede: uuid.optional(),
  q: z.string().trim().max(120).optional(),
  // Se valida contra el catálogo de códigos, no como texto libre: un código
  // inexistente devolvería cero filas y parecería "no hay ninguno".
  motivo: z.enum(CODIGOS as [string, ...string[]]).optional(),
  pagina: z.coerce.number().int().min(1).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
});

function validar<T>(esquema: z.ZodType<T>, entrada: unknown): T {
  const r = esquema.safeParse(entrada);
  if (!r.success) {
    // Solo la ruta del campo y el mensaje: los `issues` de zod incluyen el
    // valor recibido, y ese valor puede ser cualquier cosa que hayan mandado.
    throw new ErrorHttp(400, 'Entrada inválida', {
      campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })),
    });
  }
  return r.data;
}

export function registrarRutasEquipos(app: Express): void {
  ruta(
    app,
    'get',
    '/api/equipos',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const f = validar(esquemaFiltros, req.query);
      res.json(await repoEquipos.listar(f));
    }),
  );

  // Antes de '/api/equipos/:id', o Express trataría "revision" como un id.
  ruta(
    app,
    'get',
    '/api/equipos/revision',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const f = validar(esquemaFiltros, req.query);
      const [pagina, conteos] = await Promise.all([
        repoEquipos.listar({ ...f, revision: true }),
        repoEquipos.conteoPorMotivo(),
      ]);
      // Los conteos van con el listado para que la bandeja pueda pintar los
      // bloques sin una segunda petición: "los 37 de licencia" tiene que ser
      // visible antes de filtrar, o nadie sabe por dónde empezar.
      res.json({ ...pagina, conteos });
    }),
  );

  // Igual que '/revision': antes de '/api/equipos/:id' o "resumen" se validaría
  // como uuid y devolvería un 400 en vez del resumen.
  ruta(
    app,
    'get',
    '/api/equipos/resumen',
    'autenticado',
    guardian,
    asincrono(async (_req, res) => {
      res.json(await repoEquipos.resumen());
    }),
  );

  ruta(
    app,
    'get',
    '/api/equipos/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const equipo = await repoEquipos.porId(id);
      if (!equipo) throw noEncontrado('Equipo');
      res.json({ equipo });
    }),
  );

  // `GET /api/equipos/:id/historial` vive en `rutas/movimientos.ts` desde la
  // etapa 5. El de aquí devolvía los UUID a pelo, sin resolver nombres.

  /**
   * El único endpoint que devuelve los campos cifrados, de uno en uno y solo
   * para admin (§5.2). Deja fila en `auditoria` ANTES de responder: si el
   * registro falla, la respuesta no sale.
   */
  ruta(
    app,
    'get',
    '/api/equipos/:id/bios',
    'admin',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const secretos = await repoEquipos.descifrarSecretos(id);
      if (!secretos) throw noEncontrado('Equipo');

      await repoAuditoria.registrar({
        tabla: 'equipos',
        registro_id: id,
        accion: 'descifrar_bios',
        usuario_app_id: req.usuario?.id ?? null,
        ip: req.ip ?? null,
        // Se registra QUE se leyó, nunca el valor leído.
        despues: { campos: ['bios_password', 'licencia_serial'] },
      });

      res.json(secretos);
    }),
  );

  ruta(
    app,
    'post',
    '/api/equipos',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const datos = validar(esquemaCrear, req.body);
      // `guardian` ya rechazó la petición sin sesión, pero el tipo no lo sabe.
      // Si alguna vez dejara de hacerlo, esto falla aquí y no escribe un
      // movimiento sin autor.
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');
      res.status(201).json({ equipo: await repoEquipos.crear(datos, usuarioId) });
    }),
  );

  ruta(
    app,
    'patch',
    '/api/equipos/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const datos = validar(esquemaActualizar, req.body);
      const equipo = await repoEquipos.actualizar(id, datos);
      if (!equipo) throw noEncontrado('Equipo');
      res.json({ equipo });
    }),
  );
}
