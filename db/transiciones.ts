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
  | 'liberar'
  | 'enviar_mantenimiento'
  | 'retornar_mantenimiento'
  | 'prestar'
  | 'recuperar_prestamo'
  | 'reasignar';

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
  requiere: 'empleado' | 'sede' | 'prestatario' | null;
  /** Para el 409. Explica la regla, no el nombre de la operación. */
  explicacion: string;
  /**
   * El texto del botón. Vive aquí y no en el frontend a propósito: si la
   * interfaz tuviera su propia lista de operaciones con sus etiquetas, esa
   * lista sería una segunda tabla de transiciones que se desincroniza en
   * silencio — un botón para una operación retirada, o ninguno para una nueva.
   */
  etiqueta: string;
  /** `true` si la operación no se puede deshacer y conviene confirmarla. */
  irreversible?: boolean;
  /**
   * Quién dispara la operación.
   *
   * `directa` — hay un `POST /api/equipos/:id/<operacion>` y la interfaz pinta
   * un botón que lo llama.
   *
   * `parte` — la dispara el flujo de mantenimiento (abrir o cerrar un parte) y
   * **no existe endpoint suelto**. Sin este campo, la interfaz ofrecía el botón
   * igual y daba 404: `AccionesEquipo` pinta lo que venga en `por_estado`, y
   * `por_estado` sale de esta tabla. El bucle que registra las rutas también
   * lee este campo, así que «tiene endpoint» y «tiene botón» son el mismo
   * hecho escrito una vez.
   */
  disparo: 'directa' | 'parte';
  /**
   * Las operaciones que esta ejecuta en cadena, si es compuesta.
   *
   * Reasignar es `devolver` + `asignar`, y no un movimiento nuevo: quien tenía
   * el equipo lo devolvió y otra persona lo recibió. Son dos hechos y el
   * historial tiene que contarlos como dos, o la pregunta que justifica el
   * proyecto —«¿quién tenía el BBL-0301 en marzo?»— se queda sin la mitad de la
   * respuesta.
   *
   * Va como CAMPO y no como un `if` en el repositorio por lo mismo que
   * `disparo`: si la composición viviera en el código del endpoint, la tabla
   * diría una cosa y el endpoint haría otra. Aquí se lee de un vistazo que
   * reasignar son dos movimientos, y `mutar` los ejecuta porque lo dice la
   * tabla, no porque alguien escribiera el caso especial.
   */
  compuesta?: readonly Operacion[];
  /**
   * La operación necesita que el equipo sea **asignable** (D44).
   *
   * Va como CAMPO por lo mismo que `disparo` y `compuesta`: de aquí salen las
   * tres cosas a la vez —que la operación se rechace, que el 409 lo explique y
   * que el botón no se pinte—. Escrito como un `if` en el repositorio, la tabla
   * diría una cosa y el endpoint haría otra, que es lo que dejó a
   * `AccionesEquipo` pintando un botón con 404 en la 5d.
   *
   * Son las cuatro que ponen a alguien detrás del equipo. `devolver`,
   * `liberar` y `recuperar_prestamo` NO la llevan aunque parezca simétrico:
   * sacan de un estado al que un no asignable no debería haber llegado, así que
   * marcarlas prohibiría lo imposible y, sobre todo, impediría corregir una fila
   * mal importada sin tocar la base a mano.
   */
  requiere_asignable?: boolean;
}

