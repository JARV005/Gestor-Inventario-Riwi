/**
 * Qué se puede hacer con un equipo según en qué estado esté.
 *
 * ============================================================================
 * ESTE ES EL ÚNICO SITIO DONDE VIVEN LAS TRANSICIONES.
 * ============================================================================
 *
 * La alternativa —un `if (equipo.estado !== 'Disponible') throw…` dentro de
 * cada endpoint— reparte la misma regla por seis ficheros. Cuando alguien
 * añada un estado, cinco de los seis se acordarán y uno no, y el que no lo
 * haga no dará error: dejará pasar una transición que nadie decidió permitir.
 * Aquí la tabla se lee entera de un vistazo y el compilador obliga a cubrir
 * las seis operaciones.
 *
 * Lo que esta tabla NO decide: que un equipo `Asignado` tenga responsable y
 * uno `Disponible` no. Eso lo impone `equipos_asignado_implica_empleado` en la
 * base, y es correcto que se compruebe dos veces — aquí para dar un mensaje
 * útil, allí para que sea verdad aunque alguien escriba un INSERT a mano.
 */

import type { estadoEquipo, tipoMovimiento } from './esquema.js';

export type EstadoEquipo = (typeof estadoEquipo.enumValues)[number];
export type TipoMovimiento = (typeof tipoMovimiento.enumValues)[number];

export type Operacion =
  | 'asignar'
  | 'devolver'
  | 'trasladar'
  | 'baja'
  | 'reservar'
  | 'liberar';

export interface Transicion {
  /** Estados desde los que la operación es legal. */
  desde: readonly EstadoEquipo[];
  /**
   * Estado resultante, o `null` si la operación **no cambia el estado**.
   *
   * Solo `trasladar` es `null`, y es la consecuencia directa de D13: mover un
   * equipo de sede no cambia de quién es. Un portátil asignado a alguien sigue
   * asignado a esa persona mientras viaja hacia ella.
   */
  hacia: EstadoEquipo | null;
  movimiento: TipoMovimiento;
  /** Qué dato exige la operación además del equipo. */
  requiere: 'empleado' | 'sede' | null;
  /** Para el 409. Explica la regla, no el nombre de la operación. */
  explicacion: string;
}

export const TRANSICIONES: Record<Operacion, Transicion> = {
  asignar: {
    desde: ['Disponible', 'Reservado'],
    hacia: 'Asignado',
    movimiento: 'Asignación',
    requiere: 'empleado',
    explicacion:
      'Solo se puede asignar un equipo que esté disponible o reservado. Si ya está asignado a otra persona, primero hay que devolverlo.',
  },

  devolver: {
    desde: ['Asignado'],
    hacia: 'Disponible',
    movimiento: 'Devolución',
    requiere: null,
    explicacion: 'Solo se puede devolver un equipo que esté asignado a alguien.',
  },

  /**
   * No cambia el estado (D13). Lo único que escribe es el movimiento abierto;
   * `equipos.sede_id` se mueve al confirmarlo.
   *
   * `De baja` queda fuera: trasladar chatarra entre sedes no es una operación
   * de inventario, y si hace falta mover físicamente algo dado de baja, eso no
   * es un traslado de este sistema.
   */
  trasladar: {
    desde: ['Disponible', 'Asignado', 'Reservado', 'En mantenimiento'],
    hacia: null,
    movimiento: 'Traslado',
    requiere: 'sede',
    explicacion: 'Un equipo dado de baja no se traslada.',
  },

  /**
   * `Asignado` queda fuera a propósito: dar de baja un equipo que alguien
   * tiene en la mano deja a esa persona con un activo que el inventario cree
   * destruido. Primero se devuelve.
   */
  baja: {
    desde: ['Disponible', 'Reservado', 'En mantenimiento'],
    hacia: 'De baja',
    movimiento: 'Baja',
    requiere: null,
    explicacion:
      'Un equipo asignado no se puede dar de baja: primero hay que devolverlo, para que quede constancia de que la persona ya no lo tiene.',
  },

  reservar: {
    desde: ['Disponible'],
    hacia: 'Reservado',
    movimiento: 'Reserva',
    requiere: null,
    explicacion: 'Solo se puede reservar un equipo disponible.',
  },

  liberar: {
    desde: ['Reservado'],
    hacia: 'Disponible',
    movimiento: 'Liberación',
    requiere: null,
    explicacion:
      'Solo se libera un equipo reservado. Si está asignado a alguien, la operación es devolverlo.',
  },
};

/**
 * Estados a los que **no llega ninguna de las seis operaciones**.
 *
 * `En mantenimiento` se alcanza por el flujo de partes de mantenimiento, que
 * hoy es de solo lectura (`/api/mantenimientos`) y se completa en la etapa 6
 * con `Envío a mantenimiento` y `Retorno de mantenimiento`, que ya están en el
 * enum desde la 0000.
 *
 * Está escrito aquí y no en un comentario suelto porque es exactamente el tipo
 * de hueco que se descubre tarde: `Reservado` fue igual —estado sin puerta de
 * entrada desde la 0000— y nadie lo vio hasta la etapa 5 (D17).
 */
export const ESTADOS_SIN_OPERACION: readonly EstadoEquipo[] = ['En mantenimiento'];

/** Qué se puede hacer ahora mismo con un equipo en este estado. */
export function operacionesDesde(estado: EstadoEquipo): Operacion[] {
  return (Object.keys(TRANSICIONES) as Operacion[]).filter((op) =>
    TRANSICIONES[op].desde.includes(estado),
  );
}

export class TransicionIlegal extends Error {
  constructor(
    readonly operacion: Operacion,
    readonly estadoActual: EstadoEquipo,
    readonly explicacion: string,
    readonly legalesDesde: readonly EstadoEquipo[],
    readonly alternativas: Operacion[],
  ) {
    super(explicacion);
  }
}

/**
 * @throws {TransicionIlegal} si la operación no se puede hacer desde ese estado.
 */
export function comprobarTransicion(operacion: Operacion, estadoActual: EstadoEquipo): Transicion {
  const t = TRANSICIONES[operacion];
  if (!t.desde.includes(estadoActual)) {
    throw new TransicionIlegal(
      operacion,
      estadoActual,
      t.explicacion,
      t.desde,
      operacionesDesde(estadoActual),
    );
  }
  return t;
}
