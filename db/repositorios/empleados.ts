/**
 * Acceso a `empleados`. Columnas enumeradas siempre — ver la cabecera de
 * `equipos.ts` para el porqué; la regla es del directorio, no de esa tabla.
 */

import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

import { db, type BD } from '../cliente.js';
import { empleados, equipos } from '../esquema.js';

const CAMPOS_PUBLICOS = {
  id: empleados.id,
  nombre: empleados.nombre,
  cedula: empleados.cedula,
  email_corporativo: empleados.email_corporativo,
  cargo: empleados.cargo,
  area: empleados.area,
  sede_id: empleados.sede_id,
  estado: empleados.estado,
  fecha_ingreso: empleados.fecha_ingreso,
  telefono: empleados.telefono,
  direccion: empleados.direccion,
  activo: empleados.activo,
  created_at: empleados.created_at,
  updated_at: empleados.updated_at,
} as const;

export interface FiltrosEmpleados {
  q?: string;
  sede?: string;
  activo?: boolean;
  pagina?: number;
  porPagina?: number;
}

export async function listar(f: FiltrosEmpleados = {}, bd: BD = db) {
  const condiciones: SQL[] = [];
  if (f.sede) condiciones.push(eq(empleados.sede_id, f.sede));
  if (f.activo !== undefined) condiciones.push(eq(empleados.activo, f.activo));
  if (f.q) {
    const patron = `%${f.q}%`;
    const busqueda = or(
      ilike(empleados.nombre, patron),
      ilike(empleados.cedula, patron),
      ilike(empleados.email_corporativo, patron),
    );
    if (busqueda) condiciones.push(busqueda);
  }
  const donde = condiciones.length ? and(...condiciones) : undefined;

  const porPagina = Math.min(Math.max(f.porPagina ?? 50, 1), 200);
  const pagina = Math.max(f.pagina ?? 1, 1);

  const filas = await bd
    .select({
      ...CAMPOS_PUBLICOS,
      /**
       * Lo que antes era `Employee.assignedDeviceIds.length` (D2).
       *
       * Se cuenta desde el lado de equipos, que es donde vive la relación
       * ahora. Como subconsulta y no como JOIN + GROUP BY: con JOIN, un
       * empleado sin equipos desaparecería o habría que arrastrar un LEFT JOIN
       * y agrupar por las catorce columnas.
       *
       * Va en el listado y no como petición por tarjeta porque son 25 por
       * página: 25 peticiones extra para pintar un número.
       */
      //
      // Las columnas van escritas y calificadas a mano, sin interpolar.
      // Interpolando, drizzle las emite SIN calificar —`WHERE "empleado_id" =
      // "id"`— y dentro de la subconsulta `"id"` resuelve contra `equipos`, no
      // contra `empleados`. La comparación pasa a ser
      // `equipos.empleado_id = equipos.id`, que nunca es cierta: la consulta
      // no falla, devuelve 0 para todo el mundo.
      equipos_asignados: sql<number>`(
        SELECT count(*)::int FROM equipos WHERE equipos.empleado_id = empleados.id
      )`,
    })
    .from(empleados)
    .where(donde)
    .orderBy(asc(empleados.nombre))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina);

  const [{ total }] = await bd
    .select({ total: sql<number>`count(*)::int` })
    .from(empleados)
    .where(donde);

  return { filas, total, pagina, porPagina };
}

export async function porId(id: string, bd: BD = db) {
  const [fila] = await bd.select(CAMPOS_PUBLICOS).from(empleados).where(eq(empleados.id, id));
  return fila ?? null;
}

/**
 * Equipos a nombre de una persona. Es la consulta que decide si se puede
 * desactivar (ver `rutas/empleados.ts`), así que devuelve lo justo para
 * enseñárselos a quien lo intente.
 */
export async function equiposDe(id: string, bd: BD = db) {
  return bd
    .select({
      id: equipos.id,
      etiqueta: equipos.etiqueta,
      serial: equipos.serial,
      categoria: equipos.categoria,
      marca: equipos.marca,
      modelo: equipos.modelo,
      estado: equipos.estado,
    })
    .from(equipos)
    .where(eq(equipos.empleado_id, id))
    .orderBy(asc(equipos.etiqueta));
}

export async function crear(datos: typeof empleados.$inferInsert, bd: BD = db) {
  const [fila] = await bd.insert(empleados).values(datos).returning(CAMPOS_PUBLICOS);
  return fila;
}

export async function actualizar(
  id: string,
  datos: Partial<typeof empleados.$inferInsert>,
  bd: BD = db,
) {
  const [fila] = await bd
    .update(empleados)
    .set(datos)
    .where(eq(empleados.id, id))
    .returning(CAMPOS_PUBLICOS);
  return fila ?? null;
}
