/**
 * Punto de entrada de los tests. `npm test`.
 *
 * Este fichero tiene UN SOLO import estático, y es a propósito.
 *
 * `db/cliente.ts` lee `DATABASE_URL` al cargarse y crea el pool ahí mismo. Los
 * imports estáticos se evalúan antes que cualquier línea de código, así que si
 * aquí hubiera un `import { db } from '../db/cliente.js'`, el pool apuntaría a
 * la base de desarrollo antes de que diera tiempo a redirigirlo — y los tests,
 * que crean y destruyen usuarios, la usarían.
 *
 * De ahí la forma rara: fijar la variable primero, importar después y en
 * dinámico. La comprobación de `ayuda.ts` es la red por si esto se rompe.
 */

import 'dotenv/config';

if (!process.env.DATABASE_URL_TEST) {
  throw new Error('Falta DATABASE_URL_TEST en .env. Correr antes: npm run test:preparar');
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

// El límite por defecto son 10 intentos por cuarto de hora, y la batería hace
// más logins que eso. El test que comprueba el rate limit fija el suyo propio.
process.env.LOGIN_LIMITE ??= '1000';

await import('./auth.test.js');
await import('./api.test.js');
await import('./movimientos.test.js');
await import('./equipos.test.js');
await import('./actas.test.js');
await import('./mantenimiento.test.js');
await import('./licencias.test.js');

// El pool se cierra UNA vez y aquí, después de importar todas las suites.
//
// Estaba en el `after` de cada fichero, y con dos ficheros eso se rompe: el
// primero que termina cierra el pool —que es un módulo compartido— y las
// limpiezas de los demás fallan con "Failed query". El hook se registra el
// último a propósito, para que corra el último.
const { after } = await import('node:test');
const { cerrarPool } = await import('./ayuda.js');
after(() => cerrarPool());
