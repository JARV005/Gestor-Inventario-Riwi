/**
 * Sesión de servidor. §5.4: cookie `httpOnly` + `secure` + `sameSite=strict`,
 * estado en Postgres. Nada de JWT en localStorage.
 */

import { createHash, randomBytes } from 'node:crypto';

import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { RequestHandler } from 'express';

import { pool } from '../db/cliente.js';

export const NOMBRE_COOKIE = 'inventario.sid';

/** Ocho horas: una jornada. Se renueva en cada petición (`rolling`). */
const DURACION_MS = 8 * 60 * 60 * 1000;

/**
 * Lo que se guarda dentro de la sesión. Deliberadamente mínimo: el rol NO va
 * aquí. Si el rol viviera en la sesión, degradar a alguien de admin a tecnico
 * no tendría efecto hasta que cerrase sesión. Se lee de la BD en cada petición.
 */
declare module 'express-session' {
  interface SessionData {
    usuario?: {
      id: string;
      /** Ver `huellaCredenciales`. */
      huella: string;
    };
  }
}

/**
 * Huella de las credenciales: SHA-256 del hash bcrypt, truncado.
 *
 * Sirve para que **cambiar la contraseña mate las sesiones abiertas**. Si
 * alguien cambia su contraseña porque sospecha que se la robaron, dejar viva la
 * sesión del atacante anula el gesto entero.
 *
 * Se compara en cada petición contra el `password_hash` actual: si cambió, la
 * huella deja de cuadrar y la sesión muere. No hace falta ir a buscar las filas
 * del store ni una columna nueva.
 *
 * Es un derivado y no el hash: el store de sesiones es una tabla más de la BD y
 * no tiene por qué contener material de credenciales.
 */
export function huellaCredenciales(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 32);
}

function secretoSesion(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') {
    // En producción no se improvisa: un secreto generado al arrancar invalida
    // todas las sesiones en cada despliegue y difiere entre instancias.
    throw new Error('Falta SESSION_SECRET (mínimo 32 caracteres) en producción.');
  }
  return randomBytes(32).toString('hex');
}

export function middlewareSesion(): RequestHandler {
  const Store = connectPgSimple(session);

  return session({
    name: NOMBRE_COOKIE,
    secret: secretoSesion(),
    store: new Store({ pool, tableName: 'session', createTableIfMissing: false }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      // `secure` impide que la cookie viaje por HTTP plano, y desarrollo es
      // http://localhost: con `true` incondicional no se puede ni iniciar
      // sesión en local. La excepción está acotada a no-producción, y hay un
      // test que afirma que con NODE_ENV=production los tres flags salen
      // puestos — para que esto no acabe siendo un `false` olvidado.
      secure: process.env.NODE_ENV === 'production',
      maxAge: DURACION_MS,
    },
  });
}
