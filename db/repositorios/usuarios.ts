/**
 * Acceso a `usuarios_app`.
 *
 * `password_hash` solo sale de aquí en `porEmailParaLogin` y en
 * `porIdParaSesion`, que son los dos únicos sitios que lo necesitan. El resto
 * de consultas enumeran columnas sin incluirlo: nunca `SELECT *`.
 */

import { eq, sql } from 'drizzle-orm';

import { db, type BD } from '../cliente.js';
import { usuariosApp } from '../esquema.js';

/** Lo que se puede enseñar. Sin `password_hash`. */
const CAMPOS_PUBLICOS = {
  id: usuariosApp.id,
  email: usuariosApp.email,
  nombre: usuariosApp.nombre,
  rol: usuariosApp.rol,
  activo: usuariosApp.activo,
  ultimo_acceso: usuariosApp.ultimo_acceso,
} as const;

export type UsuarioPublico = {
  id: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'tecnico';
  activo: boolean;
  ultimo_acceso: Date | null;
};

/**
 * Para el login. Devuelve `activo` y `password_hash` **por separado** y sin
 * combinarlos, porque quien llama tiene que comprobarlos como dos condiciones
 * independientes (D4). Si esta función devolviera un `puedeEntrar` booleano,
 * las dos comprobaciones se volverían una y no habría forma de probar que
 * ninguna depende de la otra.
 */
export async function porEmailParaLogin(email: string, bd: BD = db) {
  const [u] = await bd
    .select({
      id: usuariosApp.id,
      email: usuariosApp.email,
      nombre: usuariosApp.nombre,
      rol: usuariosApp.rol,
      activo: usuariosApp.activo,
      password_hash: usuariosApp.password_hash,
    })
    .from(usuariosApp)
    .where(eq(usuariosApp.email, email));
  return u ?? null;
}

/**
 * Para revalidar la sesión en **cada** petición. Trae `activo` y
 * `password_hash` porque de ellos dependen las dos invalidaciones que no pueden
 * esperar al siguiente login: desactivar a alguien y cambiar una contraseña.
 */
export async function porIdParaSesion(id: string, bd: BD = db) {
  const [u] = await bd
    .select({
      id: usuariosApp.id,
      email: usuariosApp.email,
      nombre: usuariosApp.nombre,
      rol: usuariosApp.rol,
      activo: usuariosApp.activo,
      password_hash: usuariosApp.password_hash,
    })
    .from(usuariosApp)
    .where(eq(usuariosApp.id, id));
  return u ?? null;
}

export async function porId(id: string, bd: BD = db): Promise<UsuarioPublico | null> {
  const [u] = await bd.select(CAMPOS_PUBLICOS).from(usuariosApp).where(eq(usuariosApp.id, id));
  return (u as UsuarioPublico | undefined) ?? null;
}

export async function marcarAcceso(id: string, bd: BD = db): Promise<void> {
  await bd
    .update(usuariosApp)
    .set({ ultimo_acceso: sql`clock_timestamp()` })
    .where(eq(usuariosApp.id, id));
}
