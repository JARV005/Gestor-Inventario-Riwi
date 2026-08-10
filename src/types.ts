/**
 * El contrato del frontend.
 *
 * **Se deriva del esquema de Drizzle, no se escribe a mano.** `db/esquema.ts`
 * es la fuente de verdad; si una columna cambia de tipo o desaparece, esto deja
 * de compilar en vez de mentir en silencio. Los `import type` se borran en
 * compilación: nada de `db/` acaba en el bundle del navegador.
 *
 * Dos transformaciones separan la fila de la base de lo que llega al navegador:
 *
 *   1. `Serializado<T>` — por HTTP no viajan `Date`, viajan cadenas ISO.
 *   2. `Omit` de los campos cifrados — no salen por la API en ningún listado
 *      (§5.2), así que tampoco existen en este contrato. Si mañana se añade
 *      otra columna secreta, hay que añadirla a ese `Omit` a mano, y eso es
 *      deliberado: obliga a pensarlo.
 */

import type {
  empleados,
  equipos,
  mantenimientos,
  movimientos,
  sedes,
} from '../db/esquema';

// `db/motivos.ts` no importa nada, así que sí se puede traer en tiempo de
// ejecución: la interfaz necesita las descripciones para la bandeja y no tiene
// sentido mantener una segunda copia.
export { MOTIVOS, CODIGOS, type CodigoMotivo } from '../db/motivos';

// ---------------------------------------------------------------------------
// Utilidades de tipo
// ---------------------------------------------------------------------------

/** Lo que sobrevive a `JSON.stringify`: las fechas se vuelven cadenas ISO. */
type Serializado<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};

/** Falla en compilación si los dos tipos dejan de ser el mismo. */
type Igual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Comprobar<T extends true> = T;

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

export type Sede = Serializado<typeof sedes.$inferSelect>;

/** Sede con el reparto de equipos, calculado por el servidor. */
export type SedeConConteos = Sede & {
  equipos_total: number;
  equipos_asignados: number;
  equipos_disponibles: number;
  equipos_en_transito: number;
  equipos_por_revisar: number;
  empleados_total: number;
};

export type Empleado = Serializado<typeof empleados.$inferSelect>;

/**
 * No lleva `assignedDeviceIds`. La relación existe una sola vez, en
 * `equipos.empleado_id`, y lo que antes leía ese array se recalcula desde el
 * lado de equipos con `GET /api/empleados/:id/equipos` (D2).
 *
 * Tener la relación en los dos sentidos garantizaba que tarde o temprano
 * dijeran cosas distintas.
 */
export type EmpleadoConEquipos = Empleado & { equipos: EquipoResumen[] };

type FilaEquipo = typeof equipos.$inferSelect;

/**
 * Un equipo tal y como lo devuelve la API.
 *
 * Sin `bios_password_cifrado` ni `licencia_serial_cifrado`: no salen en ningún
 * listado, ni siquiera para admin. El único sitio donde existen descifrados es
 * la respuesta de `GET /api/equipos/:id/bios`, que tiene su propio tipo abajo.
 *
 * Tampoco lleva `healthScore`, `batteryHealth`, `mdmEnrolled`, `mdmProvider`,
 * `encrypted` ni `imageUrl` (D3): no había MDM, ni inventario de salud de
 * baterías, ni fotos. Un widget que grafica un dato inventado es peor que la
 * ausencia del widget.
 */
export type Equipo = Serializado<
  Omit<FilaEquipo, 'bios_password_cifrado' | 'licencia_serial_cifrado'>
>;

/** Detalle: incluye los motivos por los que está en la bandeja de revisión. */
export type EquipoConMotivos = Equipo & { motivos_revision: string[] };

/** Lo que devuelve `GET /api/empleados/:id/equipos`. */
export interface EquipoResumen {
  id: string;
  etiqueta: string | null;
  serial: string | null;
  categoria: CategoriaEquipo;
  marca: string | null;
  modelo: string | null;
  estado: EstadoEquipo;
}

/**
 * El cuerpo de `POST /api/equipos`, tal como lo acepta `camposEquipo` en
 * `server/rutas/equipos.ts`.
 *
 * No es `Partial<Equipo>`: `Equipo` trae `id`, `created_at`, `importacion_id`
 * y `requiere_revision`, que los pone el servidor y que un cliente no debe
 * poder mandar. Enumerar aquí lo que sí se acepta es lo que hace que añadir un
 * campo al formulario obligue a tocar también el esquema del servidor.
 */
export interface NuevoEquipo {
  categoria: CategoriaEquipo;
  etiqueta?: string | null;
  nombre_equipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  serial?: string | null;
  procesador?: string | null;
  disco?: string | null;
  ram?: string | null;
  estado: EstadoEquipo;
  sede_id?: string | null;
  empleado_id?: string | null;
  /** Cadena, no `number`: `numeric(14,2)` no cabe en un `number` sin perder precisión. */
  costo?: string | null;
}

/**
 * Lo que devuelve `GET /api/equipos/resumen`: los agregados que alimentan el
 * dashboard y el contador del sidebar.
 *
 * **Los grupos vacíos no vienen.** Un `GROUP BY` sobre una tabla sin ningún
 * equipo `Reservado` no devuelve una fila `Reservado: 0`, no devuelve nada. La
 * interfaz tiene que resolver la ausencia como cero y no dar por hecho que
 * están los seis estados — de ahí `conteoDe()` en `DashboardView`.
 */
