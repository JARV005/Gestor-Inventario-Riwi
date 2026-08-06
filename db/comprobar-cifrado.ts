/**
 * Comprobación de arranque: que `ENCRYPTION_KEY` es la clave con la que se
 * cifraron los datos que hay en la base.
 *
 * ---
 *
 * El modo de fallo que esto ataja es silencioso, y ya ocurrió una vez: el
 * `.env` se rellenó con los valores de plantilla y `ENCRYPTION_KEY` quedó
 * vacía. Nada avisó. El servidor habría arrancado igual, los listados habrían
 * funcionado igual —los campos cifrados no salen en ninguno— y el problema no
 * habría aparecido hasta que alguien pidiera una clave BIOS. Para entonces
 * podría haber pasado cualquier cosa, incluida una reimportación que recifrase
 * las filas con la clave equivocada.
 *
 * AES-GCM autentica: descifrar con la clave incorrecta no devuelve basura, falla.
 * Eso convierte "¿es esta la clave buena?" en una pregunta contestable, y esta
 * función la hace sobre una fila real antes de aceptar peticiones.
 *
 * Vale más no arrancar que arrancar con los datos ilegibles y enterarse en
 * tres meses.
 */

import { sql } from 'drizzle-orm';

import { db, type BD } from './cliente.js';
import { descifrar } from './cifrado.js';

export class ClaveDeCifradoInvalida extends Error {}

export type ResultadoComprobacion =
  | { estado: 'ok'; filasCifradas: number }
  | { estado: 'sin-datos' };

/**
 * @throws {ClaveDeCifradoInvalida} si hay datos cifrados y no se pueden leer.
 */
export async function comprobarClaveDeCifrado(bd: BD = db): Promise<ResultadoComprobacion> {
  const conteo = await bd.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM equipos
        WHERE equipos.bios_password_cifrado IS NOT NULL`,
  );
  const filasCifradas = Number(conteo.rows[0]?.n ?? 0);

  // Base recién migrada, o la de tests: no hay nada que comprobar todavía. No
  // es un error, pero tampoco es una comprobación superada — quien llama debe
  // poder distinguirlo.
  if (filasCifradas === 0) return { estado: 'sin-datos' };

  const muestra = await bd.execute<{ bios: Buffer }>(
    sql`SELECT equipos.bios_password_cifrado AS bios FROM equipos
        WHERE equipos.bios_password_cifrado IS NOT NULL
        ORDER BY equipos.id LIMIT 1`,
  );

  try {
    const valor = descifrar(muestra.rows[0].bios);
    // Un descifrado que devuelve vacío no es un descifrado correcto: el
    // importador nunca cifra la cadena vacía, la deja en NULL.
    if (!valor) throw new Error('el descifrado devolvió un valor vacío');
  } catch (causa) {
    // El mensaje no lleva el valor, ni la clave, ni un fragmento de ninguno.
    throw new ClaveDeCifradoInvalida(
      'ENCRYPTION_KEY incorrecta o cambiada; los datos cifrados no son legibles con esta clave.\n' +
        `Hay ${filasCifradas} filas cifradas en la base y la primera no se pudo descifrar.\n` +
        'No se toca nada: recuperar la clave original antes de volver a arrancar.\n' +
        'Si la clave se perdió, esos valores son irrecuperables por diseño — ver docs/despliegue.md.',
      { cause: causa },
    );
  }

  return { estado: 'ok', filasCifradas };
}

/**
 * Envoltorio para los puntos de arranque.
 *
 * Distingue dos cosas que la primera versión confundía: **«la clave está mal»
 * no es lo mismo que «no pude comprobarlo»**.
 *
 * La primera versión relanzaba cualquier error que no fuera
 * `ClaveDeCifradoInvalida`, así que una tabla bloqueada por otra sesión —o la
 * base apagada— mataba el arranque con una traza. Se descubrió provocando un
 * `LOCK TABLE equipos` para otra prueba: el servidor dejó de arrancar por una
 * condición transitoria que se resuelve sola en segundos.
 *
 * Es el mismo error que ya cometió el pool: convertir un problema pasajero de
 * la base en la muerte del proceso. Solo se aborta cuando sabemos que la clave
 * no sirve.
 */
export async function exigirClaveDeCifradoValida(): Promise<void> {
  try {
    const r = await comprobarClaveDeCifrado();
    if (r.estado === 'sin-datos') {
      console.log('[cifrado] no hay filas cifradas todavía: nada que comprobar.');
    } else {
      console.log(`[cifrado] clave correcta (${r.filasCifradas} filas cifradas).`);
    }
  } catch (e) {
    if (e instanceof ClaveDeCifradoInvalida) {
      console.error(`\n${e.message}\n`);
      process.exit(1);
    }
    // No se pudo llegar a la base, o estaba ocupada. No sabemos si la clave
    // sirve, y no saberlo no es motivo para no arrancar: las peticiones
    // fallarán solas mientras dure, y esto se vuelve a comprobar al reiniciar.
    const motivo = e instanceof Error ? e.message : String(e);
    console.warn(
      `[cifrado] NO SE PUDO COMPROBAR la clave: ${motivo}\n` +
        '[cifrado] El servidor arranca igual. Si la base estaba caída u ocupada, reiniciar\n' +
        '[cifrado] cuando se recupere para que la comprobación llegue a hacerse.',
    );
  }
}
