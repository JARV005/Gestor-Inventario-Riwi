/**
 * Escrituras en `auditoria`. §5.2: todo desciframiento de una clave BIOS deja
 * rastro, con quién y desde dónde.
 *
 * `antes` y `despues` admiten JSON arbitrario, así que quien llame pasa solo
 * campos elegidos: volcar la fila entera de `equipos` metería aquí los dos
 * campos cifrados y convertiría la tabla de auditoría en la fuga que pretende
 * vigilar.
 */

import { db, type Ejecutor } from '../cliente.js';
import { auditoria } from '../esquema.js';

export async function registrar(
  entrada: {
    tabla: string;
    registro_id: string;
    accion: string;
    usuario_app_id: string | null;
    ip?: string | null;
    antes?: unknown;
    despues?: unknown;
  },
  bd: Ejecutor = db,
): Promise<void> {
  await bd.insert(auditoria).values({
    tabla: entrada.tabla,
    registro_id: entrada.registro_id,
    accion: entrada.accion,
    usuario_app_id: entrada.usuario_app_id,
    ip: entrada.ip ?? null,
    antes: entrada.antes ?? null,
    despues: entrada.despues ?? null,
  });
}