export interface ResumenEquipos {
  por_estado: { estado: EstadoEquipo; equipos: number }[];
  por_categoria: { categoria: CategoriaEquipo; equipos: number }[];
  total: number;
  /**
   * Equipos con un traslado sin confirmar. **No es un estado** (D13): un
   * equipo que viaja sigue estando `Asignado` o `Disponible`, así que este
   * número no suma con `por_estado` ni cuadra contra `total`. Son dos hechos
   * distintos sobre el mismo equipo.
   */
  traslados_abiertos: number;
}

export type Movimiento = Serializado<typeof movimientos.$inferSelect>;

export type Mantenimiento = Serializado<typeof mantenimientos.$inferSelect>;

/**
 * Un parte con lo justo del equipo para identificarlo.
 *
 * El parte guarda `equipo_id`; el servidor resuelve el resto en el mismo
 * SELECT. Nunca los campos cifrados: la lista de columnas del repositorio es
 * cerrada, y aquí solo pueden estar las que salen de ahí.
 */
export type MantenimientoConEquipo = Mantenimiento & {
  equipo_etiqueta: string | null;
  equipo_nombre: string | null;
  equipo_serial: string | null;
  equipo_marca: string | null;
  equipo_modelo: string | null;
};

/**
 * Lo que sustituye a `Employee.assignedDeviceIds.length` (D2): un conteo que
 * el servidor calcula desde el lado de equipos, que es donde vive la relación.
 * La lista completa se pide aparte con `GET /api/empleados/:id/equipos`.
 */
export type EmpleadoConConteo = Empleado & { equipos_asignados: number };

/** Solo de `GET /api/equipos/:id/bios`, rol admin y con fila en `auditoria`. */
export interface SecretosEquipo {
  bios_password: string | null;
  licencia_serial: string | null;
}

// ---------------------------------------------------------------------------
// Enumerados
// ---------------------------------------------------------------------------

export type CategoriaEquipo = FilaEquipo['categoria'];
export type EstadoEquipo = FilaEquipo['estado'];
export type CondicionEquipo = NonNullable<FilaEquipo['condicion']>;
export type PropiedadEquipo = FilaEquipo['propiedad'];
export type LicenciaTipo = NonNullable<FilaEquipo['licencia_tipo']>;
export type EstadoEmpleado = Empleado['estado'];
export type RolUsuario = 'admin' | 'tecnico';

/**
 * Las listas que la interfaz necesita recorrer para pintar desplegables.
 *
 * Se declaran aquí y no se importan de Drizzle porque `enumValues` es un valor
 * en tiempo de ejecución y traerlo metería `drizzle-orm` en el bundle. La copia
 * es segura: las comprobaciones de más abajo dejan de compilar si alguna se
 * separa del enum de la base.
 *
 * **Ya no hay ubicaciones fijas.** `CDMX Hub`, `Buenos Aires`, `Miami` y
 * `Madrid` desaparecen: las sedes salen de `GET /api/sedes`.
 */
export const CATEGORIAS_EQUIPO = [
  'Portátil',
  'Desktop',
  'Monitor',
  'Teclado',
  'Mouse',
  'Diadema',
  'Celular',
  'Otro',
] as const;

/**
 * De quién es el equipo y para qué está. **No dónde está.**
 *
 * `En tránsito` salió en la 0008 (D13). «Está viajando» se deriva de que
 * exista un movimiento `Traslado` sin confirmar, no de esta lista.
 */
export const ESTADOS_EQUIPO = [
  'Disponible',
  'Asignado',
  'En mantenimiento',
  'Reservado',
  'De baja',
] as const;

export const CONDICIONES_EQUIPO = [
  'Nuevo',
  'Excelente',
  'Bueno',
  'Usado',
  'Requiere reparación',
] as const;

export const PROPIEDADES_EQUIPO = ['Empresa', 'Cliente', 'Empleado'] as const;

export const ESTADOS_EMPLEADO = ['Activo', 'Onboarding', 'Offboarding', 'Inactivo'] as const;

// Si alguien añade un valor al enum de la base y no lo añade aquí —o al revés—
// esto deja de compilar. Es el único punto donde la copia podría separarse.
type _c1 = Comprobar<Igual<(typeof CATEGORIAS_EQUIPO)[number], CategoriaEquipo>>;
type _c2 = Comprobar<Igual<(typeof ESTADOS_EQUIPO)[number], EstadoEquipo>>;
type _c3 = Comprobar<Igual<(typeof CONDICIONES_EQUIPO)[number], CondicionEquipo>>;
type _c4 = Comprobar<Igual<(typeof PROPIEDADES_EQUIPO)[number], PropiedadEquipo>>;
type _c5 = Comprobar<Igual<(typeof ESTADOS_EMPLEADO)[number], EstadoEmpleado>>;

// ---------------------------------------------------------------------------
// Respuestas de la API
// ---------------------------------------------------------------------------

export interface Pagina<T> {
  filas: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
}

/**
 * Los tres estados de una carga. Hoy la aplicación no tiene ninguno: pinta
 * datos que ya están en memoria y no puede fallar. Con datos reales, "cargando"
 * y "ha fallado" son estados tan legítimos como "listo".
 */
export type Carga<T> =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; datos: T };
