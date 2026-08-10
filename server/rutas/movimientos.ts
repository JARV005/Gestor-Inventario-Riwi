/**
 * Las seis mutaciones de estado de un equipo, y su historial. Etapa 5.
 *
 *   POST /api/equipos/:id/asignar    Disponible|Reservado -> Asignado
 *   POST /api/equipos/:id/devolver   Asignado             -> Disponible
 *   POST /api/equipos/:id/reservar   Disponible           -> Reservado
 *   POST /api/equipos/:id/liberar    Reservado            -> Disponible
 *   POST /api/equipos/:id/baja       Disponible|Reservado|En mantenimiento -> De baja
 *   POST /api/equipos/:id/trasladar  no cambia el estado; abre el traslado
 *   GET  /api/equipos/:id/historial  con nombres, no con UUIDs
 *
 * Y el cierre del traslado, que es lo único que se puede tocar de un
 * movimiento ya escrito:
 *
 *   GET  /api/traslados                 los que están en curso, con nombres
 *   POST /api/movimientos/:id/confirmar cierra el movimiento y mueve el equipo
 *
 * Qué transición es legal desde qué estado **no se decide aquí**: está en
 * `db/transiciones.ts`, en una sola tabla. Estos manejadores solo traducen su
 * excepción a un 409 con un mensaje que se pueda leer.
 */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoEquipos from '../../db/repositorios/equipos.js';
import * as repoMovimientos from '../../db/repositorios/movimientos.js';
import { TransicionIlegal, type Operacion } from '../../db/transiciones.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp, noEncontrado } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

const esquemaMutacion = z.object({
  empleado_id: uuid.nullable().optional(),
  sede_destino_id: uuid.nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
  transportadora: z.string().trim().max(120).nullable().optional(),
  guia: z.string().trim().max(120).nullable().optional(),
  fecha_estimada: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha en formato AAAA-MM-DD' })
    .nullable()
    .optional(),
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

/**
 * `TransicionIlegal` -> 409 con qué se puede hacer en su lugar.
 *
 * El 409 no se limita a decir que no: dice desde qué estados sí valdría y qué
 * operaciones sí están disponibles ahora mismo. Un «no se puede» sin salida
 * obliga a quien lo recibe a adivinar, y adivinando se acaba en un `UPDATE`
 * a mano contra la base.
 */
function traducir(e: unknown): never {
  if (e instanceof TransicionIlegal) {
    throw new ErrorHttp(409, e.explicacion, {
      operacion: e.operacion,
      estado_actual: e.estadoActual,
      legal_desde: e.legalesDesde,
      puedes: e.alternativas,
    });
  }
  if (e instanceof repoMovimientos.FaltaDato) throw new ErrorHttp(400, e.message);
  if (e instanceof repoMovimientos.EquipoNoEncontrado) throw noEncontrado('Equipo');

  if (e instanceof repoMovimientos.MovimientoNoEncontrado) throw noEncontrado('Movimiento');
  if (e instanceof repoMovimientos.NoEsTraslado) {
    throw new ErrorHttp(409, `Ese movimiento es de tipo "${e.message}": no hay nada que confirmar.`);
  }
  if (e instanceof repoMovimientos.TrasladoYaConfirmado) {
    // 409 y no 404: el traslado existe, y quien lo pide probablemente está
    // viendo una lista de hace un minuto. Recargar es la respuesta.
    throw new ErrorHttp(409, 'Ese traslado ya estaba confirmado. Recargar para ver la lista al día.');
  }
  throw e;
}

/** Registra las seis. Idénticas salvo la operación: no hay seis copias. */
function registrarMutacion(app: Express, operacion: Operacion): void {
  ruta(
    app,
    'post',
    `/api/equipos/:id/${operacion}`,
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const datos = validar(esquemaMutacion, req.body ?? {});

      // `guardian` ya rechazó la petición sin sesión. Si dejara de hacerlo,
      // esto falla aquí y no escribe un movimiento sin autor.
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const r = await repoMovimientos.mutar(operacion, id, datos, {
          usuarioId,
          ip: req.ip ?? null,
        });
        const equipo = await repoEquipos.porId(id);
        res.json({ equipo, movimiento: r.movimiento });
      } catch (e) {
        traducir(e);
      }
    }),
  );
}

export function registrarRutasMovimientos(app: Express): void {
  for (const op of [
    'asignar',
    'devolver',
    'reservar',
    'liberar',
    'baja',
    'trasladar',
  ] as const satisfies readonly Operacion[]) {
    registrarMutacion(app, op);
  }

  /**
   * El historial, con nombres resueltos.
   *
   * Sustituye al `GET /api/equipos/:id/historial` de la etapa 3, que devolvía
   * los UUID a pelo. Es la pantalla que justifica el proyecto: «¿quién tenía
   * el BBL-0301 en marzo?». Un historial que contesta `a3f9c1e2-…` no
   * contesta.
   */
  ruta(
    app,
    'get',
    '/api/equipos/:id/historial',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const equipo = await repoEquipos.porId(id);
      if (!equipo) throw noEncontrado('Equipo');

      const [movimientos, traslado] = await Promise.all([
        repoMovimientos.historialConNombres(id),
        repoMovimientos.trasladoAbierto(id),
      ]);

      // `traslado_abierto` va aparte y no se deduce del listado: quien pinte
      // esto no debería tener que recorrer los movimientos buscando cuál no
      // tiene `fecha_confirmacion`. Es el mismo hecho que el badge del
      // sidebar, y sale de la misma condición.
      res.json({ movimientos, traslado_abierto: traslado });
    }),
  );

  /**
   * Los traslados en curso. Alimenta la lista de `SedesView` y es la otra cara
   * del badge del sidebar: los dos salen de `tipo = 'Traslado'` y
   * `fecha_confirmacion IS NULL`, así que no pueden discrepar.
   */
  ruta(
    app,
    'get',
    '/api/traslados',
    'autenticado',
    guardian,
    asincrono(async (_req, res) => {
      res.json({ traslados: await repoMovimientos.listarTrasladosAbiertos() });
    }),
  );

  /**
   * Confirmar la llegada. Cierra el movimiento y mueve `equipos.sede_id` en la
   * misma transacción — ver la cabecera de `confirmarTraslado`.
   *
   * Va sobre el id del **movimiento** y no sobre el del equipo: es la fila del
   * movimiento la que se cierra, y la lista de la que se pulsa ya la tiene. Con
   * `/api/equipos/:id/confirmar` habría que resolver cuál de sus movimientos es
   * —hoy solo puede haber uno abierto, pero eso es una consecuencia del índice
   * único, no algo que la URL deba dar por hecho.
   */
  ruta(
    app,
    'post',
    '/api/movimientos/:id/confirmar',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const r = await repoMovimientos.confirmarTraslado(id, { usuarioId, ip: req.ip ?? null });
        const equipo = await repoEquipos.porId(r.equipo_id);
        res.json({ equipo, movimiento: r.movimiento });
      } catch (e) {
        traducir(e);
      }
    }),
  );
}
