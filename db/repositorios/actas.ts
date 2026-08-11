/**
 * Actas de entrega y devolución. Etapa 5a — el acta en la base, sin PDF.
 *
 * ============================================================================
 * UN ACTA ES UN DOCUMENTO SOBRE ALGO QUE YA OCURRIÓ.
 * ============================================================================
 *
 * No se emite un acta y luego se entrega el equipo: se entrega el equipo —lo
 * que deja su `Asignación` en `movimientos`— y después se firma el papel que lo
 * dice. De ahí las dos propiedades que gobiernan este fichero:
 *
 *  1. **Va atada a su movimiento** (D24). Cada fila de `actas_equipos` apunta al
 *     movimiento que documenta, con FK compuesta para que sea el movimiento de
 *     ESE equipo. Sin la atadura, dentro de un año hay actas que nadie sabe a
 *     qué entrega corresponden.
 *
 *  2. **Lo que dice queda congelado** (D23). Las columnas de instantánea son el
 *     contenido del documento, copiado al emitirlo. Corregir un serial el mes
 *     que viene no puede cambiar un acta ya emitida — y por eso aquí no se
 *     guarda solo la FK y se lee después.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { db, type BD, type Ejecutor } from '../cliente.js';
import {
  actas,
  actasConsecutivo,
  actasEquipos,
  empleados,
  equipos,
  movimientos,
  sedes,
  usuariosApp,
} from '../esquema.js';
import * as repoAuditoria from './auditoria.js';

export type TipoActa = 'Entrega' | 'Devolución';

/** Qué movimiento documenta cada tipo de acta. */
const MOVIMIENTO_DE: Record<TipoActa, 'Asignación' | 'Devolución'> = {
  Entrega: 'Asignación',
  Devolución: 'Devolución',
};

export class EmpleadoNoEncontrado extends Error {}
export class EquipoNoEncontrado extends Error {}
/** El equipo no tiene un movimiento de ese tipo con esa persona. */
export class SinMovimientoQueDocumentar extends Error {}
/** Ese movimiento ya lo cubre otra acta. */
export class YaTieneActa extends Error {}

export interface DatosActa {
  tipo: TipoActa;
  empleado_id: string;
  /** Los equipos que el acta cubre. Al menos uno. */
  equipos: string[];
}

/**
 * El consecutivo del año, dentro de la transacción del acta.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` en una sola sentencia: crea el contador el
 * primer día del año y lo incrementa el resto. El `UPDATE` toma el bloqueo de
 * la fila hasta el COMMIT, así que dos peticiones simultáneas se serializan y
 * la segunda recibe el siguiente número, no el mismo.
 *
 * Se pide **al final**, cuando ya está todo validado: el bloqueo serializa la
 * emisión de actas y no hay motivo para sostenerlo mientras se comprueban
 * movimientos.
 *
 * Y no es una SEQUENCE a propósito (D25): `nextval` no se deshace con la
 * transacción, así que un acta que falle después de pedir número deja un hueco
 * permanente en la numeración de un documento firmable.
 */
async function siguienteConsecutivo(tx: Ejecutor, anio: number): Promise<string> {
  const [fila] = await tx
    .insert(actasConsecutivo)
    .values({ anio, valor: 1 })
    .onConflictDoUpdate({
      target: actasConsecutivo.anio,
      set: { valor: sql`${actasConsecutivo.valor} + 1` },
    })
    .returning({ valor: actasConsecutivo.valor });

  return `ACT-${anio}-${String(fila.valor).padStart(4, '0')}`;
}

