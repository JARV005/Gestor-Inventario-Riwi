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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Sin esto, una petición contra una BD apagada se queda esperando hasta el
  // timeout del sistema operativo: la persona ve el spinner y no un error.
  connectionTimeoutMillis: 5_000,
});

/**
 * Sin este manejador, apagar Postgres no degrada la aplicación: **la mata**.
 *
 * `pg-pool` emite un evento `error` sobre los clientes ociosos cuando la
 * conexión se cae —por ejemplo `terminating connection due to administrator
 * command`, que es lo que manda Postgres al pararse— y un evento `error` de
 * EventEmitter sin escuchar es una excepción no capturada: Node termina el
 * proceso.
 *
 * Se descubrió apagando el contenedor con la aplicación abierta. El servidor
 * entero se caía, así que el estado de error que la interfaz sabe pintar no
 * llegaba a verse nunca: el navegador recibía una conexión rechazada.
 *
 * El pool descarta el cliente roto y abre otro cuando vuelva a haber BD; lo
 * único que hay que hacer aquí es no morirse.
 */
pool.on('error', (err) => {
  console.error('[bd] cliente del pool caído, se descarta:', err.message);
});

export const db = drizzle(pool, { schema: esquema });

export type BD = typeof db;
export { esquema };