export const TRANSICIONES: Record<Operacion, Transicion> = {
  asignar: {
    desde: ['Disponible', 'Reservado'],
    hacia: 'Asignado',
    movimiento: 'Asignación',
    disparo: 'directa',
    requiere: 'empleado',
    requiere_asignable: true,
    etiqueta: 'Asignar a alguien',
    explicacion:
      'Solo se puede asignar un equipo que esté disponible o reservado. Si ya está asignado a otra persona, primero hay que devolverlo.',
  },

  devolver: {
    desde: ['Asignado'],
    hacia: 'Disponible',
    movimiento: 'Devolución',
    disparo: 'directa',
    requiere: null,
    etiqueta: 'Registrar devolución',
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
    disparo: 'directa',
    requiere: 'sede',
    etiqueta: 'Trasladar a otra sede',
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
    disparo: 'directa',
    requiere: null,
    etiqueta: 'Dar de baja',
    irreversible: true,
    explicacion:
      'Un equipo asignado no se puede dar de baja: primero hay que devolverlo, para que quede constancia de que la persona ya no lo tiene.',
  },

  reservar: {
    desde: ['Disponible'],
    hacia: 'Reservado',
    movimiento: 'Reserva',
    disparo: 'directa',
    requiere: null,
    requiere_asignable: true,
    etiqueta: 'Reservar',
    explicacion: 'Solo se puede reservar un equipo disponible.',
  },

  liberar: {
    desde: ['Reservado'],
    hacia: 'Disponible',
    movimiento: 'Liberación',
    disparo: 'directa',
    requiere: null,
    etiqueta: 'Liberar la reserva',
    explicacion:
      'Solo se libera un equipo reservado. Si está asignado a alguien, la operación es devolverlo.',
  },

  /**
   * Séptima y octava (D29). Con ellas `En mantenimiento` deja de ser un estado
   * sin puerta de entrada, y `ESTADOS_SIN_OPERACION` queda **vacío**: cada
   * estado del enum tiene entrada y salida.
   *
   * Las dos las dispara el flujo de partes y no un botón suelto: enviar es
   * abrir el parte, retornar es cerrarlo. Un parte que cambiara el estado del
   * equipo por su cuenta reabriría la puerta que D19 cerró — un equipo
   * cambiando de estado sin dejar movimiento.
   *
   * `Asignado` queda fuera de `enviar_mantenimiento`, igual que en `baja` y por
   * el mismo argumento: un equipo que se va al taller no está en las manos de
   * la persona a la que figura asignado. Primero se devuelve.
   */
  enviar_mantenimiento: {
    desde: ['Disponible', 'Reservado'],
    hacia: 'En mantenimiento',
    movimiento: 'Envío a mantenimiento',
    disparo: 'parte',
    requiere: null,
    etiqueta: 'Enviar a mantenimiento',
    explicacion:
      'Un equipo asignado no se manda al taller directamente: primero hay que devolverlo, para que quede constancia de que la persona ya no lo tiene.',
  },

  retornar_mantenimiento: {
    desde: ['En mantenimiento'],
    hacia: 'Disponible',
    movimiento: 'Retorno de mantenimiento',
    disparo: 'parte',
    requiere: null,
    etiqueta: 'Registrar retorno del taller',
    explicacion: 'Solo vuelve del taller un equipo que esté en mantenimiento.',
  },

  /**
   * Novena y décima (D32). Con ellas `Prestado` entra al modelo con puerta de
   * entrada y de salida el mismo día, que es lo que no pasó con `Reservado`
   * (D17) ni con `En mantenimiento` (D29).
   *
   * Van con `disparo: 'directa'`: hay un endpoint por operación y un botón que
   * lo llama. Se distinguen de las de mantenimiento justo en eso — prestar no
   * abre ningún expediente aparte, el préstamo ES el movimiento.
   *
   * Solo desde `Disponible`. Prestar algo que está asignado a alguien deja a
   * esa persona sin el equipo que el inventario dice que tiene; prestar algo
   * que está en el taller promete lo que no se puede entregar. Primero se
   * devuelve o se recupera, y así queda constancia de los dos pasos.
   */
  prestar: {
    desde: ['Disponible'],
    hacia: 'Prestado',
    movimiento: 'Préstamo',
    disparo: 'directa',
    requiere: 'prestatario',
    requiere_asignable: true,
    etiqueta: 'Prestar a otra empresa',
    explicacion:
      'Solo se presta un equipo disponible. Si está asignado a alguien hay que devolverlo primero, y si está en el taller, recuperarlo.',
  },

  recuperar_prestamo: {
    desde: ['Prestado'],
    hacia: 'Disponible',
    movimiento: 'Retorno de préstamo',
    disparo: 'directa',
    requiere: null,
    etiqueta: 'Recuperar el préstamo',
    explicacion: 'Solo se recupera un equipo que esté prestado.',
  },

  /**
   * La undécima, y la única COMPUESTA: `devolver` + `asignar` (ver
   * `compuesta`).
   *
   * Existía como botón desde el prototipo y no hacía lo que prometía: abría el
   * asistente de onboarding, que solo lista equipos disponibles, así que el
   * equipo desde el que se pulsaba no aparecía en su propio desplegable. El
   * botón se retiró al reescribir la vista y la capacidad se quedó sin hacer.
   *
   * `movimiento` es el de la SEGUNDA mitad. Es una media verdad inevitable —el
   * campo es uno solo— y por eso `compuesta` está al lado: quien lea la fila ve
   * que se escriben dos.
   *
   * Lo que esta operación NO ahorra es la pregunta: devolver es un hecho
   * físico, no un paso de formulario. La interfaz la hace antes de disparar.
   */
  reasignar: {
    desde: ['Asignado'],
    hacia: 'Asignado',
    movimiento: 'Asignación',
    compuesta: ['devolver', 'asignar'],
    disparo: 'directa',
    requiere: 'empleado',
    requiere_asignable: true,
    etiqueta: 'Reasignar a otra persona',
    explicacion:
      'Solo se reasigna un equipo que ya esté asignado a alguien. Si está disponible, la operación es asignarlo.',
  },
};

