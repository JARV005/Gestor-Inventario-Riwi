/**
 * Traduce las violaciones de integridad de Postgres a respuestas que dicen
 * **qué corregir**, no qué falló.
 *
 * ---
 *
 * Vive en la capa de API y no en cada formulario a propósito. Teclear un serial
 * repetido es uso normal, y crear un equipo `Asignado` sin responsable es la
 * constraint que el proyecto lleva cuatro etapas protegiendo. Cuando por fin
 * mordían delante de una persona, las dos respondían `500 Error interno`: la
 * constraint funcionaba y el traductor no existía.
 *
 * Si se arreglara en el modal de alta, reaparecería en cada formulario de la
 * etapa 5. Aquí lo ve una sola vez todo el que escriba en la base.
 *
 * **409 y no 400**: la entrada era válida —zod ya la aceptó— y lo que falla es
 * el estado de la base. El mismo cuerpo enviado dos minutos antes habría
 * funcionado.
 */

import { ErrorHttp } from './errores.js';

/** Códigos de la clase 23 de Postgres. */
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const CHECK = '23514';

/** `statement_timeout` agotado: Postgres cancela la consulta. */
const CANCELADA = '57014';
/** `lock_timeout` agotado: la tabla estaba bloqueada por otra sesión. */
const BLOQUEO_NO_DISPONIBLE = '55P03';

interface ErrorPg {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

/**
 * Nunca se repite el valor de estas columnas en un mensaje de error, pase lo
 * que pase. Hoy ninguna tiene índice único, así que no deberían aparecer; la
 * lista está para que siga siendo verdad si mañana alguien añade uno.
 */
const COLUMNAS_MUDAS = new Set(['bios_password_cifrado', 'licencia_serial_cifrado']);

const NOMBRE_TABLA: Record<string, string> = {
  equipos: 'equipo',
  empleados: 'empleado',
  sedes: 'sede',
  usuarios_app: 'usuario',
  actas: 'acta',
  movimientos: 'movimiento',
  mantenimientos: 'mantenimiento',
  importaciones: 'importación',
};

const NOMBRE_COLUMNA: Record<string, string> = {
  serial: 'el serial',
  etiqueta: 'la etiqueta',
  email: 'el correo',
  cedula: 'la cédula',
  nombre: 'el nombre',
  consecutivo: 'el consecutivo',
  codigo: 'el código',
  sede_id: 'la sede',
  empleado_id: 'el responsable',
  empleado_mencionado_id: 'la persona mencionada',
  equipo_id: 'el equipo',
  usuario_app_id: 'el usuario',
  motivo_codigo: 'el motivo',
  importacion_id: 'la importación',
};

/**
 * Qué regla se incumplió, en lengua humana, por nombre de constraint.
 *
 * Se enumeran a mano porque el texto tiene que explicar la regla, y el nombre
 * de la constraint no la explica: `equipos_asignado_implica_empleado` le dice
 * algo a quien escribió el esquema y nada a quien está rellenando un
 * formulario.
 */
const REGLAS: Record<string, string> = {
  equipos_asignado_implica_empleado:
    'Un equipo solo puede estar "Asignado" si tiene un responsable, y un equipo con responsable tiene que estar "Asignado".',
  equipos_revision_con_motivos:
    'Un equipo marcado para revisión necesita al menos un motivo, y uno sin motivos no puede quedar marcado.',
  importaciones_cuadran:
    'Las filas leídas de una importación tienen que ser las insertadas más las rechazadas.',
  importaciones_marcadas_caben:
    'Una importación no puede tener más filas marcadas que insertadas.',
  idx_movimientos_traslado_abierto:
    'Este equipo ya tiene un traslado en curso. Hay que confirmar el que está abierto antes de abrir otro; si el equipo no llegó a moverse, el traslado abierto es el que hay que revisar.',
  actas_pdf_con_hash:
    'Un acta guarda su PDF y el hash que lo verifica juntos, o ninguno de los dos.',
  actas_equipos_pk: 'Ese equipo ya está incluido en esta acta.',
  idx_actas_equipos_movimiento:
    'Ya hay un acta emitida sobre esa entrega. Un movimiento se firma una vez: dos actas sobre la misma operación son dos papeles con distinto número, y el día que discrepen no habría forma de saber cuál vale.',
  actas_equipos_movimiento_del_mismo_equipo:
    'El movimiento indicado no es de ese equipo. Un acta solo puede documentar la operación del equipo que incluye.',
  actas_consecutivo_positivo: 'El consecutivo de actas no puede ser cero ni negativo.',
};

/** `Key (serial)=(776B494) already exists.` → `{ columna, valor }` */
function partirDetalle(detalle?: string): { columna: string; valor: string } | null {
  if (!detalle) return null;
  const m = /^Key \(([^)]+)\)=\(([^)]*)\)/.exec(detalle);
  if (!m) return null;
  return { columna: m[1], valor: m[2] };
}

