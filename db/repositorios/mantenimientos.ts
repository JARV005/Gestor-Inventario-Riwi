/**
 * Acceso a `mantenimientos`. Columnas enumeradas siempre — ver la cabecera de
 * `equipos.ts`.
 *
 * **Solo lectura.** No hay `crear` ni `actualizar` a propósito: abrir y cerrar
 * partes es la etapa 6, y un repositorio con métodos de escritura que nadie usa
 * es una invitación a usarlos antes de tiempo.
 */

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { db, type BD } from '../cliente.js';
import { equipos, mantenimientos } from '../esquema.js';

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
