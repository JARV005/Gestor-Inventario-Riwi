/**
 * Cifrado en reposo de los dos campos del §5: `bios_password` y
 * `licencia_serial`. AES-256-GCM, clave en `ENCRYPTION_KEY`.
 *
 * GCM y no CBC porque autentica: si alguien altera un byte del `bytea` en la
 * BD, el descifrado falla en vez de devolver basura silenciosamente.
 *
 * Formato del bytea, todo en un solo campo:
 *
 *     [ IV 12 bytes ][ authTag 16 bytes ][ texto cifrado, longitud variable ]
 *
 * El IV va en claro y es aleatorio por fila — no es secreto, pero no puede
 * repetirse con la misma clave, y por eso no se deriva ni se reutiliza.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const BYTES_IV = 12;
const BYTES_TAG = 16;
const BYTES_CLAVE = 32;

let cacheClave: Buffer | null = null;

function clave(): Buffer {
  if (cacheClave) return cacheClave;
  const bruta = process.env.ENCRYPTION_KEY;
  if (!bruta) {
    throw new Error(
      'Falta ENCRYPTION_KEY. Generar una con:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const b = Buffer.from(bruta, 'base64');
  if (b.length !== BYTES_CLAVE) {
    // Sin esta comprobación, una clave corta pasaría por buena hasta que
    // createCipheriv fallara con un mensaje que no dice qué hacer.
    throw new Error(
      `ENCRYPTION_KEY debe ser de ${BYTES_CLAVE} bytes en base64; llegaron ${b.length}.`,
    );
  }
  cacheClave = b;
  return b;
}

/** Devuelve NULL para entrada vacía: un campo sin dato no se cifra, se deja vacío. */
export function cifrar(texto: string | null | undefined): Buffer | null {
  if (texto === null || texto === undefined || texto === '') return null;
  const iv = randomBytes(BYTES_IV);
  const cifrador = createCipheriv(ALGORITMO, clave(), iv);
  const datos = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return Buffer.concat([iv, cifrador.getAuthTag(), datos]);
}

export function descifrar(blob: Buffer | null | undefined): string | null {
  if (!blob || blob.length === 0) return null;
  if (blob.length < BYTES_IV + BYTES_TAG) {
    throw new Error('Valor cifrado demasiado corto: no cabe ni el IV y el tag.');
  }
  const iv = blob.subarray(0, BYTES_IV);
  const tag = blob.subarray(BYTES_IV, BYTES_IV + BYTES_TAG);
  const datos = blob.subarray(BYTES_IV + BYTES_TAG);
  const descifrador = createDecipheriv(ALGORITMO, clave(), iv);
  descifrador.setAuthTag(tag);
  return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString('utf8');
}
