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
  empresaEmpleado,
  equipos,
  mantenimientos,
  movimientos,
  prestatario,
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
  /** Las dos que el buscador de actas necesita para filtrar (5f-3). */
  empresa: Empresa;
  sede_id: string | null;
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
  /**
   * De quién es (D31). Es de los pocos campos de estado-ish que SÍ se editan a
   * mano: la propiedad no sale de ninguna operación, y es lo que hay que tocar
   * para cerrar un `PROPIEDAD_AMBIGUA` desde la bandeja.
   */
  empresa?: Empresa;
  /** Cadena, no `number`: `numeric(14,2)` no cabe en un `number` sin perder precisión. */
  costo?: string | null;
  /**
   * Texto libre. Existía en el esquema desde la 0000 y no había forma de
   * escribirlo desde la aplicación: un equipo nuevo llegaba con contexto —de
   * dónde salió, qué tiene raro— y ese contexto se perdía.
   *
   * Cuidado al editarlo: el importador dejó aquí el rastro de los responsables
   * que no eran personas. Ver `NotasEquipo`.
   */
  notas?: string | null;
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

/**
 * Se re-exporta de `db/transiciones.ts`, no se copia.
 *
 * Era una lista escrita a mano con las seis de la etapa 5. La 5d añadió dos
 * operaciones a la tabla y esta copia no se enteró: `tsc` siguió en verde, el
 * catálogo del servidor empezó a devolver ocho y `AccionesEquipo` pintó dos
 * botones que daban 404. Exactamente la desincronización silenciosa contra la
 * que avisa el comentario de `Transicion.etiqueta`, ocurrida en el tipo en vez
 * de en las etiquetas.
 */
import type { Operacion } from '../db/transiciones';
export type { Operacion };

import { PREFIJO_CONSECUTIVO, type EmpresaQueEmite } from '../db/acta-formato';

/**
 * Los cuatro items de la lista de chequeo, **re-exportados de
 * `db/acta-formato.ts`**, no copiados. Por lo mismo que `Operacion` de aquí
 * arriba: una segunda lista escrita a mano se desincroniza en silencio, con
 * `tsc` en verde, y lo que queda mal es un documento legal.
 *
 * Es un valor y no solo un tipo porque el formulario tiene que PINTAR los
 * cuatro. `acta-formato.ts` no importa nada, así que entra en el bundle sin
 * arrastrar código de servidor.
 */
export { CHEQUEO_ITEMS } from '../db/acta-formato';

/**
 * Las empresas que pueden emitir un acta (D42). **Sale del formato**, no es una
 * lista escrita aquí: si mañana entra una tercera, el desplegable la ofrece sin
 * que nadie se acuerde de este fichero.
 *
 * `Sin clasificar` no está, y por eso el desplegable de «asignar empresa para
 * poder emitir» no la ofrece: volver a ponerla sería ofrecer como solución
 * justo el estado que bloquea.
 */
export const EMPRESAS_QUE_EMITEN = Object.keys(
  PREFIJO_CONSECUTIVO,
) as EmpresaQueEmite[];
export type { EmpresaQueEmite };

export type TipoActa = 'Entrega' | 'Devolución';

/**
 * Los dos caminos para emitir un acta (5c).
 *
 * `firmar` documenta operaciones que ya ocurrieron; `ejecutar` las hace y las
 * firma a la vez. En pantalla no se llaman así: se llaman «entregar ahora» y
 * «registrar una entrega ya hecha», porque quien lo usa no tiene por qué saber
 * cómo funciona por dentro.
 */
export type ModoActa = 'firmar' | 'ejecutar';

/** Un equipo con un movimiento suyo pendiente de firmar (`GET /api/actas/firmables`). */
export interface EquipoFirmable {
  id: string;
  etiqueta: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  categoria: string;
  estado: string;
  sede_id: string | null;
  /** De quién es el equipo. La usa el filtro del buscador de actas (5f-3). */
  empresa: Empresa;
  movimiento_id: string;
  fecha: string;
}

/**
 * Una línea de acta: **lo que el equipo era al firmar**, no lo que es ahora.
 *
 * Estas columnas son el contenido del documento, copiado al emitirlo (D23). Si
 * alguien corrige el serial el mes que viene, esta línea sigue diciendo el de
 * aquel día — por eso la vista pinta esto y no vuelve a consultar el equipo.
 */
export interface LineaActa {
  equipo_id: string;
  /** El movimiento que este acta documenta (D24). */
  movimiento_id: string;
  etiqueta: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  categoria: CategoriaEquipo;
  condicion: string | null;
  procesador: string | null;
  ram: string | null;
  disco: string | null;
  sistema_operativo: string | null;
}

