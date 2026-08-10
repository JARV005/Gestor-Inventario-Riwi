/**
 * Acceso a `sedes`. Columnas enumeradas siempre — ver la cabecera de
 * `equipos.ts`.
 */

import { asc, eq, sql } from 'drizzle-orm';

import { db, type BD } from '../cliente.js';
import { sedes } from '../esquema.js';

const CAMPOS_PUBLICOS = {
  id: sedes.id,
  nombre: sedes.nombre,
  ciudad: sedes.ciudad,
  direccion: sedes.direccion,
  responsable: sedes.responsable,
  contacto_email: sedes.contacto_email,
  contacto_telefono: sedes.contacto_telefono,
  activa: sedes.activa,
  created_at: sedes.created_at,
  updated_at: sedes.updated_at,
} as const;

export async function listar(bd: BD = db) {
  return bd.select(CAMPOS_PUBLICOS).from(sedes).orderBy(asc(sedes.nombre));
}

/**
 * Sedes con el reparto de equipos de cada una.
 *
 * Las subconsultas van con las tablas **calificadas a mano**. Interpoladas,
 * drizzle no califica dentro de la lista de SELECT y `id` resolvería contra
 * `equipos` en vez de contra `sedes`: la consulta no fallaría, devolvería
 * ceros. Ya pasó una vez con el conteo de empleados.
 */
export async function listarConConteos(bd: BD = db) {
  return bd
    .select({
      ...CAMPOS_PUBLICOS,
      equipos_total: sql<number>`(
        SELECT count(*)::int FROM equipos WHERE equipos.sede_id = sedes.id
      )`,
      equipos_asignados: sql<number>`(
        SELECT count(*)::int FROM equipos
         WHERE equipos.sede_id = sedes.id AND equipos.estado = 'Asignado'
      )`,
      equipos_disponibles: sql<number>`(
        SELECT count(*)::int FROM equipos
         WHERE equipos.sede_id = sedes.id AND equipos.estado = 'Disponible'
      )`,
      /**
       * Equipos **saliendo** de esta sede: los que todavía la tienen como
       * `sede_id` y ya tienen un traslado abierto. Hasta que el traslado se
       * confirma, el equipo sigue perteneciendo a la sede de origen.
       *
       * Antes salía de `equipos.estado = 'En tránsito'`. Ese valor ya no
       * existe (D13, 0008): «está viajando» se deriva del traslado abierto, y
       * el índice único de `movimientos` garantiza que no haya dos.
       */
      equipos_en_transito: sql<number>`(
        SELECT count(*)::int FROM equipos
         WHERE equipos.sede_id = sedes.id
           AND EXISTS (
             SELECT 1 FROM movimientos
              WHERE movimientos.equipo_id = equipos.id
                AND movimientos.tipo = 'Traslado'
                AND movimientos.fecha_confirmacion IS NULL
           )
      )`,
      equipos_por_revisar: sql<number>`(
        SELECT count(*)::int FROM equipos
         WHERE equipos.sede_id = sedes.id AND equipos.requiere_revision
      )`,
      empleados_total: sql<number>`(
        SELECT count(*)::int FROM empleados WHERE empleados.sede_id = sedes.id
      )`,
    })
    .from(sedes)
    .orderBy(asc(sedes.nombre));
}

/** Equipos que no tienen sede. Son deuda del Excel y tienen que verse. */
export async function equiposSinSede(bd: BD = db) {
  const [{ n }] = await bd.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM equipos WHERE equipos.sede_id IS NULL`,
  ).then((r) => r.rows as { n: number }[]);
  return n;
}

export async function porId(id: string, bd: BD = db) {
  const [fila] = await bd.select(CAMPOS_PUBLICOS).from(sedes).where(eq(sedes.id, id));
  return fila ?? null;
}

export async function crear(datos: typeof sedes.$inferInsert, bd: BD = db) {
  const [fila] = await bd.insert(sedes).values(datos).returning(CAMPOS_PUBLICOS);
  return fila;
}

export async function actualizar(
  id: string,
  datos: Partial<typeof sedes.$inferInsert>,
  bd: BD = db,
) {
  const [fila] = await bd
    .update(sedes)
    .set(datos)
    .where(eq(sedes.id, id))
    .returning(CAMPOS_PUBLICOS);
  return fila ?? null;
}
