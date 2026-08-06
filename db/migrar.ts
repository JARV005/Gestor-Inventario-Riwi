/**
 * Aplica las migraciones pendientes. `npm run migrate`.
 *
 * Drizzle lleva la cuenta de lo aplicado en `drizzle.__drizzle_migrations`, así
 * que correrlo dos veces seguidas es inofensivo: la segunda no hace nada.
 */

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db, pool } from './cliente.js';

async function main() {
  // Crear un índice sobre una tabla grande puede pasar de los 15 s que trae el
  // pool por defecto, y una migración cortada a medias es justo lo que no
  // queremos. Aquí no hay usuario esperando: que tarde lo que tenga que tardar.
  await db.execute(sql`SET statement_timeout = 0`);
  await db.execute(sql`SET lock_timeout = 0`);

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