/** Un acta emitida, tal como la devuelven `POST /api/actas` y `GET /api/actas/:id`. */
export interface ActaEmitida {
  id: string;
  consecutivo: string;
  tipo: TipoActa;
  fecha: string;
  empleado_id: string;
  /** Instantánea de la persona, congelada al emitir. */
  empleado_nombre: string;
  empleado_cedula: string | null;
  empleado_cargo: string | null;
  empleado_area: string | null;
  sede_nombre: string | null;
  generada_por: string;
  generada_por_nombre: string;
  firmada: boolean;
  fecha_firma: string | null;
  hash_sha256: string | null;
  /** El binario no viaja en el detalle: en 5a siempre es `false`. */
  tiene_pdf: boolean;
  /** De quién es el acta: decide el logo y el prefijo del consecutivo (D40). */
  empresa: Empresa;
  /** La sección 5, congelada. `null` en las devoluciones (D41). */
  chequeo: ItemChequeo[] | null;
  equipos: LineaActa[];
}

/**
 * Un item de la lista de chequeo del acta (D41).
 *
 * `instalado: null` significa **«nadie contestó»**, y se imprime como casilla
 * en blanco. No es `false`: el formulario no premarca nada, porque un «Sí» por
 * defecto en un documento legal es una afirmación que no hizo nadie.
 */
export interface ItemChequeo {
  item: string;
  instalado: boolean | null;
  observaciones: string | null;
}

/**
 * Lo que devuelve cerrar un motivo en bloque.
 *
 * `fallidos` viene con nombre y no como número: las filas que no entran son
 * las que necesitan una decisión antes —un duplicado sin resolver—, y un
 * recuento sin nombres obliga a buscarlas a mano.
 */
export interface CierreEnBloque {
  motivo: string;
  cerrados: number;
  fallidos: {
    equipo_id: string;
    etiqueta: string | null;
    serial: string | null;
    problema: string | null;
  }[];
}

/**
 * Una licencia de software (D43).
 *
 * **No trae la key**, y nunca lo hará: es un secreto del §5, igual que
 * `bios_password`. Lo que viaja es `tiene_key`, porque quien mira la lista
 * necesita saber si la licencia está completa, no cuál es su clave. Para verla
 * hay un endpoint aparte que exige admin y deja su fila en `auditoria`.
 */
export interface Licencia {
  id: string;
  tipo: string;
  descripcion: string;
  equipo_id: string | null;
  /**
   * Lo que decía el Excel, se haya resuelto o no.
   *
   * Cuando `equipo_id` es null, esto es lo único que dice a qué apuntaba: las
   * doce que van a equipos `BAQ-000xx` de Barranquilla se reconciliarán por
   * aquí cuando lleguen sus ficheros.
   */
  equipo_referencia: string | null;
  estado: 'Activada' | 'Disponible' | 'Vencida' | 'Retirada';
  usuario_responsable: string | null;
  ubicacion: string | null;
  notas: string | null;
  requiere_revision: boolean;
  created_at: string;
  /** Si tiene key registrada. NO es la key. */
  tiene_key: boolean;
}

export interface ResumenLicencias {
  por_estado: { estado: string; licencias: number }[];
  /** Las que apuntan a un equipo que no está. El número que pide otra sede. */
  sin_equipo_resuelto: number;
  total: number;
}

/** Una fila del listado de actas. */
export interface ActaResumen {
  id: string;
  consecutivo: string;
  tipo: TipoActa;
  fecha: string;
  empleado_id: string;
  empleado_nombre: string;
  sede_nombre: string | null;
  generada_por_nombre: string;
  firmada: boolean;
  tiene_pdf: boolean;
  equipos: number;
}

/**
 * Una fila del historial con los nombres ya resueltos por el servidor. Es la
 * pantalla que justifica el proyecto: un historial que contesta `a3f9c1e2-…`
 * no contesta.
 */
export interface MovimientoConNombres {
  id: string;
  tipo: string;
  fecha: string;
  observaciones: string | null;
  empleado_origen_id: string | null;
  empleado_origen: string | null;
  empleado_destino_id: string | null;
  empleado_destino: string | null;
  sede_origen_id: string | null;
  sede_origen: string | null;
  sede_destino_id: string | null;
  sede_destino: string | null;
  usuario_app_id: string;
  usuario: string | null;
  usuario_email: string | null;
  fecha_confirmacion: string | null;
  transportadora: string | null;
  guia: string | null;
  fecha_estimada: string | null;
}

/**
 * Lo que devuelve `GET /api/transiciones`: la tabla de `db/transiciones.ts`
 * tal cual, para que la interfaz pinte los botones sin tener su propia copia.
 *
 * **No añadir aquí una lista de operaciones escrita a mano.** Esa lista sería
 * una segunda tabla de transiciones, y se desincronizaría en silencio: un botón
 * para una operación retirada, o ninguno para una nueva. Lo que se puede hacer
 * con un equipo en estado X es `por_estado[X]`, y punto.
 */
