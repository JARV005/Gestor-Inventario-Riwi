/**
 * Quién puede llamar a qué. **Se aplica en el servidor.**
 *
 * El frontend puede ocultar botones, pero eso es cosmético: quien tenga una
 * sesión de `tecnico` y `curl` puede llamar a cualquier endpoint, así que cada
 * uno comprueba el rol por su cuenta.
 *
 * ---
 *
 * El problema que resuelve este fichero no es declarar permisos —eso se puede
 * hacer en cada ruta— sino que **la superficie quede cerrada**. Lo que hay que
 * garantizar en auth no es que acepte lo correcto, sino que rechace todo lo
 * demás, y "todo lo demás" crece cada vez que alguien añade un endpoint.
 *
 * Por eso las rutas no se registran con `app.get(...)` sino con `ruta(...)`,
 * que exige el permiso como argumento obligatorio: no se puede añadir un
 * endpoint sin decidir quién entra. Y como el registro queda anotado, dos
 * tests recorren la lista entera sin que nadie los escriba caso a caso:
 *
 *   - sin sesión        -> 401 en todas
 *   - rol insuficiente  -> 403 en las restringidas
 *
 * Un tercer test recorre el router de Express y comprueba que no hay ninguna
 * ruta que se haya saltado este helper.
 */

import type { Express, RequestHandler } from 'express';

export type Rol = 'admin' | 'tecnico';

/**
 * `admin` es el único rol que restringe endpoints. No existe un permiso
 * `tecnico` porque no hay nada que `tecnico` pueda hacer y `admin` no; añadirlo
 * como valor posible invitaría a escribir una jerarquía que hoy no existe.
 */
export type Permiso = 'publico' | 'autenticado' | 'admin';

export type Metodo = 'get' | 'post' | 'patch' | 'delete';

export interface RutaRegistrada {
  metodo: Metodo;
  ruta: string;
  permiso: Permiso;
}

const registro: RutaRegistrada[] = [];

/** Lo que ven los tests. Copia: nadie de fuera muta el registro. */
export const rutasRegistradas = (): RutaRegistrada[] => registro.map((r) => ({ ...r }));

export const clave = (metodo: string, ruta: string) => `${metodo.toUpperCase()} ${ruta}`;

/**
 * Registra una ruta con su permiso. El guardián se antepone a los manejadores,
 * así que no hay forma de registrar la ruta y olvidar el control.
 */
export function ruta(
  app: Express,
  metodo: Metodo,
  camino: string,
  permiso: Permiso,
  guardian: (p: Permiso) => RequestHandler,
  ...manejadores: RequestHandler[]
): void {
  const yaEsta = registro.find((r) => r.metodo === metodo && r.ruta === camino);
  if (yaEsta) {
    throw new Error(`Ruta duplicada: ${clave(metodo, camino)}`);
  }
  registro.push({ metodo, ruta: camino, permiso });
  app[metodo](camino, guardian(permiso), ...manejadores);
}

/** Solo para los tests: el registro es global y se acumula entre arranques. */
export function limpiarRegistro(): void {
  registro.length = 0;
}