export async function emitir(
  datos: DatosActa,
  contexto: { usuarioId: string; ip: string | null },
  bd: BD = db,
) {
  const tipoMov = MOVIMIENTO_DE[datos.tipo];

  return bd.transaction(async (tx) => {
    // -----------------------------------------------------------------------
    // 1. La persona, con el nombre de su sede resuelto
    // -----------------------------------------------------------------------
    const [persona] = await tx
      .select({
        id: empleados.id,
        nombre: empleados.nombre,
        cedula: empleados.cedula,
        cargo: empleados.cargo,
        area: empleados.area,
        sede: sedes.nombre,
      })
      .from(empleados)
      .leftJoin(sedes, eq(sedes.id, empleados.sede_id))
      .where(eq(empleados.id, datos.empleado_id));

    if (!persona) throw new EmpleadoNoEncontrado(datos.empleado_id);

    const [autor] = await tx
      .select({ nombre: usuariosApp.nombre })
      .from(usuariosApp)
      .where(eq(usuariosApp.id, contexto.usuarioId));

    // -----------------------------------------------------------------------
    // 2. Un movimiento por equipo, y la instantánea de cada uno
    // -----------------------------------------------------------------------
    //
    // El equipo se bloquea antes de copiarlo: sin `FOR UPDATE`, una asignación
    // concurrente podría cambiar la fila entre la lectura y el COMMIT, y el
    // acta guardaría una instantánea de un estado que nunca coexistió con su
    // movimiento. Mismo orden de bloqueo que `mutar()` —equipos primero—, que
    // es lo que evita que las dos se esperen en cruz.
    const lineas: (typeof actasEquipos.$inferInsert)[] = [];

    for (const equipoId of datos.equipos) {
      const [eq_] = await tx
        .select({
          id: equipos.id,
          etiqueta: equipos.etiqueta,
          serial: equipos.serial,
          marca: equipos.marca,
          modelo: equipos.modelo,
          categoria: equipos.categoria,
          condicion: equipos.condicion,
          procesador: equipos.procesador,
          ram: equipos.ram,
          disco: equipos.disco,
          sistema_operativo: equipos.sistema_operativo,
        })
        .from(equipos)
        .where(eq(equipos.id, equipoId))
        .for('update');

      if (!eq_) throw new EquipoNoEncontrado(equipoId);

      // El movimiento que este acta documenta: el más reciente de su tipo CON
      // ESA PERSONA. El filtro por persona no es adorno — un equipo que pasó
      // de A a B tiene dos `Asignación`, y el acta de B no puede colgar de la
      // de A.
      const extremo = tipoMov === 'Asignación' ? 'empleado_destino_id' : 'empleado_origen_id';
      const [mov] = await tx
        .select({ id: movimientos.id, fecha: movimientos.fecha })
        .from(movimientos)
        .where(
          and(
            eq(movimientos.equipo_id, equipoId),
            eq(movimientos.tipo, tipoMov),
            eq(movimientos[extremo], datos.empleado_id),
          ),
        )
        .orderBy(desc(movimientos.fecha), desc(movimientos.created_at))
        .limit(1);

      if (!mov) {
        throw new SinMovimientoQueDocumentar(
          `No hay ninguna ${tipoMov.toLowerCase()} de ${eq_.etiqueta ?? eq_.categoria} ` +
            `a nombre de ${persona.nombre}. Un acta documenta algo que ya ocurrió: ` +
            `primero la operación, después el papel.`,
        );
      }

      lineas.push({
        acta_id: '', // se rellena al insertar, cuando exista el id del acta
        equipo_id: equipoId,
        movimiento_id: mov.id,
        etiqueta: eq_.etiqueta,
        serial: eq_.serial,
        marca: eq_.marca,
        modelo: eq_.modelo,
        categoria: eq_.categoria,
        condicion: eq_.condicion,
        procesador: eq_.procesador,
        ram: eq_.ram,
        disco: eq_.disco,
        sistema_operativo: eq_.sistema_operativo,
      });
    }

    // -----------------------------------------------------------------------
    // 3. El consecutivo y el acta
    // -----------------------------------------------------------------------
    const anio = new Date().getUTCFullYear();
    const consecutivo = await siguienteConsecutivo(tx, anio);

    const [acta] = await tx
      .insert(actas)
      .values({
        consecutivo,
        tipo: datos.tipo,
        empleado_id: persona.id,
        generada_por: contexto.usuarioId,
        empleado_nombre: persona.nombre,
        empleado_cedula: persona.cedula,
        empleado_cargo: persona.cargo,
        empleado_area: persona.area,
        sede_nombre: persona.sede,
        generada_por_nombre: autor?.nombre ?? 'desconocido',
      })
      .returning();

    // El UNIQUE sobre `movimiento_id` corta aquí un segundo acta sobre la misma
    // entrega. Se traduce a 409 en la capa HTTP.
    await tx.insert(actasEquipos).values(lineas.map((l) => ({ ...l, acta_id: acta.id })));

    await repoAuditoria.registrar(
      {
        tabla: 'actas',
        registro_id: acta.id,
        accion: 'emitir_acta',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        despues: {
          consecutivo,
          tipo: datos.tipo,
          empleado_id: persona.id,
          equipos: lineas.map((l) => l.equipo_id),
          movimientos: lineas.map((l) => l.movimiento_id),
        },
      },
      tx,
    );

    return { acta, lineas: lineas.length };
  });
}