const articulo = (tabla?: string) => (tabla ? (NOMBRE_TABLA[tabla] ?? 'registro') : 'registro');

/**
 * Devuelve un `ErrorHttp` si el error es una violación de integridad conocida,
 * y `null` si no lo es — en cuyo caso quien llama lo trata como 500, que es lo
 * correcto: un error que no sabemos explicar no se disfraza de error de la
 * persona.
 */
/**
 * Busca el error de `pg` dentro de lo que llega.
 *
 * drizzle no propaga el error original: lo envuelve en uno propio ("Failed
 * query: …") y deja el de Postgres en `cause`. Sin desenvolverlo, `code` es
 * `undefined` y toda esta traducción no se ejecuta nunca — que es exactamente
 * lo que pasaba: los tests seguían viendo 500 con el traductor ya escrito.
 */
function errorDePostgres(err: unknown, profundidad = 0): ErrorPg | null {
  if (!err || typeof err !== 'object' || profundidad > 5) return null;
  const e = err as ErrorPg & { cause?: unknown };
  // Los SQLSTATE son cinco caracteres alfanuméricos en mayúsculas.
  if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
  return errorDePostgres(e.cause, profundidad + 1);
}

export function traducirErrorPostgres(err: unknown): ErrorHttp | null {
  const e = errorDePostgres(err);
  if (!e) return null;

  // La base está viva pero no puede atender: el statement_timeout o el
  // lock_timeout del pool han cortado la consulta. No es culpa de nadie y se
  // arregla solo, así que 503 y no 500 — «vuelve a intentarlo» es la respuesta
  // correcta, y con 500 la interfaz diría «avisar a TI» sin motivo.
  //
  // Visto de verdad bloqueando la tabla con LOCK TABLE ... ACCESS EXCLUSIVE:
  // sin timeouts la petición se colgaba indefinidamente.
  if (e.code === CANCELADA || e.code === BLOQUEO_NO_DISPONIBLE) {
    return new ErrorHttp(
      503,
      'La base de datos está ocupada y no pudo responder a tiempo. Reintentar en un momento.',
    );
  }

  if (e.code === UNIQUE) {
    // Los índices únicos PARCIALES no explican por qué chocan. El detalle de
    // Postgres dice `Key (equipo_id)=(…) already exists`, que sin el predicado
    // del índice suena a «ese equipo ya tiene un movimiento» — y tiene 186.
    // Lo que en realidad falló es que ya está viajando.
    const regla = e.constraint ? REGLAS[e.constraint] : undefined;
    if (regla) return new ErrorHttp(409, regla, { regla: e.constraint });

    const partes = partirDetalle(e.detail);
    if (!partes || COLUMNAS_MUDAS.has(partes.columna)) {
      return new ErrorHttp(409, `Ya existe otro ${articulo(e.table)} con ese valor.`);
    }
    const campo = NOMBRE_COLUMNA[partes.columna] ?? `el campo ${partes.columna}`;
    return new ErrorHttp(
      409,
      `Ya existe un ${articulo(e.table)} con ${campo} "${partes.valor}".`,
      { campo: partes.columna, valor: partes.valor },
    );
  }

  if (e.code === FOREIGN_KEY) {
    const partes = partirDetalle(e.detail);
    // Postgres usa el mismo código para "la referencia no existe" y para "no
    // puedes borrar esto porque algo lo referencia". El texto del detalle es
    // lo único que los distingue.
    const esBorradoBloqueado = (e.detail ?? '').includes('is still referenced');

    if (esBorradoBloqueado) {
      return new ErrorHttp(
        409,
        `No se puede borrar: hay otros registros que dependen de este ${articulo(e.table)}.`,
      );
    }
    if (!partes) {
      return new ErrorHttp(409, 'Una de las referencias indicadas no existe.');
    }
    const campo = NOMBRE_COLUMNA[partes.columna] ?? `el campo ${partes.columna}`;
    return new ErrorHttp(409, `No existe ${campo} que se indicó.`, {
      campo: partes.columna,
      valor: partes.valor,
    });
  }

  if (e.code === CHECK) {
    const regla = e.constraint ? REGLAS[e.constraint] : undefined;
    if (regla) return new ErrorHttp(409, regla, { regla: e.constraint });
    // Las constraints con trigger (la equivalencia marca/motivos deferida) no
    // traen `constraint`. Mensaje genérico antes que exponer texto interno.
    return new ErrorHttp(409, 'La operación incumple una regla de integridad de los datos.');
  }

  return null;
}
