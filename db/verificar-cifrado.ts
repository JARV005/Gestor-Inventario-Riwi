/**
 * ¿La `ENCRYPTION_KEY` de este servidor descifra lo que hay en la base?
 *
 *   node dist/herramientas/verificar-cifrado.cjs
 *
 * Existe para `db/restaurar.sh`, que es donde importa: una base restaurada con
 * la clave equivocada devuelve `bios_password` y las keys de licencia como
 * bytes ilegibles, y `pg_restore` termina en verde igualmente. La base parece
 * completa y sus secretos no se pueden leer.
 *
 * Reusa `comprobarClaveDeCifrado`, la misma que corre al arrancar el servidor:
 * escribir aquí un segundo desciframiento sería un segundo sitio donde
 * equivocarse, y podría equivocarse distinto.
 *
 * **Cero filas cifradas hace fallar la comprobación, no pasarla.** Sin nada que
 * descifrar no hay nada comprobado, y un verde de vacío en la prueba de un
 * respaldo es exactamente lo que no queremos.
 *
 * ---
 *
 * CADA CAUSA TIENE SU CÓDIGO DE SALIDA
 *
 * La primera versión salía con 1 pasara lo que pasara, y `db/restaurar.sh`
 * traducía ese 1 a «la base volvió pero sus secretos son ilegibles». Con la
 * base caída o la tabla bloqueada, ese mensaje es falso: no se sabe si la
 * clave sirve. Es la distinción que `exigirClaveDeCifradoValida` ya hace al
 * arrancar el servidor —«esto está mal» no es «no pude comprobarlo»— y que
 * aquí se perdía al colapsar todo en un código.
 *
 *   0  la clave descifra
 *   1  la clave NO descifra          ← un hecho
 *   2  no hay ni una fila cifrada    ← no se comprobó nada
 *   3  no se pudo comprobar          ← ausencia de información
 */
import 'dotenv/config';

import { comprobarClaveDeCifrado, ClaveDeCifradoInvalida } from './comprobar-cifrado.js';
import { pool } from './cliente.js';

export const SALIDA = {
  correcta: 0,
  claveMala: 1,
  sinDatos: 2,
  noSePudo: 3,
} as const;

async function main(): Promise<number> {
  try {
    const r = await comprobarClaveDeCifrado();

    if (r.estado === 'sin-datos') {
      console.error('[cifrado] la base no tiene ni una fila cifrada.');
      console.error('          No hay nada que descifrar: esta prueba no comprueba nada.');
      return SALIDA.sinDatos;
    }

    console.log(`[cifrado] correcta: ${r.filasCifradas} filas cifradas se leen bien.`);
    return SALIDA.correcta;
  } catch (e) {
    if (e instanceof ClaveDeCifradoInvalida) {
      // El mensaje de la excepción ya está redactado para leerse, y no lleva la
      // clave ni el valor. Se imprime ese y no la traza: `console.error(e)`
      // volcaba veinte líneas de pila por encima de él.
      console.error(`[cifrado] ${e.message}`);
      return SALIDA.claveMala;
    }
    // No se llegó a la base, o estaba ocupada. Decir «los secretos son
    // ilegibles» aquí sería inventar un diagnóstico.
    console.error(`[cifrado] NO SE PUDO COMPROBAR: ${e instanceof Error ? e.message : String(e)}`);
    console.error('          No se sabe si la clave sirve. Repetir cuando la base responda.');
    return SALIDA.noSePudo;
  }
}

main()
  .then(async (codigo) => {
    await pool.end().catch(() => {});
    process.exit(codigo);
  })
  .catch(async (e) => {
    // Aquí solo se llega si falla algo fuera de `main`, que ya captura todo.
    console.error(`[cifrado] fallo inesperado: ${e instanceof Error ? e.message : String(e)}`);
    await pool.end().catch(() => {});
    process.exit(SALIDA.noSePudo);
  });
