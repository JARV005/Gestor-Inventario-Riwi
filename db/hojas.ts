/**
 * El mapa de las diecisiete hojas de inventario (etapa 8c).
 *
 * ============================================================================
 * ESTO ES UN DATO, NO CÓDIGO. QUINCE HOJAS SON QUINCE FILAS DE ESTA TABLA.
 * ============================================================================
 *
 * Cada hoja trae un juego de columnas distinto —`INV - HERRAMIENTAS` llama
 * `HERRAMIENTA` a lo que las demás llaman `TIPO EQUIPO`, `INV - SEDE` llama
 * `SERIAL / MAC` al serial— y escribir eso como quince ramas de `if` dentro del
 * importador lo haría ilegible y, sobre todo, imposible de revisar contra el
 * Excel. Aquí se lee una hoja por bloque y se compara con el fichero.
 *
 * El importador NO conoce ningún nombre de hoja ni de columna: los saca de
 * aquí. Añadir una hoja es añadir un bloque.
 *
 * Todo lo que dice este fichero salió de la exploración de la fase 0, que está
 * en `docs/decisiones-07.md`. Los conteos de `filasEsperadas` son los del propio
 * Excel y sirven de reconciliación: si una hoja trae otro número, el fichero
 * cambió y hay que mirarlo antes de cargar.
 */

export type EmpresaHoja = 'RIWI' | 'BBL Labs';
export type PrestatarioHoja = 'RIWI' | 'BBL Labs' | 'ISF';

/**
 * Qué clase de fila produce la hoja.
 *
 * `derivados` no es una clase: es una hoja de equipos que ADEMÁS produce filas
 * de periférico, y por eso va aparte.
 */
export type ClaseHoja = 'equipo' | 'periferico' | 'licencia';

/**
 * Los conceptos que el importador sabe leer, y cómo se llama cada uno en esta
 * hoja. Lo que no esté aquí, esta hoja no lo trae.
 */
export interface ColumnasHoja {
  tipo?: string;
  marca?: string;
  modelo?: string;
  serial?: string;
  etiqueta?: string;
  nombreEquipo?: string;
  sistemaOperativo?: string;
  procesador?: string;
  disco?: string;
  ram?: string;
  tamano?: string;
  estado?: string;
  responsable?: string;
  cedula?: string;
  ubicacion?: string;
  sesion?: string;
  observaciones?: string;
  garantia?: string;
  serialCargador?: string;
  /** Secretos del §5. Se cifran y no se registran. */
  serialWindows?: string;
  tipoLicencia?: string;
  biosPassword?: string;
  /** Solo en licencias. */
  descripcionLicencia?: string;
  keyLicencia?: string;
  equipoActivado?: string;
  /** Solo en celulares. */
  numero?: string;
  correoContacto?: string;
  correoRecuperacion?: string;
  area?: string;
  /** Solo en periféricos. */
  disponibilidad?: string;
}

/** Una pantalla o un teclado que viajan en la fila de su equipo (`INV - CE`). */
export interface Derivado {
  /** Qué es: va a `categoria`. */
  categoria: 'Monitor' | 'Teclado';
  marca: string;
  etiqueta: string;
  serial?: string;
}

export interface MapaHoja {
  /** El nombre EXACTO de la hoja. Sin normalizar: si no existe, se revienta. */
  nombre: string;
  empresa: EmpresaHoja;
  clase: ClaseHoja;

  /**
   * ¿Sus equipos se le entregan a una persona? (D44)
   *
   * Sale de lo que traen las COLUMNAS, no del nombre de la hoja: una hoja sin
   * `USUARIO RESPONSABLE` no puede decir a quién se le entregó nada, y su
   * «Asignado» significa otra cosa —«en uso en la sala P3»— que ninguna columna
   * respalda.
   *
   * La excepción razonada es `INV - BLACKBIRD`: tampoco tiene responsable, pero
   * sus equipos están PRESTADOS a otra empresa, y `prestado_a` exige
   * `asignable = true` por la CHECK de la 0016.
   */
  asignable: boolean;

  /** Lo que la hoja trae si la fila no dice su tipo. */
  categoriaPorDefecto?: string;

