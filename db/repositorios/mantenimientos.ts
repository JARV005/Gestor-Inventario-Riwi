/**
 * Acceso a `mantenimientos`. Columnas enumeradas siempre — ver la cabecera de
 * `equipos.ts`.
 *
 * ============================================================================
 * ABRIR Y CERRAR UN PARTE MUEVE EL EQUIPO, Y EN LA MISMA TRANSACCIÓN.
 * ============================================================================
 *
 * `Envío a mantenimiento` y `Retorno de mantenimiento` son la séptima y la
 * octava operación (D29), y las hace `mutar()` como las otras seis. La
 * alternativa —que el parte cambiara `equipos.estado` por su cuenta— reabriría
 * exactamente la puerta que D19 cerró: un equipo cambiando de estado sin dejar
 * movimiento, y un historial con agujeros que nadie ve.
 */

import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { db, type BD, type Ejecutor } from '../cliente.js';
import { equipos, ESTADOS_PARTE_ABIERTO, mantenimientos } from '../esquema.js';
import { TransicionIlegal } from '../transiciones.js';
import * as repoAuditoria from './auditoria.js';
import * as repoMovimientos from './movimientos.js';

const CAMPOS_PUBLICOS = {
  id: mantenimientos.id,
  equipo_id: mantenimientos.equipo_id,
  tipo: mantenimientos.tipo,
  descripcion: mantenimientos.descripcion,
  estado: mantenimientos.estado,
  fecha_reporte: mantenimientos.fecha_reporte,
  fecha_cierre: mantenimientos.fecha_cierre,
  responsable: mantenimientos.responsable,
  proveedor: mantenimientos.proveedor,
  costo: mantenimientos.costo,
  created_at: mantenimientos.created_at,
  updated_at: mantenimientos.updated_at,
} as const;

export interface FiltrosMantenimientos {
  equipo?: string;
  estado?: string;
  pagina?: number;
  porPagina?: number;
}

export async function listar(f: FiltrosMantenimientos = {}, bd: BD = db) {
  const condiciones: SQL[] = [];
  if (f.equipo) condiciones.push(eq(mantenimientos.equipo_id, f.equipo));
  if (f.estado) condiciones.push(eq(mantenimientos.estado, f.estado as never));
  const donde = condiciones.length ? and(...condiciones) : undefined;

  const porPagina = Math.min(Math.max(f.porPagina ?? 50, 1), 200);
  const pagina = Math.max(f.pagina ?? 1, 1);

  // El equipo se trae aquí para que la vista no tenga que cruzarlo a mano: un
  // parte sin saber de qué equipo es no dice nada. Solo los campos que hacen
  // falta para identificarlo — nunca los cifrados.
  const filas = await bd
    .select({
      ...CAMPOS_PUBLICOS,
      equipo_etiqueta: equipos.etiqueta,
      equipo_nombre: equipos.nombre_equipo,
      equipo_serial: equipos.serial,
      equipo_marca: equipos.marca,
      equipo_modelo: equipos.modelo,
    })
    .from(mantenimientos)
    .leftJoin(equipos, eq(equipos.id, mantenimientos.equipo_id))
    .where(donde)
    .orderBy(desc(mantenimientos.fecha_reporte))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina);

  const [{ total }] = await bd
    .select({ total: sql<number>`count(*)::int` })
    .from(mantenimientos)
    .where(donde);

  return { filas, total, pagina, porPagina };
}

// ---------------------------------------------------------------------------
// Escrituras (5d)
// ---------------------------------------------------------------------------

/** El equipo no se puede mandar al taller desde el estado en el que está. */
export class EquipoNoSePuedeEnviar extends Error {
  constructor(
    readonly estado_actual: string,
    readonly puedes: string[],
    mensaje: string,
  ) {
    super(mensaje);
  }
}
export class ParteNoEncontrado extends Error {}
export class ParteYaCerrado extends Error {}

/** Los tres estados con el equipo todavía en el taller. */
const ABIERTOS = ESTADOS_PARTE_ABIERTO as unknown as string[];
export const esAbierto = (estado: string) => ABIERTOS.includes(estado);

export interface NuevoParte {
  equipo_id: string;
  tipo: string;
  descripcion?: string | null;
  responsable?: string | null;
  proveedor?: string | null;
}

/**
 * Abre un parte y manda el equipo al taller, **en una transacción**.
 *
 * Si el equipo no se deja mover —está asignado, o ya de baja— no se abre el
 * parte: un parte abierto sobre un equipo que sigue en manos de alguien es la
 * contradicción que el índice único no puede ver.
 */
export async function abrir(
  datos: NuevoParte,
  contexto: { usuarioId: string; ip: string | null },
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    try {
      await repoMovimientos.mutar(
        'enviar_mantenimiento',
        datos.equipo_id,
        { observaciones: datos.descripcion ?? null },
        contexto,
        tx,
      );
    } catch (e) {
      if (e instanceof TransicionIlegal) {
        throw new EquipoNoSePuedeEnviar(
          e.estadoActual,
          e.alternativas,
          `${e.explicacion} No se abrió el parte.`,
        );
      }
      throw e;
    }

    const [parte] = await tx
      .insert(mantenimientos)
      .values({
        equipo_id: datos.equipo_id,
        tipo: datos.tipo,
        descripcion: datos.descripcion ?? null,
        responsable: datos.responsable ?? null,
        proveedor: datos.proveedor ?? null,
        estado: 'Pendiente',
      })
      .returning(CAMPOS_PUBLICOS);

    await repoAuditoria.registrar(
      {
        tabla: 'mantenimientos',
        registro_id: parte.id,
        accion: 'abrir_parte',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        despues: { equipo_id: datos.equipo_id, tipo: datos.tipo, estado: 'Pendiente' },
      },
      tx,
    );

    return parte;
  });
}

