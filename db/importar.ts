/**
 * Importador de los dos archivos de origen. `npm run import`
 *
 * Etapa 5e: la base se reconstruye desde `INVENTARIO-RIWI.xlsx` e
 * `INVENTARIO-BBL.xlsx`. Las decisiones están en `docs/decisiones-05.md`; aquí
 * solo se aplican.
 *
 * Toda la carga ocurre en UNA transacción, los dos archivos juntos. O entra el
 * inventario entero o no entra nada: medio inventario dentro es peor que
 * ninguno, porque no se sabe dónde se cortó. Y con dos archivos hay una razón
 * más — el cruce entre ellos decide de quién es cada equipo, así que cargar uno
 * sin el otro dejaría seis máquinas mal atribuidas.
 *
 * El entregable es el reporte de rechazos, no la carga. Un importador que mete
 * las 305 filas sin marcar ninguna está mal, no bien.
 *
 * `BIOS PASSWORD` y `SERIAL WINDOWS` se leen y se cifran (§5). No se imprimen,
 * no se registran y no salen en el reporte, nunca. Y **solo se cifra lo que
 * tiene forma de secreto**: ver `leerSecreto`.
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import ExcelJS from 'exceljs';
import { eq, sql } from 'drizzle-orm';

import { cifrar } from './cifrado.js';
import { db, pool } from './cliente.js';
import {
  empleados,
  equipos,
  equiposMotivosRevision,
  importaciones,
  movimientos,
  sedes,
  usuariosApp,
} from './esquema.js';
import { MOTIVOS, type CodigoMotivo } from './motivos.js';

const RUTA_REPORTE = 'data/origen/reporte-rechazos.csv';
const EMAIL_SISTEMA = 'sistema@bbl.local';

type Empresa = 'RIWI' | 'BBL Labs' | 'Sin clasificar';
type Prestatario = 'RIWI' | 'BBL Labs' | 'ISF';

interface Fuente {
  empresa: Exclude<Empresa, 'Sin clasificar'>;
  ruta: string;
  hojaEquipos: string;
  hojaPerifericos: string;
}

/**
 * Los dos archivos, y de qué empresa es cada uno.
 *
 * El orden importa en un solo sitio y está documentado allí: al resolver los
 * seriales que están en los dos, el archivo del DUEÑO manda en propiedad y
 * specs, y el del PRESTATARIO en quién lo tiene (D33). Quién es cuál lo dicen
 * las marcas de préstamo de las propias filas, no esta lista.
 */
const FUENTES: Fuente[] = [
  {
    empresa: 'RIWI',
    ruta: 'data/origen/INVENTARIO-RIWI.xlsx',
    hojaEquipos: 'INV - EQUIPOS',
    hojaPerifericos: 'INV - PERIFERICOS',
  },
  {
    empresa: 'BBL Labs',
    ruta: 'data/origen/INVENTARIO-BBL.xlsx',
    hojaEquipos: 'INVENTARIO EQUIPOS BBL',
    hojaPerifericos: 'INVENTARIO PERIFERICOS BBL',
  },
];

/** Lo que la reconciliación exige antes del COMMIT. Ver `docs/decisiones-05.md`. */
const ESPERADO_EQUIPOS = 217;
const ESPERADO_PERIFERICOS = 88;

// ---------------------------------------------------------------------------
// Normalización de texto
// ---------------------------------------------------------------------------

/** minúsculas, sin tildes, espacios colapsados. La llave de matching. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * La llave de una CABECERA: espacios colapsados, sin espacios en los bordes y
 * sin distinguir mayúsculas.
 *
 * Existe porque una de las dos cabeceras viene sucia: los dos archivos traen
 * `'TIPO EQUIPO '` con espacio final (codepoint 32). Buscar la columna por su
 * nombre literal devuelve «no existe» y, según cómo se lea, 98 nulos
 * plausibles. En `leerHoja` no se devuelve un nulo plausible: se
 * revienta.
 */
const normCab = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Marcadores que los Excel usan para decir «aquí no hay dato». Van a NULL.
 *
 * `no tiene` sale de ETIQUETA en BBL (9 veces). `disponible` NO está aquí: es
 * un marcador solo en la columna de la persona, y ahí se trata aparte — en la
 * columna de estado es un valor legítimo.
 */
const MARCADORES = new Set([
  'n/a',
  'na',
  'no aplica',
  'no tiene',
  'ninguno',
  'sin asignar',
  '-',
  '--',
  '.',
]);

const esMarcador = (s: string) => MARCADORES.has(norm(s));

/** Texto de la celda, o null si está vacía o es un marcador de ausencia. */
function limpio(s: string): string | null {
  const t = s.trim();
  if (!t || esMarcador(t)) return null;
  return t;
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as Record<string, unknown>;
  if ('text' in o) return texto(o.text); // Hyperlink: los correos de SESION DE USUARIO
  if ('result' in o) return texto(o.result); // Formula
  if ('richText' in o) return (o.richText as { text: string }[]).map((r) => r.text).join('').trim();
  return String(v);
}

// ---------------------------------------------------------------------------
// Lectura de hojas
// ---------------------------------------------------------------------------

interface Fila {
  numero: number;
  hoja: string;
  fuente: Fuente;
  celda: (columna: string) => string;
}

/**
 * Las columnas que cada hoja tiene que traer. Si falta una, el importador
 * **aborta**: no hay carga a medias, ni una columna leída como vacía.
 *
 * `BIOS PASSWORD` no está en las de equipos porque RIWI no la tiene, y eso es
 * un hecho del archivo, no una falta. Sus 98 equipos van con NULL.
 */
const COLUMNAS_EQUIPOS = [
  'TIPO EQUIPO',
  'MARCA',
  'MODELO',
  'SERIAL EQUIPO',
  'ETIQUETA',
  'NOMBRE EQUIPO',
  'SISTEMA OPERATIVO',
  'SERIAL WINDOWS',
  'TIPO DE LICENCIA',
  'TAMAÑO',
  'PROCESADOR',
  'DISCO',
  'RAM',
  'ESTADO DEL EQUIPO',
  'USUARIO RESPONSABLE',
  'UBICACIÓN',
  'SESION DE USUARIO',
];

const COLUMNAS_PERIFERICOS = [
  'TIPO DE PERIFERICO',
  'MARCA',
  'MODELO',
  'SERIAL EQUIPO',
  'USUARIO RESPONSABLE',
  'UBICACIÓN',
  'DISPONIBILIDAD',
  'ESTADO DEL EQUIPO',
];

/**
 * Lee una hoja **normalizando las cabeceras antes de mirar ningún dato**, y
 * revienta si falta alguna de las esperadas.
 *
 * El fallo ruidoso es el punto entero de esta función. La alternativa —devolver
 * cadena vacía para una columna que no existe— produce nulos que parecen datos:
 * exactamente lo que pasó al explorar estos archivos, donde preguntar por
 * `'TIPO EQUIPO'` (sin el espacio final que traen los dos) devolvió 98 celdas
 * «vacías» que en realidad estaban llenas.
 */
