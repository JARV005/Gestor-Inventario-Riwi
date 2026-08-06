/**
 * Acceso a `sedes`. Columnas enumeradas siempre — ver la cabecera de
 * `equipos.ts`.
 */

import { asc, eq } from 'drizzle-orm';

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
