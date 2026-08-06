/**
 * Arnés de los tests. HTTP real contra el servidor real.
 *
 * Nada de `supertest` ni de inyectar objetos de sesión: lo que hay que
 * comprobar es la cookie y el store en Postgres. Un arnés que permita fabricar
 * una sesión prueba el arnés.
 */

import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import bcrypt from 'bcryptjs';
import { eq, like, sql } from 'drizzle-orm';

import { db, pool } from '../db/cliente.js';
import { usuariosApp } from '../db/esquema.js';
import { crearApp } from '../server/app.js';

/** Prefijo de todo lo que los tests crean, para poder barrerlo después. */
export const PREFIJO = 'test-';

export function comprobarBaseDeTest(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.endsWith('_test')) {
    throw new Error(
      `Los tests crean y destruyen usuarios: DATABASE_URL debe apuntar a la base de test.\n` +
        `Apunta a: ${url || '(vacía)'}\n` +
        `Correr con: npm test  (que la fija desde DATABASE_URL_TEST)`,
    );
  }
}

export interface Servidor {
  url: string;
  /** Para el test que recorre el router buscando rutas sin permiso declarado. */
  app: ReturnType<typeof crearApp>;
  cerrar: () => Promise<void>;
}

export async function arrancar(): Promise<Servidor> {
  const app = crearApp();
  const servidor: Server = createServer(app);
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    app,
    cerrar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
  };
}

export interface Respuesta {
  estado: number;
  cuerpo: unknown;
  texto: string;
  cabeceras: Headers;
}

/**
 * Cliente HTTP con tarro de cookies propio. Cada instancia es un "navegador"
 * distinto, que es lo que permite probar la sesión de otro usuario.
 */
export class Cliente {
  private cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  /** La cookie tal cual se enviaría. Los tests la manipulan a propósito. */
  get cookieCruda(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  fijarCookie(nombre: string, valor: string): void {
    this.cookies.set(nombre, valor);
  }

  olvidarCookies(): void {
    this.cookies.clear();
  }

  async pedir(
    metodo: string,
    camino: string,
    opciones: { cuerpo?: unknown; cookie?: string; cabeceras?: Record<string, string> } = {},
  ): Promise<Respuesta> {
    const cabeceras: Record<string, string> = { ...opciones.cabeceras };
    const cookie = opciones.cookie ?? this.cookieCruda;
    if (cookie) cabeceras.Cookie = cookie;
    if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';

    const r = await fetch(`${this.base}${camino}`, {
      method: metodo,
      headers: cabeceras,
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      redirect: 'manual',
    });

    for (const linea of r.headers.getSetCookie()) {
      const [par] = linea.split(';');
      const idx = par.indexOf('=');
      if (idx > 0) this.cookies.set(par.slice(0, idx).trim(), par.slice(idx + 1).trim());
    }

    const texto = await r.text();
    let cuerpo: unknown = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = texto;
    }
    return { estado: r.status, cuerpo, texto, cabeceras: r.headers };
  }

  get = (c: string, o?: { cookie?: string }) => this.pedir('GET', c, o);
  post = (c: string, cuerpo?: unknown, o?: { cookie?: string }) =>
    this.pedir('POST', c, { cuerpo, ...o });
  patch = (c: string, cuerpo?: unknown, o?: { cookie?: string }) =>
    this.pedir('PATCH', c, { cuerpo, ...o });

  async entrar(email: string, password: string): Promise<Respuesta> {
    return this.post('/api/auth/login', { email, password });
  }
}

// ---------------------------------------------------------------------------
// Usuarios de prueba
// ---------------------------------------------------------------------------

export interface UsuarioDePrueba {
  id: string;
  email: string;
  password: string;
  rol: 'admin' | 'tecnico';
}

export async function crearUsuario(opciones: {
  sufijo: string;
  password?: string;
  rol?: 'admin' | 'tecnico';
  activo?: boolean;
  /** `true` deja `password_hash` en NULL, como el usuario de sistema. */
  sinHash?: boolean;
}): Promise<UsuarioDePrueba> {
  const email = `${PREFIJO}${opciones.sufijo}@bbl.local`;
  const password = opciones.password ?? 'contrasena-de-prueba-9876';
  const hash = opciones.sinHash ? null : await bcrypt.hash(password, 12);

  const [fila] = await db
    .insert(usuariosApp)
    .values({
      email,
      nombre: `Prueba ${opciones.sufijo}`,
      rol: opciones.rol ?? 'tecnico',
      activo: opciones.activo ?? true,
      password_hash: hash,
    })
    .onConflictDoUpdate({
      target: usuariosApp.email,
      set: {
        password_hash: hash,
        activo: opciones.activo ?? true,
        rol: opciones.rol ?? 'tecnico',
      },
    })
    .returning({ id: usuariosApp.id });

  return { id: fila.id, email, password, rol: opciones.rol ?? 'tecnico' };
}

export async function cambiarPassword(id: string, nueva: string): Promise<void> {
  await db
    .update(usuariosApp)
    .set({ password_hash: await bcrypt.hash(nueva, 12) })
    .where(eq(usuariosApp.id, id));
}

export async function desactivar(id: string): Promise<void> {
  await db.update(usuariosApp).set({ activo: false }).where(eq(usuariosApp.id, id));
}

/** Envejece la fila del store para simular una sesión caducada. */
export async function caducarSesiones(): Promise<void> {
  await db.execute(sql`UPDATE session SET expire = now() - interval '1 day'`);
}

export async function contarSesiones(): Promise<number> {
  const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM session`);
  return Number(r.rows[0]?.n ?? 0);
}

/** Solo el store. Separado de `limpiar` porque un test que quiera contar
 *  sesiones desde cero no puede llevarse por delante los usuarios compartidos
 *  que creó el `before`. */
export async function limpiarSesiones(): Promise<void> {
  await db.execute(sql`DELETE FROM session`);
}

export async function limpiar(): Promise<void> {
  await db.delete(usuariosApp).where(like(usuariosApp.email, `${PREFIJO}%`));
  await limpiarSesiones();
}

export async function cerrarPool(): Promise<void> {
  await pool.end();
}