export interface CatalogoTransiciones {
  operaciones: {
    operacion: Operacion;
    etiqueta: string;
    desde: EstadoEquipo[];
    hacia: EstadoEquipo | null;
    requiere: 'empleado' | 'sede' | null;
    explicacion: string;
    irreversible: boolean;
    /**
     * `directa` tiene endpoint propio y se pinta como botón. `parte` la
     * dispara el flujo de mantenimiento y **no** tiene endpoint suelto: pintar
     * un botón para ella da 404.
     */
    disparo: 'directa' | 'parte';
    /**
     * Las operaciones que esta ejecuta en cadena, o `null`. `reasignar` es
     * `['devolver', 'asignar']`: dos movimientos, no uno.
     */
    compuesta: Operacion[] | null;
    /** D44: la operación pone a alguien detrás del equipo. */
    requiere_asignable: boolean;
  }[];
  por_estado: Record<EstadoEquipo, Operacion[]>;
  /**
   * Lo mismo para un equipo NO asignable (D44).
   *
   * Lo calcula el servidor. Si la pantalla tuviera que quitar operaciones de
   * `por_estado` por su cuenta, la regla viviría en dos sitios y se
   * separarían — que es exactamente lo que este catálogo existe para evitar.
   */
  por_estado_no_asignable: Record<EstadoEquipo, Operacion[]>;
  sin_operacion: EstadoEquipo[];
}

/**
 * Una fila de `GET /api/traslados`: un equipo que está viajando ahora mismo.
 *
 * Los nombres vienen resueltos por el servidor. Es lo que devuelve a
 * `SedesView` la lista que perdió al sustituir a `LogisticsHubsView` (D1), con
 * la diferencia de que estos datos existen: los inventaba el prototipo.
 *
 * `dias_en_transito` lo calcula Postgres. El reloj del navegador puede estar en
 * otra zona, y «lleva 9 días» es el número por el que se llama a la
 * transportadora.
 */
export interface TrasladoAbierto {
  id: string;
  fecha: string;
  equipo_id: string;
  etiqueta: string | null;
  marca: string | null;
  modelo: string | null;
  categoria: CategoriaEquipo;
  estado: EstadoEquipo;
  /** Quién lo tiene asignado, si está asignado. Un traslado no cambia eso. */
  responsable: string | null;
  sede_origen_id: string | null;
  sede_origen: string | null;
  sede_destino_id: string | null;
  sede_destino: string | null;
  transportadora: string | null;
  guia: string | null;
  fecha_estimada: string | null;
  observaciones: string | null;
  usuario: string | null;
  dias_en_transito: number;
}

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

export type Empresa = 'RIWI' | 'BBL Labs' | 'Sin clasificar';

/** A quién se le presta un equipo (D31). Enum propio, no el de `Empresa`. */
export type Prestatario = 'RIWI' | 'BBL Labs' | 'ISF';
export const PRESTATARIOS: Prestatario[] = ['RIWI', 'BBL Labs', 'ISF'];
export const EMPRESAS: Empresa[] = ['RIWI', 'BBL Labs', 'Sin clasificar'];

/** Los estados de un parte con el equipo todavía en el taller. */
export const ESTADOS_PARTE_ABIERTO = ['Pendiente', 'En taller', 'Completado'] as const;
export type EstadoParteAbierto = (typeof ESTADOS_PARTE_ABIERTO)[number];

/** Lo que hace falta para dar de alta o editar a un colaborador. */
export interface DatosEmpleado {
  nombre: string;
  cedula?: string | null;
  email_corporativo?: string | null;
  cargo?: string | null;
  area?: string | null;
  sede_id?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  empresa?: Empresa;
}

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
  /** 5e (D32). Lo tiene otra empresa; `equipos.prestado_a` dice cuál. */
  'Prestado',
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

// Y estos dos porque `Empresa` y `Prestatario` sí están escritos a mano: son
// enums de la base que no cuelgan de ninguna columna de las que `Serializado`
// arrastra. Sin la guarda serían la misma copia silenciosa que `Operacion`,
// que aguantó dos operaciones de diferencia con `tsc` en verde.
type _c6 = Comprobar<Igual<Empresa, (typeof empresaEmpleado.enumValues)[number]>>;
type _c7 = Comprobar<Igual<Prestatario, (typeof prestatario.enumValues)[number]>>;
type _c8 = Comprobar<Igual<(typeof EMPRESAS)[number], Empresa>>;
type _c9 = Comprobar<Igual<(typeof PRESTATARIOS)[number], Prestatario>>;
type _c10 = Comprobar<Igual<(typeof EMPRESAS_QUE_EMITEN)[number], EmpresaQueEmite>>;

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