function leerHoja(wb: ExcelJS.Workbook, fuente: Fuente, nombreHoja: string, exigidas: string[]) {
  const hoja = wb.getWorksheet(nombreHoja);
  if (!hoja) {
    const hay = wb.worksheets.map((h) => `"${h.name}"`).join(', ');
    throw new Error(`${fuente.ruta}: no existe la hoja "${nombreHoja}". Hay: ${hay}`);
  }

  // cabecera normalizada -> índice de columna
  const indice = new Map<string, number>();
  const crudas: string[] = [];
  for (let c = 1; c <= hoja.columnCount; c++) {
    const cruda = texto(hoja.getRow(1).getCell(c).value);
    if (!cruda) continue;
    crudas.push(cruda);
    const k = normCab(cruda);
    // Dos columnas con el mismo nombre tras normalizar es ambigüedad, no un
    // detalle: cuál gana decidiría en silencio qué datos se cargan.
    if (indice.has(k)) {
      throw new Error(
        `${fuente.ruta} / ${nombreHoja}: dos columnas se llaman "${k}" tras normalizar. ` +
          `Renombrar una en el Excel antes de importar.`,
      );
    }
    indice.set(k, c);
  }

  const faltan = exigidas.filter((e) => !indice.has(normCab(e)));
  if (faltan.length > 0) {
    throw new Error(
      `${fuente.ruta} / ${nombreHoja}: faltan columnas esperadas: ${faltan.join(', ')}.\n` +
        `  La hoja trae: ${crudas.map((c) => JSON.stringify(c)).join(', ')}\n` +
        `  (las cabeceras se comparan sin tildes de espaciado ni mayúsculas; si el nombre está ` +
        `ahí pero escrito distinto, hay que añadir el alias, no bajar la exigencia)`,
    );
  }

  const filas: Fila[] = [];
  for (let r = 2; r <= hoja.rowCount; r++) {
    const valores = new Map<string, string>();
    let algo = false;
    for (const [k, c] of indice) {
      const t = texto(hoja.getRow(r).getCell(c).value);
      if (t) algo = true;
      valores.set(k, t);
    }
    if (!algo) continue;
    filas.push({
      numero: r,
      hoja: nombreHoja,
      fuente,
      celda: (columna: string) => {
        const k = normCab(columna);
        // Pedir una columna que no se exigió arriba es un error de programación,
        // no un dato que falta. Se distingue del valor vacío a propósito.
        if (!indice.has(k)) {
          throw new Error(`${nombreHoja}: se pidió la columna "${columna}", que no existe.`);
        }
        return valores.get(k) ?? '';
      },
    });
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Los campos cifrados
// ---------------------------------------------------------------------------

/** `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`, que es lo que es una clave de Windows. */
const CLAVE_EXACTA = /^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/i;
/** Cinco grupos alfanuméricos, pero con alguno de longitud equivocada. */
const CLAVE_CON_ERRATA = /^[A-Z0-9]{4,6}(-[A-Z0-9]{4,6}){4}$/i;

/**
 * Decide si un valor de una columna cifrada es un secreto de verdad.
 *
 * **Este es el hallazgo con más alcance de la exploración.** De las 126 filas
 * de BBL, solo 39 traen una clave de Windows: las otras dicen `OK` (37),
 * `Licenciado` (21), `N/A` (11), `Sin licencia` (11), `Ya tenia licencia` (2) o
 * `No aplica` (1). Cifrar lo que venga mete 87 «secretos» que no son secretos
 * en una columna que, por la regla 4, no aparece en listados, logs ni
 * exportaciones: comprobarlo después obligaría a descifrar uno por uno. Es el
 * peor sitio posible para esconder un marcador.
 *
 * Los que tienen forma de clave con una errata —un grupo de 4, otro de 6— SÍ se
 * cifran: son datos reales mal transcritos, y tirarlos perdería la única copia.
 * Van marcados aparte para que alguien los corrija.
 */
function leerSecreto(
  bruto: string,
  columna: 'SERIAL WINDOWS' | 'BIOS PASSWORD',
): { cifrado: Buffer | null; motivo: CodigoMotivo | null } {
  const v = bruto.trim();
  if (!v) return { cifrado: null, motivo: null };

  if (columna === 'SERIAL WINDOWS') {
    if (CLAVE_EXACTA.test(v)) return { cifrado: cifrar(v), motivo: null };
    if (CLAVE_CON_ERRATA.test(v)) {
      return { cifrado: cifrar(v), motivo: 'CLAVE_WINDOWS_MALFORMADA' };
    }
    // Todo lo demás —marcadores, «SI», un Product ID de Windows, la marca de
    // préstamo— no es una clave y no se cifra.
    return { cifrado: null, motivo: 'SECRETO_NO_ES_SECRETO' };
  }

  // BIOS PASSWORD no tiene forma reconocible: 116 de las de BBL son de dos
  // caracteres. Lo único que se puede afirmar es que un marcador no es una
  // contraseña.
  if (esMarcador(v)) return { cifrado: null, motivo: 'SECRETO_NO_ES_SECRETO' };
  return { cifrado: cifrar(v), motivo: null };
}

// ---------------------------------------------------------------------------
// Normalizaciones de valores
// ---------------------------------------------------------------------------

type EstadoEquipo =
  | 'Disponible'
  | 'Asignado'
  | 'En mantenimiento'
  | 'Reservado'
  | 'De baja'
  | 'Prestado';
type Categoria =
  | 'Portátil'
  | 'Desktop'
  | 'Monitor'
  | 'Teclado'
  | 'Mouse'
  | 'Diadema'
  | 'Celular'
  | 'Otro';
type Condicion = 'Nuevo' | 'Excelente' | 'Bueno' | 'Usado' | 'Requiere reparación';
type Licencia = 'RETAIL' | 'OEM' | 'Sin licencia' | 'No aplica';

/** La marca de préstamo que RIWI escribió encima de siete columnas técnicas. */
const PRESTAMO_BBL = 'prestamo bbl';

function mapearEstado(bruto: string): {
  estado: EstadoEquipo;
  prestado_a: Prestatario | null;
  motivo: CodigoMotivo | null;
} {
  const n = norm(bruto);
  if (!n) return { estado: 'Disponible', prestado_a: null, motivo: 'ESTADO_NO_APLICA' };
  if (n === 'asignado') return { estado: 'Asignado', prestado_a: null, motivo: null };
  if (n === 'disponible' || n === 'stock') {
    return { estado: 'Disponible', prestado_a: null, motivo: null };
  }
  if (n === 'de baja') return { estado: 'De baja', prestado_a: null, motivo: null };
  // «Disponible - Revisión»: el equipo está, pero alguien quería mirarlo.
  if (n.includes('revision')) {
    return { estado: 'Disponible', prestado_a: null, motivo: 'ESTADO_REVISION' };
  }
  // «No asignar» es una reserva escrita en prosa: el equipo existe, está bien y
  // no se debe entregar. `Reservado` es exactamente eso.
  if (n === 'no asignar') return { estado: 'Reservado', prestado_a: null, motivo: null };
  // ISF es una empresa, no un estado: el equipo está prestado y ella lo tiene.
  if (n === 'isf') return { estado: 'Prestado', prestado_a: 'ISF', motivo: null };
  // `PRESTAMO` a secas no dice a quién. Quién sea lo resuelve el cruce entre
  // archivos; si nadie lo resuelve, queda marcado más abajo.
  if (n === 'prestamo') return { estado: 'Prestado', prestado_a: null, motivo: null };
  return { estado: 'Disponible', prestado_a: null, motivo: 'ESTADO_NO_APLICA' };
}

function mapearCategoria(bruto: string): { categoria: Categoria; cliente: boolean; falta: boolean } {
  const n = norm(bruto);
  if (n === 'pc del cliente') return { categoria: 'Portátil', cliente: true, falta: false };
  if (n === 'portatil') return { categoria: 'Portátil', cliente: false, falta: false };
  if (n === 'escritorio' || n === 'desktop') return { categoria: 'Desktop', cliente: false, falta: false };
  return { categoria: 'Portátil', cliente: false, falta: true };
}

function mapearLicencia(bruto: string): { licencia: Licencia | null; motivo: CodigoMotivo | null } {
  const n = norm(bruto);
  if (!n) return { licencia: null, motivo: null };
  if (n === 'ok') return { licencia: null, motivo: 'LICENCIA_OK' };
  if (n === 'retail') return { licencia: 'RETAIL', motivo: null };
  if (n === 'oem') return { licencia: 'OEM', motivo: null };
  if (n === 'sin licencia') return { licencia: 'Sin licencia', motivo: null };
  // `N/A` no se colapsa a NULL como en el resto de campos: el enum tiene el
  // miembro 'No aplica' justamente para esto, y colapsarlo borraría la
  // diferencia entre «no lleva licencia» y «nadie lo rellenó».
  if (n === 'n/a' || n === 'no aplica') return { licencia: 'No aplica', motivo: null };
  // «PRESTAMO BBL» y «14 Pulgadas» caen aquí: la columna traía otra cosa.
  return { licencia: null, motivo: 'LICENCIA_NO_ES_LICENCIA' };
}

/** Marca/modelo, con las dos normalizaciones que ya venían de la etapa 2. */
function normalizarMarca(marca: string | null, modelo: string | null) {
  if (!marca) return { marca: null, modelo };
  if (norm(marca) === 'macbook air') return { marca: 'Apple', modelo: modelo ?? 'MacBook Air' };
  if (norm(marca) === 'macbook pro') return { marca: 'Apple', modelo: modelo ?? 'MacBook Pro' };
  if (norm(marca) === 'asus tuf') {
    const m = modelo ?? '';
    return { marca: 'ASUS', modelo: norm(m).startsWith('tuf') ? m : `TUF ${m}`.trim() };
  }
  if (norm(marca) === 'asus') return { marca: 'Asus', modelo };
  return { marca, modelo };
}

/**
 * A qué sede corresponde una ubicación escrita.
 *
 * `null` con `mapea: false` significa «esto no se adivina»: la fila entra con
 * `sede_id = NULL` y su motivo (D7 c). El único mapeo que sí se hace es
 * `Remoto - Sabaneta` → `Remoto`, y va marcado igual: con la regla de dirección
 * obligatoria para Remoto (D30), mapearlo hace que el aviso salte sobre esa
 * persona en vez de esconderla en una ubicación que no existe.
 *
 * `ISF` no es una sede ni un valor sucio: es la consecuencia del préstamo, y
 * `prestado_a` ya lo dice. Va a NULL **sin marca**.
 */
function mapearUbicacion(bruto: string): {
  sede: string | null;
  motivo: CodigoMotivo | null;
} {
  const n = norm(bruto);
  if (!n) return { sede: null, motivo: 'SIN_UBICACION' };
  if (n === 'isf') return { sede: null, motivo: null };
  if (n.startsWith('remoto')) return { sede: 'Remoto', motivo: 'UBICACION_FUERA_DE_SEDES' };
  return { sede: bruto.trim(), motivo: null };
}

/**
 * El nombre de una persona, o null si la celda no trae una.
 *
 * Dos cosas que no son un nombre y lo parecen: los marcadores del archivo
 * (`PRESTAMOS`, `Disponible`, `POLIZA DE SEGURO`, `z No asignar`, `PRESTAMO A
 * RIWI`, `Recepcion`) y el sufijo de empresa pegado al nombre real
 * (`Alex Rincon ISF`). Lo primero va a NULL con su marca; lo segundo se recorta
 * y la persona se conserva — el hecho que el sufijo transmitía ya lo lleva
 * `prestado_a`.
 */
const NO_PERSONA = new Set([
  'prestamos',
  'prestamo',
  'disponible',
  'poliza de seguro',
  'z no asignar',
  'no asignar',
  'recepcion',
  'prestamo a riwi',
  'prestamo a bbl',
]);

/** «PRESTAMO A RIWI» / «PRESTAMO A BBL» en cualquier casilla de texto. */
function leerMarcaPrestamo(...brutos: string[]): Prestatario | null {
  for (const b of brutos) {
    const n = norm(b);
    if (!n.startsWith('prestamo a ')) continue;
    const destino = n.slice('prestamo a '.length).trim();
    if (destino.startsWith('riwi')) return 'RIWI';
    if (destino.startsWith('bbl')) return 'BBL Labs';
    if (destino.startsWith('isf')) return 'ISF';
  }
  return null;
}

function leerPersona(bruto: string): { persona: string | null; motivo: CodigoMotivo | null } {
  const v = bruto.trim();
  if (!v) return { persona: null, motivo: null };
  const n = norm(v);
  if (esMarcador(v) || NO_PERSONA.has(n) || n.startsWith('prestamo ')) {
    return { persona: null, motivo: 'RESPONSABLE_NO_PERSONA' };
  }
  const sinSufijo = v.replace(/\s+ISF\s*$/i, '').trim();
  return { persona: sinSufijo || null, motivo: null };
}

// ---------------------------------------------------------------------------
// Candidatas
// ---------------------------------------------------------------------------

interface Candidata {
  archivo: string;
  hoja: string;
  fila: number;
  esEquipo: boolean;
  motivos: CodigoMotivo[];
  rechazada: boolean;
  /** Sustituida por otra fila: el duplicado de bloque, o el cruce entre archivos. */
  absorbida: boolean;
  persona: string | null;
  responsable: string | null;
  cedula: string | null;
  empresa: Empresa;
  /**
   * «PRESTAMO A RIWI» escrito en la casilla de la persona: la fila del DUEÑO
   * diciendo a quién se lo prestó. No es un nombre, pero tampoco es basura —
   * es la única pista de dirección que tiene esa fila, y tirarla con el resto
   * de marcadores fue lo que dejó `46H9494` como propiedad ambigua cuando los
   * dos archivos coinciden en que es un préstamo de BBL a RIWI.
   */
  prestaA: Prestatario | null;
  ubicacionOriginal: string;
  sedeNombre: string | null;
  datos: {
    categoria: Categoria;
    etiqueta: string | null;
    nombre_equipo: string | null;
    marca: string | null;
    modelo: string | null;
    serial: string | null;
    serial_cargador: string | null;
    propiedad: 'Empresa' | 'Cliente' | 'Empleado';
    sistema_operativo: string | null;
    licencia_tipo: Licencia | null;
    licencia_serial_cifrado: Buffer | null;
    bios_password_cifrado: Buffer | null;
    tamano_pantalla: string | null;
    procesador: string | null;
    disco: string | null;
    ram: string | null;
    estado: EstadoEquipo;
    prestado_a: Prestatario | null;
    condicion: Condicion | null;
    sesion_usuario: string | null;
    notas: string | null;
  };
}

function candidataDeEquipo(f: Fila, dupSerial: Set<string>, dupEtiqueta: Set<string>): Candidata {
  const motivos: CodigoMotivo[] = [];
  const notas: string[] = [];
  const anota = (m: CodigoMotivo | null) => {
    if (m && !motivos.includes(m)) motivos.push(m);
  };

  const tipoBruto = f.celda('TIPO EQUIPO');
  const { categoria, cliente, falta: tipoAusente } = mapearCategoria(tipoBruto);
  if (tipoAusente) anota('SIN_TIPO');

  const { estado: estadoBase, prestado_a, motivo: motivoEstado } = mapearEstado(
    f.celda('ESTADO DEL EQUIPO'),
  );
  anota(motivoEstado);

  // D7 (a): una fila sin tipo NI estado no describe ningún equipo. Importarla
  // crearía un activo fantasma que nadie podría cerrar. La persona que nombra
  // sí se crea, más abajo.
  const rechazada = tipoAusente && motivoEstado === 'ESTADO_NO_APLICA';

  // ------------------------------------------------------- bloque técnico
  //
  // «PRESTAMO BBL» no ocupa la columna de licencia: ocupa SIETE —SO, serial de
  // Windows, licencia, tamaño, procesador, disco y RAM— en las tres filas que
  // la traen. Todo el bloque es un marcador, así que entra vacío y marcado. Si
  // solo se tratara la columna de licencia, la cadena acabaría escrita en
  // `procesador`, `disco` y `ram`, y cifrada en `licencia_serial`.
  const marcadoPrestamo = norm(f.celda('TAMAÑO')) === PRESTAMO_BBL;
  if (marcadoPrestamo) anota('MARCADOR_EN_CAMPO_TECNICO');

  // Las dos filas con las columnas corridas desde TIPO DE LICENCIA. No se
  // recolocan —adivinar el orden sería inventar—: se importa lo que se pueda y
  // el bloque desplazado entra vacío.
  const desplazada = norm(f.celda('TIPO DE LICENCIA')).includes('pulgada');
  if (desplazada) anota('COLUMNAS_DESPLAZADAS');

  const bloqueInservible = marcadoPrestamo || desplazada;

  const { licencia, motivo: motivoLicencia } = bloqueInservible
    ? { licencia: null, motivo: 'LICENCIA_NO_ES_LICENCIA' as CodigoMotivo }
    : mapearLicencia(f.celda('TIPO DE LICENCIA'));
  anota(motivoLicencia);

  const secretoWin = bloqueInservible
    ? { cifrado: null, motivo: 'SECRETO_NO_ES_SECRETO' as CodigoMotivo }
    : leerSecreto(f.celda('SERIAL WINDOWS'), 'SERIAL WINDOWS');
  anota(secretoWin.motivo);

  // RIWI no tiene columna BIOS PASSWORD, y eso no es una falta: sus 98 equipos
  // van con NULL. `celda` reventaría si se pidiera, así que se pregunta antes.
  const tieneBios = f.fuente.empresa === 'BBL Labs';
  const secretoBios = tieneBios
    ? leerSecreto(f.celda('BIOS PASSWORD'), 'BIOS PASSWORD')
    : { cifrado: null, motivo: null };
  anota(secretoBios.motivo);

  // ------------------------------------------------------------- identidad
  const marcaBruta = limpio(f.celda('MARCA'));
  const { marca, modelo } = normalizarMarca(marcaBruta, limpio(f.celda('MODELO')));
  // D7 (b): en un PC del cliente la ausencia de marca, serial y etiqueta es
  // esperable — la máquina no es de la empresa y TI no la inventaría.
  // `propiedad = 'Cliente'` ya lo explica; marcarlo serían falsos positivos
  // permanentes en la bandeja.
  if (!marca && !cliente) anota('SIN_MARCA');

  const serial = limpio(f.celda('SERIAL EQUIPO'));
  if (!serial && !cliente) anota('SIN_SERIAL');
  if (serial && dupSerial.has(norm(serial))) anota('SERIAL_DUPLICADO');

  const etiqueta = limpio(f.celda('ETIQUETA'));
  if (!etiqueta && !cliente) anota('SIN_ETIQUETA');
  if (etiqueta && dupEtiqueta.has(norm(etiqueta))) anota('ETIQUETA_DUPLICADA');

  const ubicacionOriginal = f.celda('UBICACIÓN');
  const { sede, motivo: motivoUbicacion } = mapearUbicacion(ubicacionOriginal);
  anota(motivoUbicacion);

  // ------------------------------------------------------------ responsable
  const respBruto = f.celda('USUARIO RESPONSABLE');
  const { persona, motivo: motivoPersona } = leerPersona(respBruto);
  anota(motivoPersona);
  if (motivoPersona) notas.push(`USUARIO RESPONSABLE de origen: "${respBruto}"`);

  const prestaA = leerMarcaPrestamo(respBruto, f.celda('SESION DE USUARIO'));

  let estado = estadoBase;
  let responsable: string | null = null;

  if (!persona) {
    if (estado === 'Asignado') {
      // Violar el invariante no es una opción: entra como Disponible y marcada.
      estado = 'Disponible';
      anota('ASIGNADO_SIN_RESPONSABLE');
    }
  } else if (estado === 'Asignado') {
    responsable = persona;
  } else if (estado === 'Prestado') {
    // Desde la 0012, `Prestado` es el único estado que admite responsable. Es
    // justo lo que salva a las ocho filas que dicen quién tiene el portátil.
    responsable = persona;
  } else {
    anota('RESPONSABLE_EN_ESTADO_NO_ASIGNADO');
    notas.push(`Responsable "${persona}" con estado "${f.celda('ESTADO DEL EQUIPO')}"`);
  }

  if (estado === 'Prestado' && !prestado_a) anota('PRESTATARIO_DESCONOCIDO');

  // La sesión que no concuerda con el responsable: puede ser un cambio de
  // manos sin registrar. Solo se mira cuando las dos cosas son personas.
  const sesion = limpio(f.celda('SESION DE USUARIO'));
  if (persona && sesion && sesion.includes('@')) {
    const usuario = norm(sesion.split('@')[0]).replace(/[._-]+/g, ' ');
    const partes = norm(persona).split(' ');
    if (!partes.some((p) => p.length > 2 && usuario.includes(p))) {
      anota('SESION_NO_CONCUERDA');
      notas.push(`Sesión "${sesion}" no concuerda con "${persona}"`);
    }
  }

  return {
    archivo: f.fuente.ruta,
    hoja: f.hoja,
    fila: f.numero,
    esEquipo: true,
    motivos,
    rechazada,
    absorbida: false,
    persona,
    responsable,
    cedula: null,
    empresa: f.fuente.empresa,
    prestaA,
    ubicacionOriginal,
    sedeNombre: sede,
    datos: {
      categoria,
      etiqueta,
      nombre_equipo: limpio(f.celda('NOMBRE EQUIPO')),
      marca,
      modelo,
      serial,
      serial_cargador: null,
      propiedad: cliente ? 'Cliente' : 'Empresa',
      sistema_operativo: bloqueInservible ? null : limpio(f.celda('SISTEMA OPERATIVO')),
      licencia_tipo: licencia,
      licencia_serial_cifrado: secretoWin.cifrado,
      bios_password_cifrado: secretoBios.cifrado,
      tamano_pantalla: bloqueInservible ? null : limpio(f.celda('TAMAÑO')),
      procesador: bloqueInservible ? null : limpio(f.celda('PROCESADOR')),
      disco: bloqueInservible ? null : limpio(f.celda('DISCO')),
      ram: bloqueInservible ? null : limpio(f.celda('RAM')),
      estado,
      prestado_a,
      condicion: null,
      sesion_usuario: sesion,
      notas: notas.length ? notas.join(' | ') : null,
    },
  };
}

const CATEGORIA_PERIFERICO: Record<string, Categoria> = {
  diademas: 'Diadema',
  diadema: 'Diadema',
  mouse: 'Mouse',
  teclado: 'Teclado',
  teclados: 'Teclado',
  monitor: 'Monitor',
  monitores: 'Monitor',
};

function candidataDePeriferico(f: Fila, dupSerial: Set<string>): Candidata {
  const motivos: CodigoMotivo[] = [];
  const notas: string[] = [];
  const anota = (m: CodigoMotivo | null) => {
    if (m && !motivos.includes(m)) motivos.push(m);
  };

  const tipoBruto = f.celda('TIPO DE PERIFERICO');
  const categoria = CATEGORIA_PERIFERICO[norm(tipoBruto)] ?? 'Otro';
  // `Otro` aquí NO se marca: cámara, HDD externo y adaptador tipo C son
  // periféricos reales que el enum no enumera. Lo que se marca es no saber
  // qué es, y eso solo pasa si la celda viene vacía o con un marcador.
  if (!limpio(tipoBruto)) anota('SIN_TIPO');

  const serial = limpio(f.celda('SERIAL EQUIPO'));
  if (!serial) anota('SIN_SERIAL');
  if (serial && dupSerial.has(norm(serial))) anota('SERIAL_REPETIDO_PERIFERICO');

  const ubicacionOriginal = f.celda('UBICACIÓN');
  const { sede, motivo: motivoUbicacion } = mapearUbicacion(ubicacionOriginal);
  anota(motivoUbicacion);

  const condicionBruta = norm(f.celda('ESTADO DEL EQUIPO'));
  const condicion: Condicion | null =
    condicionBruta === 'nuevo' ? 'Nuevo' : condicionBruta === 'usado' ? 'Usado' : null;

  const disponibilidad = norm(f.celda('DISPONIBILIDAD'));
  let estado: EstadoEquipo = disponibilidad === 'asignado' ? 'Asignado' : 'Disponible';

  const respBruto = f.celda('USUARIO RESPONSABLE');
  const { persona, motivo: motivoPersona } = leerPersona(respBruto);
  anota(motivoPersona);
  if (motivoPersona) notas.push(`USUARIO RESPONSABLE de origen: "${respBruto}"`);

  let responsable: string | null = null;
  if (!persona) {
    if (estado === 'Asignado') {
      estado = 'Disponible';
      anota('ASIGNADO_SIN_RESPONSABLE');
    }
  } else if (estado === 'Asignado') {
    responsable = persona;
  } else {
    anota('RESPONSABLE_EN_ESTADO_NO_ASIGNADO');
    notas.push(`Responsable "${persona}" con disponibilidad "${f.celda('DISPONIBILIDAD')}"`);
  }

  return {
    archivo: f.fuente.ruta,
    hoja: f.hoja,
    fila: f.numero,
    esEquipo: false,
    motivos,
    rechazada: false,
    absorbida: false,
    persona,
    responsable,
    cedula: limpio(f.celda('CEDULA USUARIO')),
    empresa: f.fuente.empresa,
    prestaA: null,
    ubicacionOriginal,
    sedeNombre: sede,
    datos: {
      categoria,
      // La hoja de periféricos no tiene columna de etiqueta. Su ausencia no es
      // un hueco de datos, así que no se marca.
      etiqueta: null,
      nombre_equipo: null,
      marca: limpio(f.celda('MARCA')),
      modelo: limpio(f.celda('MODELO')),
      serial,
      serial_cargador: null,
      propiedad: 'Empresa',
      sistema_operativo: null,
      licencia_tipo: null,
      licencia_serial_cifrado: null,
      bios_password_cifrado: null,
      tamano_pantalla: null,
      procesador: null,
      disco: null,
      ram: null,
      estado,
      prestado_a: null,
      condicion,
      sesion_usuario: null,
      notas: notas.length ? notas.join(' | ') : null,
    },
  };
}

/** Valores que aparecen más de una vez en una columna de una hoja. */
function repetidos(filas: Fila[], columna: string): Set<string> {
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    const s = limpio(f.celda(columna));
    if (s) cuenta.set(norm(s), (cuenta.get(norm(s)) ?? 0) + 1);
  }
  return new Set([...cuenta.entries()].filter(([, n]) => n > 1).map(([s]) => s));
}

// ---------------------------------------------------------------------------
// El bloque repetido de periféricos
// ---------------------------------------------------------------------------

/**
 * Detecta un bloque de filas CONTIGUAS que repite filas anteriores de la misma
 * hoja, y devuelve qué fila absorbe a cuál.
 *
 * La hoja de periféricos de RIWI trae las filas 24–33 copiando en orden las
 * filas 4, 6, 7, 8, 9, 10, 11, 12, 13 y 14. Diez periféricos fantasma contables
 * como disponibles es peor que perder una copia (D31: una fila por máquina
 * física), así que se importa una vez.
 *
 * **Por qué «bloque contiguo en orden» y no «mismo serial»:** BBL también
 * repite seriales —`JNZMR0117` está en cuatro ratones de cuatro personas
 * distintas, `11438` en dos diademas con condiciones distintas— y esos NO son
 * la misma máquina, son un modelo escrito en la casilla del serial. Colapsar
 * por serial se los llevaría por delante. Lo que distingue al bloque de RIWI es
 * que es un pegado: filas seguidas cuyos originales van también en orden.
 *
 * El mínimo de 3 evita que una coincidencia suelta se lea como un bloque.
 */
function detectarBloqueDuplicado(filas: Fila[]): Map<number, number> {
  const huella = (f: Fila) =>
    [
      norm(f.celda('TIPO DE PERIFERICO')),
      norm(f.celda('MARCA')),
      norm(f.celda('MODELO')),
      norm(limpio(f.celda('SERIAL EQUIPO')) ?? ''),
    ].join('|');

  /**
   * La huella sola no basta, y BBL lo demuestra: tiene once ratones
   * `Logitech M170` sin serial, uno por persona. Son once ratones, no once
   * copias de uno. Lo que los distingue es a quién están asignados.
   *
   * Compatible = mismo responsable, o **la copia sin responsable**. Ese segundo
   * caso es real: en el bloque de RIWI, la fila 33 repite la 14 con la casilla
   * de la persona vacía, y sigue siendo la misma máquina. Al revés no: una fila
   * con persona no puede ser copia de otra con OTRA persona.
   */
  const compatible = (copia: Fila, original: Fila) => {
    const a = norm(limpio(copia.celda('USUARIO RESPONSABLE')) ?? '');
    const b = norm(limpio(original.celda('USUARIO RESPONSABLE')) ?? '');
    return a === '' || a === b;
  };

  const porHuella = new Map<string, number[]>();
  filas.forEach((f, i) => {
    const h = huella(f);
    if (!porHuella.has(h)) porHuella.set(h, []);
    porHuella.get(h)!.push(i);
  });

  const absorbidoPor = new Map<number, number>();
  let i = 0;
  while (i < filas.length) {
    // ¿Empieza aquí una racha de filas con gemela anterior en orden creciente?
    const racha: { copia: number; original: number }[] = [];
    let j = i;
    let ultimoOriginal = -1;
    while (j < filas.length) {
      const previos = (porHuella.get(huella(filas[j])) ?? []).filter(
        (k) => k < j && k > ultimoOriginal && !absorbidoPor.has(k) && compatible(filas[j], filas[k]),
      );
      if (previos.length === 0) break;
      racha.push({ copia: j, original: previos[0] });
      ultimoOriginal = previos[0];
      j++;
    }
    if (racha.length >= 3) {
      for (const { copia, original } of racha) absorbidoPor.set(copia, original);
      i = j;
    } else {
      i++;
    }
  }
  return absorbidoPor;
}

// ---------------------------------------------------------------------------
// El cruce entre los dos archivos
// ---------------------------------------------------------------------------

/**
 * Resuelve los seriales que están en los dos archivos.
 *
 * **La regla, de D33:** el archivo del DUEÑO manda en propiedad, specs y
 * etiqueta; el del PRESTATARIO manda en quién lo tiene hoy. Es coherente con
 * cómo funciona un préstamo — quien presta no sabe a quién se lo dieron dentro
 * de la otra empresa.
 *
 * «Gana la fila de BBL» sin más no vale, y los datos lo demuestran: en
 * `DGYD774` y `53XQP74`, BBL escribe «Disponible» en la casilla de la persona
 * —un marcador— mientras RIWI sabe que los tienen Daniel Gil y Angelo Gaviria.
 * La fila que ganaría sería la que no sabe lo que hace falta saber.
 *
 * De quién es el equipo lo dicen las marcas de las propias filas, no una lista
 * de seriales escrita aquí:
 *   - una fila con la marca de préstamo del OTRO archivo en su bloque técnico,
 *     o con estado `Prestado`, es la del prestatario;
 *   - una fila cuya casilla de persona dice «PRESTAMO A <empresa>» es la del
 *     dueño, y ya nombra a quién se lo prestó.
 * Si ninguna de las dos habla, la propiedad queda marcada.
 */
function cruzarArchivos(candidatas: Candidata[]): void {
  const equipos = candidatas.filter((c) => c.esEquipo && !c.rechazada && c.datos.serial);
  const porSerial = new Map<string, Candidata[]>();
  for (const c of equipos) {
    const k = norm(c.datos.serial!);
    if (!porSerial.has(k)) porSerial.set(k, []);
    porSerial.get(k)!.push(c);
  }

  for (const [, grupo] of porSerial) {
    const empresas = new Set(grupo.map((c) => c.empresa));
    // Un serial repetido DENTRO de un archivo ya está marcado como duplicado y
    // no se toca: son dos filas de la misma empresa, no un préstamo.
    if (empresas.size < 2 || grupo.length !== 2) continue;

    const [a, b] = grupo;

    // Dos señales, y las dos valen. La del prestatario: su fila dice
    // 'Prestado'. La del dueño: su casilla de persona dice «PRESTAMO A X».
    // `46H9494` solo tiene la segunda —RIWI lo lista como 'Asignado' a Carlos
    // Castaño y BBL escribe «PRESTAMO A RIWI»—, así que mirando solo la
    // primera se leía como propiedad ambigua cuando los dos archivos están de
    // acuerdo.
    let prestatario =
      a.datos.estado === 'Prestado' ? a : b.datos.estado === 'Prestado' ? b : null;
    if (!prestatario) {
      const conMarca = a.prestaA ? a : b.prestaA ? b : null;
      if (conMarca) prestatario = conMarca === a ? b : a;
    }
    const dueño = prestatario ? (prestatario === a ? b : a) : null;

    if (prestatario && dueño) {
      // El dueño manda en propiedad, specs y etiqueta: su fila es la que entra.
      // El prestatario manda en quién lo tiene: eso se copia encima.
      dueño.datos.estado = 'Prestado';
      dueño.datos.prestado_a = prestatario.empresa as Prestatario;
      dueño.motivos = [...new Set([...dueño.motivos, ...prestatario.motivos])].filter(
        (m) => m !== 'PRESTATARIO_DESCONOCIDO' && m !== 'ASIGNADO_SIN_RESPONSABLE',
      );

      const nota = [
        `Prestado a ${prestatario.empresa}.`,
        `Fila de origen del prestatario: ${prestatario.archivo} ${prestatario.hoja} fila ${prestatario.fila}` +
          (prestatario.datos.etiqueta ? ` (etiqueta "${prestatario.datos.etiqueta}")` : ''),
      ];

      if (prestatario.persona && dueño.persona && norm(prestatario.persona) !== norm(dueño.persona)) {
        // Los dos archivos nombran a personas distintas. No hay criterio para
        // elegir, así que no se elige: el equipo entra sin responsable y con
        // los dos nombres a la vista.
        dueño.motivos.push('RESPONSABLE_EN_CONFLICTO');
        nota.push(
          `Responsable según ${dueño.empresa}: "${dueño.persona}"; según ${prestatario.empresa}: "${prestatario.persona}". No se eligió ninguno.`,
        );
        dueño.responsable = null;
      } else if (prestatario.persona) {
        // El caso normal: solo el prestatario sabe quién lo tiene.
        dueño.persona = prestatario.persona;
        dueño.responsable = prestatario.persona;
        nota.push(`Lo tiene ${prestatario.persona}, de ${prestatario.empresa}.`);
        // Y la marca del dueño se retira: decía «esta casilla trae un marcador
        // en vez de un nombre», y el otro archivo acaba de dar el nombre. La
        // bandeja de limpieza es para lo que queda por resolver; esto ya lo
        // está. La nota conserva lo que decía la casilla, que es lo que hay
        // que arreglar en el Excel de origen, no en la base.
        dueño.motivos = dueño.motivos.filter((m) => m !== 'RESPONSABLE_NO_PERSONA');
      }

      dueño.datos.notas = [dueño.datos.notas, ...nota].filter(Boolean).join(' | ');
      prestatario.absorbida = true;
      continue;
    }

    // Nadie dice que sea un préstamo. Se conserva la fila cuyo `NOMBRE EQUIPO`
    // usa el prefijo de su propia empresa —evidencia, no título de propiedad— y
    // se marca. La otra se absorbe para no duplicar la máquina.
    const conHostnamePropio = grupo.find((c) => {
      const n = norm(c.datos.nombre_equipo ?? '');
      return c.empresa === 'BBL Labs' ? n.startsWith('bbl') : n.startsWith('riwi');
    });
    const gana = conHostnamePropio ?? b;
    const pierde = gana === a ? b : a;

    gana.motivos = [...new Set([...gana.motivos, ...pierde.motivos, 'PROPIEDAD_AMBIGUA' as CodigoMotivo])];
    gana.datos.notas = [
      gana.datos.notas,
      `El serial está también en ${pierde.archivo} ${pierde.hoja} fila ${pierde.fila}` +
        (pierde.datos.etiqueta ? ` (etiqueta "${pierde.datos.etiqueta}")` : '') +
        `, sin marca de préstamo en ninguno de los dos.`,
      gana.datos.nombre_equipo ? `El hostname "${gana.datos.nombre_equipo}" sugiere ${gana.empresa}.` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    pierde.absorbida = true;
  }
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

function campoCsv(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escribirReporte(candidatas: Candidata[]) {
  const conMotivo = candidatas.filter((c) => c.motivos.length > 0);

  // Agrupado por motivo y no por fila: la bandeja se ataca por bloques. «Los 37
  // de licencia» es una tarde de trabajo; las mismas filas repartidas por orden
  // de aparición no se agrupan y no se terminan nunca. Una fila con 3 motivos
  // aparece 3 veces, una por bloque.
  const porMotivo = new Map<CodigoMotivo, Candidata[]>();
  for (const c of conMotivo) {
    for (const m of c.motivos) {
      if (!porMotivo.has(m)) porMotivo.set(m, []);
      porMotivo.get(m)!.push(c);
    }
  }
  const ordenados = [...porMotivo.entries()].sort((a, b) => b[1].length - a[1].length);

  const lineas: string[] = [];
  lineas.push(
    [
      'motivo',
      'filas_con_este_motivo',
      'descripcion',
      'recomendacion',
      'resultado',
      'empresa',
      'archivo',
      'hoja',
      'fila_excel',
      'etiqueta',
      'serial',
      'ubicacion_origen',
      'notas',
      'otros_motivos_de_la_misma_fila',
    ].join(','),
  );

  for (const [motivo, filas] of ordenados) {
    for (const c of filas
      .slice()
      .sort((x, y) => x.archivo.localeCompare(y.archivo) || x.fila - y.fila)) {
      lineas.push(
        [
          motivo,
          filas.length,
          MOTIVOS[motivo].descripcion,
          MOTIVOS[motivo].recomendacion,
          c.rechazada ? 'RECHAZADA' : c.absorbida ? 'ABSORBIDA_POR_OTRA_FILA' : 'IMPORTADA_CON_MARCA',
          c.empresa,
          c.archivo.split('/').pop() ?? c.archivo,
          c.hoja,
          c.fila,
          c.datos.etiqueta,
          c.datos.serial,
          c.ubicacionOriginal,
          c.datos.notas,
          c.motivos.filter((m) => m !== motivo).join(' '),
        ]
          .map(campoCsv)
          .join(','),
      );
    }
  }

  writeFileSync(RUTA_REPORTE, '﻿' + lineas.join('\r\n') + '\r\n', 'utf8');
  return { conMotivo: conMotivo.length, bloques: ordenados };
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

async function main() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(equipos);
  if (n > 0) {
    throw new Error(
      `La tabla equipos ya tiene ${n} filas. El importador no fusiona ni deduplica ` +
        `contra lo que ya está dentro: hay filas sin etiqueta y sin serial en los dos ` +
        `archivos, así que no existe una llave natural fiable para reconciliarlas.\n` +
        `Para reimportar en limpio:\n` +
        `  npm run db:reset && npm run migrate && npm run seed && npm run import`,
    );
  }

  // ------------------------------------------------------------------ lectura
  const candidatas: Candidata[] = [];
  const hashes = new Map<string, string>();

  for (const fuente of FUENTES) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fuente.ruta);
    hashes.set(
      fuente.ruta,
      createHash('sha256').update(readFileSync(fuente.ruta)).digest('hex'),
    );

    const filasEq = leerHoja(wb, fuente, fuente.hojaEquipos, COLUMNAS_EQUIPOS);
    const filasPe = leerHoja(wb, fuente, fuente.hojaPerifericos, COLUMNAS_PERIFERICOS);

    const dupSerialEq = repetidos(filasEq, 'SERIAL EQUIPO');
    const dupEtiquetaEq = repetidos(filasEq, 'ETIQUETA');
    const dupSerialPe = repetidos(filasPe, 'SERIAL EQUIPO');

    for (const f of filasEq) candidatas.push(candidataDeEquipo(f, dupSerialEq, dupEtiquetaEq));

    // El bloque repetido, antes de construir las candidatas: la que absorbe se
    // queda con la copia más completa de las dos.
    const absorbidas = detectarBloqueDuplicado(filasPe);
    const dePeriferico = filasPe.map((f) => candidataDePeriferico(f, dupSerialPe));
    for (const [copia, original] of absorbidas) {
      const c = dePeriferico[copia];
      const o = dePeriferico[original];
      c.absorbida = true;
      if (!o.motivos.includes('BLOQUE_DUPLICADO')) o.motivos.push('BLOQUE_DUPLICADO');
      o.datos.notas = [
        o.datos.notas,
        `La hoja repite esta fila en la ${c.fila}.`,
      ]
        .filter(Boolean)
        .join(' | ');

      // Se conserva lo que la copia sepa y el original no: «la copia más
      // completa» es por campo, no por fila, porque las dos tienen huecos
      // distintos.
      if (!o.persona && c.persona) {
        o.persona = c.persona;
        o.responsable = c.responsable;
        o.datos.estado = c.datos.estado;
      }
      if (!o.sedeNombre && c.sedeNombre) o.sedeNombre = c.sedeNombre;
      if (!o.cedula && c.cedula) o.cedula = c.cedula;

      // Y si las dos copias dicen cosas distintas, eso es un dato en sí.
      const discrepa =
        (o.persona && c.persona && norm(o.persona) !== norm(c.persona)) ||
        (o.sedeNombre && c.sedeNombre && norm(o.sedeNombre) !== norm(c.sedeNombre)) ||
        o.datos.estado !== c.datos.estado;
      if (discrepa && !o.motivos.includes('COPIAS_QUE_NO_CONCUERDAN')) {
        o.motivos.push('COPIAS_QUE_NO_CONCUERDAN');
        o.datos.notas = `${o.datos.notas} | La copia de la fila ${c.fila} dice: estado "${c.datos.estado}", responsable "${c.persona ?? '—'}", ubicación "${c.ubicacionOriginal || '—'}".`;
      }
    }
    // El duplicado se recuenta sobre las que QUEDAN. Marcado antes de
    // absorber, el bloque de RIWI dejaba a cada superviviente marcada como
    // «serial repetido» cuando su repetición era justo la copia que se acaba de
    // retirar: una marca que apunta a una fila que ya no existe y que nadie
    // podría cerrar nunca.
    const vivas = dePeriferico.filter((c) => !c.absorbida);
    const cuenta = new Map<string, number>();
    for (const c of vivas) {
      if (!c.datos.serial) continue;
      const k = norm(c.datos.serial);
      cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
    }
    for (const c of vivas) {
      if (!c.motivos.includes('SERIAL_REPETIDO_PERIFERICO')) continue;
      if (!c.datos.serial || (cuenta.get(norm(c.datos.serial)) ?? 0) < 2) {
        c.motivos = c.motivos.filter((m) => m !== 'SERIAL_REPETIDO_PERIFERICO');
      }
    }

    candidatas.push(...dePeriferico);
  }

  // --------------------------------------------------------------- el cruce
  cruzarArchivos(candidatas);

  // Un nombre en los dos archivos no se fusiona: puede ser una persona en dos
  // empresas o dos personas distintas. Se marca la fila que lo trae, por los
  // dos lados, para que el reporte lo enseñe una vez por empresa.
  const empresasPorNombre = new Map<string, Set<Empresa>>();
  for (const c of candidatas) {
    if (!c.persona) continue;
    const k = norm(c.persona);
    if (!empresasPorNombre.has(k)) empresasPorNombre.set(k, new Set());
    empresasPorNombre.get(k)!.add(c.empresa);
  }
  for (const c of candidatas) {
    if (!c.persona) continue;
    if ((empresasPorNombre.get(norm(c.persona))?.size ?? 0) > 1) {
      if (!c.motivos.includes('NOMBRE_EN_DOS_EMPRESAS')) c.motivos.push('NOMBRE_EN_DOS_EMPRESAS');
    }
  }

  const aImportar = candidatas.filter((c) => !c.rechazada && !c.absorbida);
  const equiposAImportar = aImportar.filter((c) => c.esEquipo);
  const perifericosAImportar = aImportar.filter((c) => !c.esEquipo);

  // ------------------------------------------------------------- transacción
  const resumen = { equipos: 0, empleados: 0, movimientos: 0, motivos: 0 };
  let empleadosSinEquipo: string[] = [];

  await db.transaction(async (tx) => {
    // El pool trae statement_timeout de 15 s, pensado para peticiones de la
    // API. Esta transacción inserta 305 equipos, ~180 empleados y 305
    // movimientos de una vez: se le quita el límite, y solo a ella.
    await tx.execute(sql`SET LOCAL statement_timeout = 0`);
    await tx.execute(sql`SET LOCAL lock_timeout = 0`);

    const sedesBd = await tx.select({ id: sedes.id, nombre: sedes.nombre }).from(sedes);
    const sedePorNombre = new Map(sedesBd.map((s) => [norm(s.nombre), s.id]));

    const [sistema] = await tx
      .select({ id: usuariosApp.id })
      .from(usuariosApp)
      .where(eq(usuariosApp.email, EMAIL_SISTEMA));
    if (!sistema) throw new Error(`Falta el usuario ${EMAIL_SISTEMA}. Correr npm run seed antes.`);

    // --- empleados: llave = nombre normalizado (D8 regla 1), sin fusión por
    //     similitud (regla 2). La empresa sale del archivo donde aparece.
    //
    //     Se recorren TODAS las candidatas, incluidas las rechazadas y las
    //     absorbidas: una persona nombrada en el archivo existe aunque su fila
    //     no llegue a la tabla de equipos. Es lo que hace que el recuento
    //     cuadre contra el Excel en vez de dejar a alguien solo en un campo de
    //     texto que nadie consulta.
    const porNombre = new Map<
      string,
      { nombre: string; cedula: string | null; sede_id: string | null; empresa: Empresa }
    >();
    for (const c of candidatas) {
      if (!c.persona) continue;
      const k = norm(c.persona);
      const sede = c.sedeNombre ? (sedePorNombre.get(norm(c.sedeNombre)) ?? null) : null;
      const previo = porNombre.get(k);
      if (!previo) {
        porNombre.set(k, {
          nombre: c.persona,
          cedula: c.cedula,
          sede_id: sede,
          empresa: c.empresa,
        });
      } else {
        if (!previo.cedula && c.cedula) previo.cedula = c.cedula;
        if (!previo.sede_id && sede) previo.sede_id = sede;
      }
    }

    // La cédula se guarda cuando existe pero NO decide el vínculo (D8 regla 4),
    // y esa misma regla dice qué hacer si dos nombres distintos la comparten:
    // al reporte, no al merge. Se quita de LAS DOS —quedarse con la primera
    // sería decidir de quién es por orden de aparición en un Excel— y las filas
    // de las dos personas quedan marcadas.
    //
    // **Casos reales en estos archivos: cero.** Igual que en la etapa 2: las
    // siete cédulas de BBL son de siete personas distintas. Esto existe porque
    // `empleados.cedula` es UNIQUE y sin la comprobación la carga entera
    // reventaría con un error del driver en vez de con un motivo — y porque el
    // día que dos archivos traigan la misma cédula, eso es un dato que alguien
    // tiene que mirar, no una excepción que abortar.
    //
    // Nota de cómo apareció: la primera versión del detector de bloques
    // duplicados absorbía filas de más en BBL y, al fusionar «la copia más
    // completa», arrastraba la cédula de una persona a la ficha de otra. La
    // carga reventó por UNIQUE. El choque era mío, no del Excel; arreglado el
    // detector, desapareció. Esta guarda se queda igual.
    const nombresPorCedula = new Map<string, string[]>();
    for (const [k, e] of porNombre) {
      if (!e.cedula) continue;
      if (!nombresPorCedula.has(e.cedula)) nombresPorCedula.set(e.cedula, []);
      nombresPorCedula.get(e.cedula)!.push(k);
    }
    const conCedulaCompartida = new Set<string>();
    for (const [cedula, nombres] of nombresPorCedula) {
      if (nombres.length < 2) continue;
      for (const k of nombres) {
        porNombre.get(k)!.cedula = null;
        conCedulaCompartida.add(k);
      }
      console.log(
        `Cédula ${cedula} compartida por ${nombres.length} nombres distintos: se guarda sin cédula en todos.`,
      );
    }
    for (const c of candidatas) {
      if (c.persona && conCedulaCompartida.has(norm(c.persona))) {
        if (!c.motivos.includes('CEDULA_COMPARTIDA')) c.motivos.push('CEDULA_COMPARTIDA');
      }
    }

    const empleadoPorNombre = new Map<string, string>();
    if (porNombre.size > 0) {
      const insertados = await tx
        .insert(empleados)
        .values([...porNombre.values()])
        .returning({ id: empleados.id, nombre: empleados.nombre });
      for (const e of insertados) empleadoPorNombre.set(norm(e.nombre), e.id);
    }
    resumen.empleados = empleadoPorNombre.size;

    const vinculados = new Set(
      aImportar.filter((c) => c.responsable).map((c) => norm(c.responsable!)),
    );
    empleadosSinEquipo = [...porNombre.values()]
      .filter((e) => !vinculados.has(norm(e.nombre)))
      .map((e) => e.nombre);

    // --- las sedes, ANTES de contar nada.
    //
    // `UBICACION_FUERA_DE_SEDES` solo se conoce aquí, al fallar la búsqueda, y
    // las cifras de `importaciones` tienen que reflejarlo: contarlas antes
    // dejaba `filas_marcadas` por debajo de lo que la BD acaba teniendo, y el
    // grupo G del verificador lo veía.
    for (const c of aImportar) {
      if (!c.sedeNombre) continue;
      const sede_id = sedePorNombre.get(norm(c.sedeNombre)) ?? null;
      if (!sede_id && !c.motivos.includes('UBICACION_FUERA_DE_SEDES')) {
        c.motivos.push('UBICACION_FUERA_DE_SEDES');
      }
    }

    // --- las dos corridas, una por archivo y cada una con su hash
    const corridaPorArchivo = new Map<string, string>();
    for (const fuente of FUENTES) {
      const suyas = candidatas.filter((c) => c.archivo === fuente.ruta);
      const suyasImportadas = suyas.filter((c) => !c.rechazada && !c.absorbida);
      const [corrida] = await tx
        .insert(importaciones)
        .values({
          archivo: fuente.ruta,
          hash_sha256: hashes.get(fuente.ruta)!,
          usuario_app_id: sistema.id,
          filas_leidas: suyas.length,
          filas_insertadas: suyasImportadas.length,
          filas_rechazadas: suyas.filter((c) => c.rechazada || c.absorbida).length,
          filas_marcadas: suyasImportadas.filter((c) => c.motivos.length > 0).length,
        })
        .returning({ id: importaciones.id });
      corridaPorArchivo.set(fuente.ruta, corrida.id);
    }

    // --- equipos. Los motivos ya están todos resueltos arriba.
    const valores = aImportar.map((c) => {
      const sede_id = c.sedeNombre ? (sedePorNombre.get(norm(c.sedeNombre)) ?? null) : null;
      const empleado_id = c.responsable
        ? (empleadoPorNombre.get(norm(c.responsable)) ?? null)
        : null;
      const empleado_mencionado_id =
        c.persona && !c.responsable ? (empleadoPorNombre.get(norm(c.persona)) ?? null) : null;
      return {
        ...c.datos,
        empresa: c.empresa,
        sede_id,
        empleado_id,
        empleado_mencionado_id,
        importacion_id: corridaPorArchivo.get(c.archivo)!,
        requiere_revision: c.motivos.length > 0,
      };
    });

    const insertados = await tx
      .insert(equipos)
      .values(valores)
      .returning({ id: equipos.id, sede_id: equipos.sede_id, empleado_id: equipos.empleado_id });
    resumen.equipos = insertados.length;

    // --- motivos, a la tabla puente. El CONSTRAINT TRIGGER que exige
    //     marca <=> motivos está deferido justo por el hueco entre estos dos
    //     INSERT.
    const filasMotivos = aImportar.flatMap((c, i) =>
      c.motivos.map((m) => ({ equipo_id: insertados[i].id, motivo_codigo: m as string })),
    );
    if (filasMotivos.length > 0) await tx.insert(equiposMotivosRevision).values(filasMotivos);
    resumen.motivos = filasMotivos.length;

    // --- movimientos: un Alta por equipo, atribuido al usuario de sistema (D4)
    await tx.insert(movimientos).values(
      insertados.map((e, i) => ({
        equipo_id: e.id,
        tipo: 'Alta' as const,
        sede_destino_id: e.sede_id,
        empleado_destino_id: e.empleado_id,
        usuario_app_id: sistema.id,
        observaciones: `Importación inicial desde ${aImportar[i].archivo}`,
      })),
    );
    resumen.movimientos = insertados.length;

    // --- reconciliación, todavía dentro de la transacción
    //
    // La BD no observa cuántas filas tenían los Excel, así que no puede
    // comprobarlo por su cuenta: el importador es el único que ve las dos
    // cifras a la vez. Si algo no cuadra, el throw deshace la transacción
    // entera y no queda medio inventario dentro.
    const [contado] = await tx
      .select({
        equipos: sql<number>`(SELECT count(*)::int FROM equipos)`,
        marcados: sql<number>`(SELECT count(*)::int FROM equipos WHERE equipos.requiere_revision)`,
        movimientos: sql<number>`(SELECT count(*)::int FROM movimientos)`,
        prestados: sql<number>`(SELECT count(*)::int FROM equipos WHERE equipos.estado = 'Prestado')`,
      })
      .from(importaciones)
      .limit(1);

    const descuadres: string[] = [];
    if (equiposAImportar.length !== ESPERADO_EQUIPOS) {
      descuadres.push(
        `equipos previstos ${equiposAImportar.length} != ${ESPERADO_EQUIPOS} esperados ` +
          `(126 + 98 - 6 en los dos archivos - 1 rechazada)`,
      );
    }
    if (perifericosAImportar.length !== ESPERADO_PERIFERICOS) {
      descuadres.push(
        `periféricos previstos ${perifericosAImportar.length} != ${ESPERADO_PERIFERICOS} esperados ` +
          `(61 + 37 - 10 del bloque repetido)`,
      );
    }
    if (contado.equipos !== aImportar.length) {
      descuadres.push(`filas en BD ${contado.equipos} != previstas ${aImportar.length}`);
    }
    if (contado.marcados !== valores.filter((v) => v.requiere_revision).length) {
      descuadres.push(
        `marcados en BD ${contado.marcados} != previstos ${valores.filter((v) => v.requiere_revision).length}`,
      );
    }
    if (contado.movimientos !== aImportar.length) {
      descuadres.push(`movimientos ${contado.movimientos} != un Alta por fila (${aImportar.length})`);
    }
    if (descuadres.length > 0) {
      throw new Error(`La carga no reconcilia:\n  - ${descuadres.join('\n  - ')}`);
    }

    console.log(`Equipos prestados cargados: ${contado.prestados}`);
  });

  // ---------------------------------------------------------------- reporte
  const { conMotivo, bloques } = escribirReporte(candidatas);
  const rechazadas = candidatas.filter((c) => c.rechazada);
  const absorbidas = candidatas.filter((c) => c.absorbida);

  console.log(`\nArchivos:`);
  for (const f of FUENTES) {
    const suyas = candidatas.filter((c) => c.archivo === f.ruta);
    console.log(
      `  ${f.ruta}  (${f.empresa})  filas ${suyas.length}  sha256 ${hashes.get(f.ruta)!.slice(0, 12)}…`,
    );
  }
  console.log(`\nFilas leídas:        ${candidatas.length}`);
  console.log(`Importadas:          ${resumen.equipos}`);
  console.log(`  equipos:           ${equiposAImportar.length}  (esperados ${ESPERADO_EQUIPOS})`);
  console.log(
    `  periféricos:       ${perifericosAImportar.length}  (esperados ${ESPERADO_PERIFERICOS})`,
  );
  console.log(`  limpias:           ${resumen.equipos - (conMotivo - rechazadas.length - absorbidas.length)}`);
  console.log(`  con marca:         ${conMotivo - rechazadas.length - absorbidas.length}`);
  console.log(`Rechazadas:          ${rechazadas.length}`);
  for (const r of rechazadas) {
    console.log(`  ${r.hoja} fila ${r.fila}: ${r.motivos.join(', ')}`);
  }
  console.log(`Absorbidas:          ${absorbidas.length}`);
  for (const a of absorbidas) console.log(`  ${a.hoja} fila ${a.fila} (${a.empresa})`);
  console.log(`\nEmpleados creados:   ${resumen.empleados}`);
  console.log(`  sin equipo:        ${empleadosSinEquipo.length}`);
  console.log(`Movimientos 'Alta':  ${resumen.movimientos}`);
  console.log(`Motivos registrados: ${resumen.motivos}`);
  console.log(`Reconciliación:      OK, y contra los números esperados de decisiones-05`);
  console.log(`\nMotivos (${bloques.reduce((a, [, f]) => a + f.length, 0)} en total):`);
  for (const [m, filas] of bloques) console.log(`  ${String(filas.length).padStart(3)}  ${m}`);
  console.log(`\nReporte: ${RUTA_REPORTE}`);
}

main()
  .catch((error) => {
    console.error('\nLa importación falló. La BD queda como estaba: nada se escribió a medias.');

    // La causa PRIMERO, y el `Failed query` de drizzle solo si no hay otra.
    //
    // Drizzle envuelve el error del driver: su `message` es la consulta entera
    // con TODOS sus parámetros —aquí, 300 filas incluidos los campos cifrados—
    // y el motivo de verdad («duplicate key value violates…») viaja en `cause`.
    // Imprimir solo el mensaje entierra la única línea que dice qué pasó bajo
    // 33 KB de ruido, y de paso escupe bytes cifrados a la consola, que es
    // justo lo que la regla 4 prohíbe.
    const causa = (error as { cause?: unknown }).cause;
    if (causa instanceof Error) {
      console.error(`\nCausa: ${causa.message}`);
      const d = causa as unknown as { detail?: string; constraint?: string; table?: string };
      if (d.detail) console.error(`  ${d.detail}`);
      if (d.constraint) console.error(`  restricción: ${d.constraint} sobre ${d.table ?? '?'}`);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => pool.end());
