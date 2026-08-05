/**
 * Aplica las migraciones pendientes. `npm run migrate`.
 *
 * Drizzle lleva la cuenta de lo aplicado en `drizzle.__drizzle_migrations`, así
 * que correrlo dos veces seguidas es inofensivo: la segunda no hace nada.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db, pool } from './cliente.js';

async function main() {
  await migrate(db, { migrationsFolder: './db/migraciones' });
  console.log('Migraciones al día.');
}

main()
  .catch((error) => {
    console.error('La migración falló. La BD queda como estaba.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
