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

/**
 * Los tiempos máximos, y por qué son estos tres y no otros.
 *
 * `connectionTimeoutMillis` cubre **conectar**. Es lo que salva el caso de la
 * base apagada. No cubre nada de lo que pase después: con la base viva pero
 * bloqueada —un `VACUUM FULL`, una migración larga, un `LOCK TABLE` olvidado—
 * la conexión se establece sin problema y la consulta se queda esperando.
 *
 * Para eso van los otros dos, y van **en Postgres**, no en el cliente.
 *
 * `pg` ofrece un `query_timeout` propio, pero solo deja de esperar: **la
 * consulta sigue corriendo en el servidor**, con su bloqueo y su CPU. Bajo un
 * `LOCK TABLE` eso libera al navegador y no libera la base, así que las
 * conexiones del pool se van apilando en espera hasta agotarlo, y la
 * aplicación acaba caída igual — solo que con otro síntoma y sin nada en los
 * registros de Postgres. Un timeout que no cancela el trabajo no es un
 * timeout, es mirar hacia otro lado.
 *
 * `statement_timeout` sí lo cancela: Postgres aborta la consulta, devuelve
 * error 57014 y la conexión queda libre para la siguiente petición.
 *
 * Y `lock_timeout` aparte, más corto, porque son cosas distintas. Esperar por
 * un bloqueo no avanza nunca: o lo consigues pronto o el que lo tiene va para
 * largo. Con solo `statement_timeout`, cada petición contra una tabla
 * bloqueada tardaría los 15 s completos en rendirse.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  // Se aplican al abrir cada conexión del pool, así que valen para todo el que
  // pase por aquí. Los trabajos largos —importador, migraciones— los levantan
  // con SET LOCAL dentro de su propia transacción.
  options: '-c statement_timeout=15000 -c lock_timeout=3000',
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

/**
 * La base **o** una transacción abierta sobre ella.
 *
 * `BD` a secas no vale para un repositorio que quiera correr dentro de una
 * transacción ajena: el objeto que drizzle pasa al callback de `transaction()`
 * no tiene `$client`, así que no es asignable a `typeof db`. Sin este tipo, la
 * única forma de reusar un repositorio desde dentro de una transacción es
 * copiar su cuerpo, y una copia de un INSERT de auditoría es una copia que se
 * queda sin actualizar.
 */
export type Ejecutor = BD | Parameters<Parameters<BD['transaction']>[0]>[0];

export { esquema };
