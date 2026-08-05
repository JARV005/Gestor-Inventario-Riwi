/**
 * Único punto de conexión a Postgres. Todo lo demás — servidor, migraciones,
 * semillas, importador — pasa por aquí y no crea Pools propios.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as esquema from './esquema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL. Copiar .env.example a .env y rellenarla.');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema: esquema });

export type BD = typeof db;
export { esquema };