/**
 * Mueve el parte entre estados ABIERTOS. No toca el equipo: mientras el parte
 * siga abierto, el equipo sigue en el taller, y `Pendiente → En taller →
 * Completado` describe al taller, no al inventario.
 *
 * Cerrar no se hace por aquí: ver `cerrar()`.
 */
export async function actualizar(
  id: string,
  cambios: { estado?: (typeof ESTADOS_PARTE_ABIERTO)[number]; descripcion?: string | null; responsable?: string | null; proveedor?: string | null; costo?: string | null },
  contexto: { usuarioId: string; ip: string | null },
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    const [actual] = await tx
      .select({ id: mantenimientos.id, estado: mantenimientos.estado })
      .from(mantenimientos)
      .where(eq(mantenimientos.id, id))
      .for('update');

    if (!actual) throw new ParteNoEncontrado(id);
    if (!esAbierto(actual.estado)) throw new ParteYaCerrado(actual.estado);

    const [parte] = await tx
      .update(mantenimientos)
      .set(cambios)
      .where(eq(mantenimientos.id, id))
      .returning(CAMPOS_PUBLICOS);

    await repoAuditoria.registrar(
      {
        tabla: 'mantenimientos',
        registro_id: id,
        accion: 'actualizar_parte',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes: { estado: actual.estado },
        despues: cambios,
      },
      tx,
    );

    return parte;
  });
}

/**
 * Cierra el parte **y saca al equipo del taller**, en la misma transacción.
 *
 * ============================================================================
 * CERRAR ES UN SOLO GESTO, NO DOS (D29).
 * ============================================================================
 *
 * Un equipo que vuelve del taller y se queda en `En mantenimiento` porque
 * alguien cerró el parte sin devolverlo es un equipo perdido con pasos extra: el
 * inventario diría que está en el taller, el taller diría que lo entregó, y
 * nadie sabría cuál de los dos mira mal.
 *
 * El paso intermedio —«el taller terminó pero el equipo no ha vuelto»— no
 * necesita otro botón: ya tiene su propio estado, `Completado`, y ese sí deja
 * el equipo donde está.
 *
 * Dos desenlaces, y los dos sacan al equipo de mantenimiento:
 *
 *   - `retorno` → `Retorno de mantenimiento`, el equipo queda `Disponible`.
 *   - `baja`    → `Baja`, el equipo queda `De baja`. Sin esto, dar de baja un
 *                 equipo irreparable obligaría a devolverlo primero y el
 *                 inventario lo daría por disponible, aunque fuera un minuto.
 */
export async function cerrar(
  id: string,
  desenlace: 'retorno' | 'baja',
  contexto: { usuarioId: string; ip: string | null },
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    const [actual] = await tx
      .select({ id: mantenimientos.id, estado: mantenimientos.estado, equipo_id: mantenimientos.equipo_id })
      .from(mantenimientos)
      .where(eq(mantenimientos.id, id))
      .for('update');

    if (!actual) throw new ParteNoEncontrado(id);
    if (!esAbierto(actual.estado)) throw new ParteYaCerrado(actual.estado);

    // El movimiento primero: si el equipo no se deja mover, el parte no se
    // cierra. Al revés quedaría un parte cerrado y un equipo en el taller.
    await repoMovimientos.mutar(
      desenlace === 'retorno' ? 'retornar_mantenimiento' : 'baja',
      actual.equipo_id,
      { observaciones: `Cierre del parte de mantenimiento` },
      contexto,
      tx,
    );

    const [parte] = await tx
      .update(mantenimientos)
      .set({
        estado: desenlace === 'retorno' ? 'Devuelto' : 'Baja tras revisión',
        fecha_cierre: sql`now()`,
      })
      .where(eq(mantenimientos.id, id))
      .returning(CAMPOS_PUBLICOS);

    await repoAuditoria.registrar(
      {
        tabla: 'mantenimientos',
        registro_id: id,
        accion: 'cerrar_parte',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes: { estado: actual.estado },
        despues: { estado: parte.estado, desenlace, equipo_id: actual.equipo_id },
      },
      tx,
    );

    return parte;
  });
}

/** El parte abierto de un equipo, si lo hay. Como mucho hay uno. */
export async function abiertoDe(equipoId: string, bd: Ejecutor = db) {
  const [fila] = await bd
    .select(CAMPOS_PUBLICOS)
    .from(mantenimientos)
    .where(
      and(
        eq(mantenimientos.equipo_id, equipoId),
        inArray(mantenimientos.estado, ESTADOS_PARTE_ABIERTO),
      ),
    );
  return fila ?? null;
}