/**
 * Estados a los que no llega ninguna operación. **Hoy está vacío**, y eso es
 * el criterio de que el modelo está completo: cada estado del enum tiene
 * entrada y salida.
 *
 * Hubo dos huecos y los dos se cerraron tarde, que es como se descubren:
 * `Reservado` estaba sin puerta de entrada desde la 0000 y nadie lo vio hasta
 * la etapa 5 (D17); `En mantenimiento` igual, hasta la 5d (D29).
 *
 * **No borrar esta constante por estar vacía.** Es lo que hace que el hueco
 * siguiente se vea: un estado nuevo aparece aquí solo, y el caso del
 * verificador que la comprueba se pone rojo.
 */
export const ESTADOS_SIN_OPERACION: readonly EstadoEquipo[] = [];

/** Las operaciones que tienen `POST /api/equipos/:id/<operacion>` propio. */
export const OPERACIONES_DIRECTAS = (Object.keys(TRANSICIONES) as Operacion[]).filter(
  (op) => TRANSICIONES[op].disparo === 'directa',
);

/** Qué se puede hacer ahora mismo con un equipo en este estado. */
export function operacionesDesde(estado: EstadoEquipo): Operacion[] {
  return (Object.keys(TRANSICIONES) as Operacion[]).filter((op) =>
    TRANSICIONES[op].desde.includes(estado),
  );
}

/**
 * La tabla entera, en forma serializable, para que la interfaz pinte los
 * botones sin tener su propia copia.
 *
 * Esto es lo que impide el fallo que se veía venir: seis operaciones en la API
 * que nadie puede ejecutar porque no hay botón, o —peor— botones pintados desde
 * una lista escrita a mano en el frontend que se queda vieja. `por_estado` lo
 * calcula `operacionesDesde`, la misma función que decide el `puedes` del 409.
 *
 * Se recorren los valores del enum y no una lista aparte: un estado nuevo
 * aparece aquí solo, aunque sea con la lista vacía, y eso es información —
 * significa que no hay forma de salir de él.
 */
export function catalogoTransiciones(estados: readonly EstadoEquipo[]) {
  return {
    operaciones: (Object.keys(TRANSICIONES) as Operacion[]).map((op) => ({
      operacion: op,
      etiqueta: TRANSICIONES[op].etiqueta,
      desde: TRANSICIONES[op].desde,
      hacia: TRANSICIONES[op].hacia,
      requiere: TRANSICIONES[op].requiere,
      explicacion: TRANSICIONES[op].explicacion,
      irreversible: TRANSICIONES[op].irreversible ?? false,
      disparo: TRANSICIONES[op].disparo,
      compuesta: TRANSICIONES[op].compuesta ?? null,
      requiere_asignable: TRANSICIONES[op].requiere_asignable ?? false,
    })),
    por_estado: Object.fromEntries(estados.map((e) => [e, operacionesDesde(e)])) as Record<
      EstadoEquipo,
      Operacion[]
    >,
    /**
     * Lo mismo para un equipo NO asignable (D44).
     *
     * Va calculado aquí y no filtrado en el cliente por la regla de siempre: la
     * pantalla pinta lo que venga en la lista, y si tuviera que decidir cuál
     * quitar, la decisión viviría en dos sitios. Con las dos listas ya hechas,
     * `AccionesEquipo` solo elige cuál mirar según la bandera del equipo.
     */
    por_estado_no_asignable: Object.fromEntries(
      estados.map((e) => [
        e,
        operacionesDesde(e).filter((op) => !TRANSICIONES[op].requiere_asignable),
      ]),
    ) as Record<EstadoEquipo, Operacion[]>,
    /** Estados a los que no llega ninguna operación. Ver arriba. */
    sin_operacion: ESTADOS_SIN_OPERACION,
  };
}

/**
 * La operación existe y el estado la permitiría, pero el equipo no se asigna
 * a nadie (D44).
 *
 * Separada de `TransicionIlegal` porque la causa es otra y la salida también:
 * en una transición ilegal se cambia de operación; aquí no hay operación que
 * valga mientras el equipo siga marcado como infraestructura. El mensaje tiene
 * que decir eso, no ofrecer alternativas que tampoco van a funcionar.
 */
export class EquipoNoAsignable extends Error {
  constructor(
    readonly operacion: Operacion,
    readonly nombre: string,
  ) {
    super(
      `${nombre} está marcado como equipo de infraestructura, así que no se asigna, ` +
        `ni se reserva, ni se presta, ni sale en un acta. Se inventaría y se mantiene. ` +
        `Si de verdad hay que entregárselo a alguien, primero hay que dejar de tratarlo ` +
        `como infraestructura en su ficha.`,
    );
  }
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
