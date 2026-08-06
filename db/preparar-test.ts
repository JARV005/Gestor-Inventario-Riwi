/**
 * Deja `inventario_bbl_test` lista: la crea si no existe, migra y siembra.
 * `npm run test:preparar`
 *
 * **No importa el Excel.** Los tests quieren un conjunto de usuarios que ellos
 * controlan; las 186 filas se quedan en la BD de desarrollo, donde
 * `verificar-datos.sql` las necesita.
 *
 * Migrar y sembrar se hacen lanzando los scripts de siempre con `DATABASE_URL`
 * sobreescrita, en vez de duplicando su lógica aquí. Como proceso hijo y no con
 * un `process.env` mutado antes de un `import`, porque `db/cliente.ts` lee la
 * variable al cargarse y el orden de los imports es demasiado frágil para
 * apoyarse en él.
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';

import { Client } from 'pg';

const urlTest = process.env.DATABASE_URL_TEST;
const urlDesarrollo = process.env.DATABASE_URL;

if (!urlTest) throw new Error('Falta DATABASE_URL_TEST en .env');
if (!urlDesarrollo) throw new Error('Falta DATABASE_URL en .env');

const nombreTest = new URL(urlTest).pathname.replace(/^\//, '');
if (!nombreTest.endsWith('_test')) {
  // Salvaguarda tonta y barata: este script borra y recrea sin preguntar, y
  // apuntarlo por error a la BD de desarrollo costaría las 186 filas.
  throw new Error(`DATABASE_URL_TEST debe apuntar a una base terminada en "_test"; apunta a "${nombreTest}".`);
}

async function main() {
  // Para crear una base hay que estar conectado a otra.
  const admin = new Client({ connectionString: urlDesarrollo });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    nombreTest,
  ]);
  if (rowCount === 0) {
    // Sin TEMPLATE: hereda de template1, que initdb creó con la colación ICU
    // es-CO. Con TEMPLATE de la base de desarrollo fallaría si hay conexiones
    // abiertas, que las hay siempre.
    await admin.query(`CREATE DATABASE "${nombreTest}"`);
    console.log(`Base ${nombreTest} creada.`);
  } else {
    console.log(`Base ${nombreTest} ya existía.`);
  }
  await admin.end();

  for (const script of ['db/migrar.ts', 'db/semillas.ts']) {
    const r = spawnSync('npx', ['tsx', script], {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, DATABASE_URL: urlTest },
    });
    if (r.status !== 0) throw new Error(`Falló ${script} contra la base de test.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