/**
 * Un acta con lo que dice, **leído de la instantánea y no de las tablas
 * vivas**. Los `equipo_id` y `movimiento_id` van también, para poder saltar al
 * equipo actual desde el documento, pero lo que se imprime es la copia.
 */
export async function porId(id: string, bd: BD = db) {
  // Columnas enumeradas, nunca `select()` a secas. Aquí no hay campos
  // cifrados, pero sí `pdf`: un `SELECT *` lo traería entero a memoria y de
  // ahí a la respuesta JSON en cuanto alguien serialice el objeto. Lo que sale
  // es `tiene_pdf`, y el binario por su propio endpoint (5b).
  const [acta] = await bd
    .select({
      id: actas.id,
      consecutivo: actas.consecutivo,
      tipo: actas.tipo,
      fecha: actas.fecha,
      empleado_id: actas.empleado_id,
      empleado_nombre: actas.empleado_nombre,
      empleado_cedula: actas.empleado_cedula,
      empleado_cargo: actas.empleado_cargo,
      empleado_area: actas.empleado_area,
      sede_nombre: actas.sede_nombre,
      generada_por: actas.generada_por,
      generada_por_nombre: actas.generada_por_nombre,
      firmada: actas.firmada,
      fecha_firma: actas.fecha_firma,
      hash_sha256: actas.hash_sha256,
      tiene_pdf: sql<boolean>`(actas.pdf IS NOT NULL)`,
      created_at: actas.created_at,
    })
    .from(actas)
    .where(eq(actas.id, id));

  if (!acta) return null;

  const equiposDelActa = await bd
    .select({
      equipo_id: actasEquipos.equipo_id,
      movimiento_id: actasEquipos.movimiento_id,
      etiqueta: actasEquipos.etiqueta,
      serial: actasEquipos.serial,
      marca: actasEquipos.marca,
      modelo: actasEquipos.modelo,
      categoria: actasEquipos.categoria,
      condicion: actasEquipos.condicion,
      procesador: actasEquipos.procesador,
      ram: actasEquipos.ram,
      disco: actasEquipos.disco,
      sistema_operativo: actasEquipos.sistema_operativo,
    })
    .from(actasEquipos)
    .where(eq(actasEquipos.acta_id, id));

  return { ...acta, equipos: equiposDelActa };
}

/** Las actas emitidas, de la más nueva a la más vieja. */
export async function listar(filtros: { empleado?: string } = {}, bd: BD = db) {
  const donde = filtros.empleado ? eq(actas.empleado_id, filtros.empleado) : undefined;

  return bd
    .select({
      id: actas.id,
      consecutivo: actas.consecutivo,
      tipo: actas.tipo,
      fecha: actas.fecha,
      empleado_id: actas.empleado_id,
      empleado_nombre: actas.empleado_nombre,
      sede_nombre: actas.sede_nombre,
      generada_por_nombre: actas.generada_por_nombre,
      firmada: actas.firmada,
      tiene_pdf: sql<boolean>`(actas.pdf IS NOT NULL)`,
      equipos: sql<number>`(
        SELECT count(*)::int FROM actas_equipos WHERE actas_equipos.acta_id = actas.id
      )`,
    })
    .from(actas)
    .where(donde)
    .orderBy(desc(actas.fecha));
}