  /**
   * Todos sus equipos están prestados a esta empresa (D46).
   *
   * Solo `INV - BLACKBIRD`. Entra como `empresa = RIWI`, `prestado_a = BBL Labs`,
   * `estado = Prestado`.
   */
  prestadoA?: PrestatarioHoja;

  /** Las columnas SIN LAS CUALES no se importa. Se comprueban antes de leer. */
  exigidas: string[];

  col: ColumnasHoja;

  /**
   * Filas que la exploración contó. Si el fichero trae otro número, cambió, y
   * hay que mirarlo antes de cargar en vez de cargar lo que venga.
   */
  filasEsperadas: number;

  /** Notas que el importador escribe en cada fila de esta hoja. */
  procedencia: string;
}

const RIWI = 'data/origen/INVENTARIO_RIWI_MED_1.xlsx';
const BBL = 'data/origen/INVENTARIO_BBL_MED_1.xlsx';

export const RUTAS: Record<EmpresaHoja, string> = { RIWI, 'BBL Labs': BBL };

export const HOJAS: MapaHoja[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // RIWI
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * El personal. Es la que sustituye a `INV - EQUIPOS` de la 5e: cambió de
   * nombre y perdió el guion, y por eso el importador no la encontraba.
   */
  {
    nombre: 'INV RIWI STAFF',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: true,
    exigidas: ['TIPO EQUIPO', 'SERIAL EQUIPO', 'ETIQUETA', 'ESTADO DEL EQUIPO'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      serialCargador: 'SERIAL ADAPTADOR DE CARGA',
      garantia: 'GARANTIA VENC.',
      etiqueta: 'ETIQUETA',
      nombreEquipo: 'NOMBRE EQUIPO',
      sistemaOperativo: 'SISTEMA OPERATIVO',
      serialWindows: 'SERIAL WINDOWS',
      tipoLicencia: 'TIPO DE LICENCIA',
      tamano: 'TAMAÑO',
      procesador: 'PROCESADOR',
      disco: 'DISCO',
      ram: 'RAM',
      estado: 'ESTADO DEL EQUIPO',
      responsable: 'USUARIO RESPONSABLE',
      ubicacion: 'UBICACIÓN',
      sesion: 'SESION DE USUARIO',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 78,
    procedencia: 'INV RIWI STAFF',
  },

  /**
   * Los equipos de las salas de review. **Infraestructura** (D50).
   *
   * Sus 177 filas dicen `Asignado` y la hoja no tiene columna de responsable:
   * ahí «asignado» significa «en uso en la sala P3 OCCI». Importarlas como
   * `Asignado` chocaría contra `equipos_asignado_implica_empleado`.
   *
   * Y produce DERIVADOS: cada fila trae una pantalla y un teclado con etiqueta
   * propia, que son activos y no campos.
   */
  {
    nombre: 'INV - CE',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: false,
    exigidas: ['TIPO EQUIPO', 'ETIQUETA', 'ESTADO DEL EQUIPO', 'UBICACIÓN'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      nombreEquipo: 'NOMBRE EQUIPO',
      sistemaOperativo: 'SISTEMA OPERATIVO',
      procesador: 'PROCESADOR',
      disco: 'DISCO',
      ram: 'RAM',
      estado: 'ESTADO DEL EQUIPO',
      ubicacion: 'UBICACIÓN',
    },
    filasEsperadas: 177,
    procedencia: 'INV - CE (sala)',
  },

  /** Red, servidores y respaldo. Infraestructura pura. */
  {
    nombre: 'INV - RACK',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: false,
    exigidas: ['TIPO EQUIPO', 'SERIAL EQUIPO', 'ETIQUETA', 'ESTADO DEL EQUIPO'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      estado: 'ESTADO DEL EQUIPO',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 50,
    procedencia: 'INV - RACK',
  },

  {
    nombre: 'INV - PERIFERICOS',
    empresa: 'RIWI',
    clase: 'periferico',
    asignable: true,
    exigidas: ['TIPO DE PERIFERICO', 'MARCA', 'DISPONIBILIDAD'],
    col: {
      tipo: 'TIPO DE PERIFERICO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      responsable: 'USUARIO RESPONSABLE',
      cedula: 'CEDULA USUARIO',
      ubicacion: 'UBICACIÓN',
      disponibilidad: 'DISPONIBILIDAD',
      estado: 'ESTADO DEL EQUIPO',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 47,
    procedencia: 'INV - PERIFERICOS',
  },

  /**
   * Las licencias (D43). Única hoja de clase `licencia`.
   *
   * `KEY / SERIAL LICENCIA` es un secreto del §5 y se cifra. `EQUIPO ACTIVADO`
   * se resuelve contra la etiqueta de un equipo; doce de las treinta apuntan a
   * `BAQ-000xx` de Barranquilla y quedan con la referencia guardada.
   */
  {
    nombre: 'INV - LICENCIAS',
    empresa: 'RIWI',
    clase: 'licencia',
    asignable: false,
    exigidas: ['TIPO DE LICENCIA', 'DESCRIPCIÓN LICENCIA', 'KEY / SERIAL LICENCIA', 'ESTADO'],
    col: {
      tipoLicencia: 'TIPO DE LICENCIA',
      descripcionLicencia: 'DESCRIPCIÓN LICENCIA',
      keyLicencia: 'KEY / SERIAL LICENCIA',
      equipoActivado: 'EQUIPO ACTIVADO',
      estado: 'ESTADO',
      responsable: 'USUARIO RESPONSABLE',
      ubicacion: 'UBICACIÓN',
    },
    filasEsperadas: 30,
    procedencia: 'INV - LICENCIAS',
  },

  /** Salas de reuniones. Sin responsable: infraestructura. */
  {
    nombre: 'INV - SALAS VIDEOCONF',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: false,
    exigidas: ['TIPO EQUIPO', 'ETIQUETA', 'ESTADO DEL EQUIPO', 'UBICACIÓN'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      estado: 'ESTADO DEL EQUIPO',
      ubicacion: 'UBICACIÓN',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 19,
    procedencia: 'INV - SALAS VIDEOCONF',
  },

  /**
   * Access points, switches, infraestructura de sede.
   *
   * Su serial es una **dirección MAC** (`0c:ea:14:13:40:9d`), no un número de
   * serie. Se guarda igual: identifica el aparato, que es para lo que sirve la
   * columna.
   */
  {
    nombre: 'INV - SEDE',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: false,
    exigidas: ['TIPO EQUIPO', 'SERIAL / MAC', 'ESTADO DEL EQUIPO', 'UBICACIÓN'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL / MAC',
      etiqueta: 'ETIQUETA',
      estado: 'ESTADO DEL EQUIPO',
      ubicacion: 'UBICACIÓN',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 18,
    procedencia: 'INV - SEDE',
  },

  /** Audio y vídeo de eventos. **No tiene columna de estado**: entra Disponible. */
  {
    nombre: 'INV - AUDIOVISUAL',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: false,
    exigidas: ['TIPO EQUIPO', 'ETIQUETA'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 17,
    procedencia: 'INV - AUDIOVISUAL',
  },

  /**
   * Prestados a Blackbird (D46).
   *
   * `asignable: true` aunque no tenga responsable, y es la única excepción a la
   * regla de arriba: `prestado_a` exige `asignable` por la CHECK de la 0016, y
   * estos equipos están de verdad en manos de otra empresa.
   *
   * Cero de sus 16 seriales aparecen en el fichero de BBL, así que no hay cruce
   * que resolver. Los 4 seriales repetidos dentro de la hoja van a la bandeja.
   */
  {
    nombre: 'INV - BLACKBIRD',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: true,
    prestadoA: 'BBL Labs',
    exigidas: ['TIPO EQUIPO', 'SERIAL EQUIPO', 'ETIQUETA'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      estado: 'ESTADO DEL EQUIPO',
      ubicacion: 'UBICACIÓN',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 16,
    procedencia: 'INV - BLACKBIRD (préstamo)',
  },

  /** El laboratorio. Sin responsable: sus equipos son de la sala. */
  {
    nombre: 'INV - BELAB',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: false,
    exigidas: ['TIPO EQUIPO', 'SERIAL EQUIPO', 'ETIQUETA'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      serialWindows: 'SERIAL WINDOWS',
      tipoLicencia: 'TIPO DE LICENCIA',
      estado: 'ESTADO DEL EQUIPO',
      ubicacion: 'UBICACIÓN',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 9,
    procedencia: 'INV - BELAB',
  },

  /**
   * Celulares corporativos.
   *
   * `CORREO DE RECUPERACIÓN` es una credencial y **se cifra** (D51): tres de los
   * seis comparten la misma, así que es una cuenta de recuperación compartida.
   * `NÚMERO` y `CORREO / WHATSAPP` son contacto normal y van en claro.
   */
  {
    nombre: 'INV - CELULARES',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: true,
    categoriaPorDefecto: 'Celular',
    exigidas: ['TIPO EQUIPO', 'SERIAL EQUIPO', 'ETIQUETA', 'ESTADO DEL EQUIPO'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      numero: 'NÚMERO',
      correoContacto: 'CORREO / WHATSAPP',
      correoRecuperacion: 'CORREO DE RECUPERACIÓN',
      area: 'ÁREA',
      estado: 'ESTADO DEL EQUIPO',
      responsable: 'USUARIO RESPONSABLE',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 6,
    procedencia: 'INV - CELULARES',
  },

  /** Herramientas del técnico. Llama a sus columnas distinto que todas las demás. */
  {
    nombre: 'INV - HERRAMIENTAS',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: true,
    exigidas: ['HERRAMIENTA', 'SERIAL', 'ESTADO'],
    col: {
      tipo: 'HERRAMIENTA',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL',
      etiqueta: 'ETIQUETA',
      estado: 'ESTADO',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 6,
    procedencia: 'INV - HERRAMIENTAS',
  },

  /**
   * En renting a Milenio PC.
   *
   * Sus tres filas están TAMBIÉN en `INV RIWI STAFF` con el mismo serial, y la
   * bitácora del propio fichero lo llama «inconsistencia dentro del archivo
   * origen» (D49). Se resuelve como una sola máquina: gana el destino, que es
   * STAFF.
   */
  {
    nombre: 'INV - RENTING',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: true,
    categoriaPorDefecto: 'Portátil',
    exigidas: ['PROVEEDOR', 'SERIAL EQUIPO', 'ETIQUETA'],
    col: {
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      sistemaOperativo: 'SISTEMA OPERATIVO',
      procesador: 'PROCESADOR',
      disco: 'DISCO',
      ram: 'RAM',
      estado: 'ESTADO DEL EQUIPO',
      responsable: 'USUARIO RESPONSABLE',
      ubicacion: 'UBICACIÓN',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 3,
    procedencia: 'INV - RENTING (Milenio PC)',
  },

  /** Dos impresoras. No tiene `TIPO EQUIPO`: la categoría es fija. */
  {
    nombre: 'INV - IMPRESORAS',
    empresa: 'RIWI',
    clase: 'equipo',
    asignable: false,
    categoriaPorDefecto: 'Otro',
    exigidas: ['MARCA', 'SERIAL EQUIPO', 'ETIQUETA'],
    col: {
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      etiqueta: 'ETIQUETA',
      estado: 'ESTADO DEL EQUIPO',
      ubicacion: 'UBICACIÓN',
      observaciones: 'OBSERVACIONES',
    },
    filasEsperadas: 2,
    procedencia: 'INV - IMPRESORAS',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BBL Labs — apenas cambia respecto a la 5e
  // ═══════════════════════════════════════════════════════════════════════════

  {
    nombre: 'INVENTARIO EQUIPOS BBL',
    empresa: 'BBL Labs',
    clase: 'equipo',
    asignable: true,
    exigidas: ['TIPO EQUIPO', 'SERIAL EQUIPO', 'ETIQUETA', 'ESTADO DEL EQUIPO'],
    col: {
      tipo: 'TIPO EQUIPO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      biosPassword: 'BIOS PASSWORD',
      etiqueta: 'ETIQUETA',
      nombreEquipo: 'NOMBRE EQUIPO',
      serialCargador: 'SERIAL ADAPTADOR DE CARGA',
      garantia: 'GARANTIA VENC.',
      sistemaOperativo: 'SISTEMA OPERATIVO',
      serialWindows: 'SERIAL WINDOWS',
      tipoLicencia: 'TIPO DE LICENCIA',
      tamano: 'TAMAÑO',
      procesador: 'PROCESADOR',
      disco: 'DISCO',
      ram: 'RAM',
      estado: 'ESTADO DEL EQUIPO',
      responsable: 'USUARIO RESPONSABLE',
      ubicacion: 'UBICACIÓN',
      sesion: 'SESION DE USUARIO',
    },
    filasEsperadas: 86,
    procedencia: 'INVENTARIO EQUIPOS BBL',
  },

  {
    nombre: 'INVENTARIO PERIFERICOS BBL',
    empresa: 'BBL Labs',
    clase: 'periferico',
    asignable: true,
    exigidas: ['TIPO DE PERIFERICO', 'MARCA', 'DISPONIBILIDAD'],
    col: {
      tipo: 'TIPO DE PERIFERICO',
      marca: 'MARCA',
      modelo: 'MODELO',
      serial: 'SERIAL EQUIPO',
      responsable: 'USUARIO RESPONSABLE',
      cedula: 'CEDULA USUARIO',
      ubicacion: 'UBICACIÓN',
      disponibilidad: 'DISPONIBILIDAD',
      estado: 'ESTADO DEL EQUIPO',
    },
    filasEsperadas: 87,
    procedencia: 'INVENTARIO PERIFERICOS BBL',
  },
];

/**
 * Las hojas que existen en los libros y NO se importan, con el porqué.
 *
 * Están aquí y no solo en la documentación para que el importador pueda
 * comprobar que ha visto todas: si un libro trae una hoja que no está ni en
 * `HOJAS` ni aquí, es nueva y hay que mirarla antes de cargar. Una hoja nueva
 * que se ignora en silencio es inventario que nadie sabe que falta.
 */
export const HOJAS_IGNORADAS: Record<EmpresaHoja, { nombre: string; porque: string }[]> = {
  RIWI: [
    { nombre: 'Inicio', porque: 'Portada del libro.' },
    { nombre: 'Dashboard', porque: 'Gráficas calculadas.' },
    {
      nombre: 'INV - LIC WINDOWS',
      porque:
        'Plantilla del proveedor SIN RELLENAR (D47): NO. LICENCIA, VERSIÓN, SERIAL y ASIGNADO ' +
        'están a 0 de 3. No es inventario.',
    },
    { nombre: 'REVISIÓN - RESUMEN', porque: 'Resumen de la consolidación anterior.' },
    {
      nombre: 'REVISIÓN - DETALLE',
      porque:
        'Bitácora de una consolidación anterior (D49). No es inventario, pero se leyó: de ahí ' +
        'salen la regla de precedencia dentro del libro y la confirmación de que las colisiones ' +
        'ya estaban vistas.',
    },
    { nombre: 'Hoja3', porque: 'Vacía.' },
    { nombre: 'TABLA', porque: 'Tabla dinámica.' },
    { nombre: 'Catálogos', porque: 'Listas de validación del Excel.' },
  ],
  'BBL Labs': [
    { nombre: 'Dashboard', porque: 'Gráficas calculadas.' },
    { nombre: 'TABLA', porque: 'Tabla dinámica.' },
    {
      nombre: 'Calendario 2026',
      porque:
        'Calendario de mantenimiento agosto–diciembre 2026. No estaba en el encargo y no es ' +
        'inventario de equipos; queda anotado por si el módulo de mantenimiento lo quiere.',
    },
  ],
};

/**
 * `CONTROL DE CALIDAD` no se lee NUNCA (D45).
 *
 * Es una fórmula sin resultado guardado: leerla devuelve la fórmula o una
 * cadena vacía, y las dos cosas serían basura en la base. Sus reglas están
 * traducidas a motivos de revisión, que es lo que de verdad decía.
 *
 * Se declara aquí para que quede constancia de que la ausencia es deliberada y
 * no un olvido al copiar las columnas.
 */
export const COLUMNA_NO_IMPORTABLE = 'CONTROL DE CALIDAD';

/**
 * Lo que el propio Excel considera «aquí no hay dato», sacado de la fórmula de
 * `CONTROL DE CALIDAD` (D45).
 *
 * `Es de Claro` y `Sin rotulo` no estaban en nuestra lista: los trajo el
 * fichero. Sustituyen a la lista que el importador tenía escrita a mano.
 */
export const MARCADORES_DEL_FICHERO = [
  'N/A',
  'No aplica',
  'No tiene',
  '-',
  'Es de Claro',
  'Sin rotulo',
  'No',
];
