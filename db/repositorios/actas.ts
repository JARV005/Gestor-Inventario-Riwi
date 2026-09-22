/**
 * Actas de entrega y devolución. Etapa 5a — el acta en la base, sin PDF.
 *
 * ============================================================================
 * UN ACTA ES UN DOCUMENTO SOBRE ALGO QUE YA OCURRIÓ.
 * ============================================================================
 *
 * No se emite un acta y luego se entrega el equipo: se entrega el equipo —lo
 * que deja su `Asignación` en `movimientos`— y después se firma el papel que lo
 * dice. De ahí las dos propiedades que gobiernan este fichero:
 *
 *  1. **Va atada a su movimiento** (D24). Cada fila de `actas_equipos` apunta al
 *     movimiento que documenta, con FK compuesta para que sea el movimiento de
 *     ESE equipo. Sin la atadura, dentro de un año hay actas que nadie sabe a
 *     qué entrega corresponden.
 *
 *  2. **Lo que dice queda congelado** (D23). Las columnas de instantánea son el
 *     contenido del documento, copiado al emitirlo. Corregir un serial el mes
 *     que viene no puede cambiar un acta ya emitida — y por eso aquí no se
 *     guarda solo la FK y se lee después.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { generarPdfActa, PLANTILLA_VERSION, sha256 } from '../acta-pdf.js';
import {
  CHEQUEO_ITEMS,
  PREFIJO_CONSECUTIVO,
  puedeEmitir,
  type EmpresaQueEmite,
  type ItemChequeo,
} from '../acta-formato.js';
import { db, type BD, type Ejecutor } from '../cliente.js';
import {
  TransicionIlegal,
  type EstadoEquipo,
  type Operacion,
} from '../transiciones.js';
import * as repoMovimientos from './movimientos.js';
import {
  actas,
  actasConsecutivo,
  actasEquipos,
  empleados,
  equipos,
  movimientos,
  sedes,
  usuariosApp,
} from '../esquema.js';
import * as repoAuditoria from './auditoria.js';

export type TipoActa = 'Entrega' | 'Devolución';

/**
 * Los dos modos de emitir. **`firmar` es el de por defecto, y a propósito**: un
 * modo que MUTA datos no puede ser el implícito. La pantalla lo manda siempre
 * explícito; una petición vieja que no lo traiga se comporta como antes.
 *
 *   - `firmar`   — el acta documenta movimientos que YA existen. Es lo de la
 *                  5a: primero la operación, después el papel.
 *   - `ejecutar` — el acta **crea** los movimientos y los firma, todo en la
 *                  misma transacción. El orden lógico se conserva —el
 *                  movimiento sigue existiendo antes que su acta, dentro de la
 *                  transacción— y desaparece el doble paso para quien entrega.
 *
 * Los dos caminos llegan al mismo sitio, y el manual —los botones del detalle
 * del equipo— sigue intacto. No es uno sustituyendo al otro.
 */
export type ModoActa = 'firmar' | 'ejecutar';

/** Qué movimiento documenta cada tipo de acta. */
const MOVIMIENTO_DE: Record<TipoActa, 'Asignación' | 'Devolución'> = {
  Entrega: 'Asignación',
  Devolución: 'Devolución',
};

/** Y qué operación lo crea, en modo `ejecutar`. */
const OPERACION_DE: Record<TipoActa, Operacion> = {
  Entrega: 'asignar',
  Devolución: 'devolver',
};

export class EmpleadoNoEncontrado extends Error {}

/**
 * La persona no tiene empresa asignada, así que su acta no tiene remitente
 * (D42).
 *
 * No es un dato que falte en el documento, como la cédula: es de **quién** es
 * el acta. Se corrige asignándole la empresa, que es un desplegable de dos
 * opciones, y por eso el mensaje lo dice — un 409 que solo diga que algo falló
 * deja a quien emite sin saber qué hacer a continuación.
 */
export class EmpresaSinAsignar extends Error {
  constructor(
    readonly empleadoId: string,
    readonly nombre: string,
  ) {
    super(
      `${nombre} no tiene empresa asignada, y el acta necesita saber de quién es: ` +
        `el logo del encabezado y el número de documento salen de ahí. ` +
        `Asígnale RIWI o BBL Labs en su ficha y vuelve a emitirla.`,
    );
  }
}
export class EquipoNoEncontrado extends Error {}
/** El equipo no tiene un movimiento de ese tipo con esa persona. */
export class SinMovimientoQueDocumentar extends Error {}
/** Ese movimiento ya lo cubre otra acta. */
export class YaTieneActa extends Error {}

/**
 * En modo `ejecutar`, un equipo del acta no se puede mover.
 *
 * Envuelve a `TransicionIlegal` **añadiéndole de qué equipo se trata**. La
 * excepción original sabe de operación y estado, pero no de equipo, y un 409
 * que dice «no se puede asignar» sobre un acta de cuatro equipos obliga a
 * adivinar cuál de los cuatro.
 */
export class EquipoNoSeDejaMover extends Error {
  constructor(
    readonly equipo_id: string,
    readonly etiqueta: string,
    readonly estado_actual: EstadoEquipo,
    readonly puedes: Operacion[],
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/**
 * En modo `ejecutar` + Devolución, el equipo no está a nombre de esa persona.
 *
 * Sin esta comprobación, `mutar('devolver')` escribiría el movimiento con
 * `empleado_origen_id` = quien lo tuviera de verdad, y el acta diría otra cosa:
 * el grupo H de `verificar-datos` («actas cuya persona no es la del
 * movimiento») se pondría rojo días después, lejos del acta que lo causó.
 */
export class NoEstaANombreDe extends Error {
  constructor(
    readonly equipo_id: string,
    readonly etiqueta: string,
    /** A nombre de quién figura hoy, o `null` si de nadie. */
    readonly titular: string | null,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export interface DatosActa {
  tipo: TipoActa;
  /** Ver `ModoActa`. Ausente = `firmar`. */
  modo?: ModoActa;
  empleado_id: string;
  /** Los equipos que el acta cubre. Al menos uno. */
  equipos: string[];
  observaciones?: string | null;
  /**
   * Las respuestas de la sección 5 (D41). Solo se guardan en las entregas.
   *
   * Lo que no venga queda `instalado: null` — «nadie contestó», que es una
   * respuesta legítima y distinta de «no».
   */
  chequeo?: ItemChequeo[] | null;
}

/**
 * Los cuatro items en su orden canónico, con lo que haya contestado quien
 * emite y `null` en lo que no.
 *
 * Se normaliza **siempre**, en vez de guardar tal cual lo que llegue, por dos
 * motivos que apuntan al mismo sitio: el PDF pinta las cuatro filas vengan o no
 * en la petición, y el hash se recalcula desde esta columna. Guardar una lista
 * corta, desordenada o con un item repetido haría que el documento y su
 * instantánea dejaran de decir lo mismo.
 *
 * En una devolución devuelve `null`: su formato no tiene sección 5, y la CHECK
 * `actas_pdf_con_hash` lo exige.
 */
function normalizarChequeo(tipo: TipoActa, entrada: ItemChequeo[] | null | undefined) {
  if (tipo !== 'Entrega') return null;
  return CHEQUEO_ITEMS.map((item) => {
    const dado = entrada?.find((c) => c.item === item);
    return {
      item,
      instalado: dado?.instalado ?? null,
      observaciones: dado?.observaciones?.trim() || null,
    } satisfies ItemChequeo;
  });
}

/**
 * El consecutivo de la empresa, dentro de la transacción del acta (D40).
 *
 * **Una serie por empresa, y sin año.** El formato aprobado es `BBL-0000` /
 * `RIWI-0000`: como el número no lleva el año, la clave del contador tiene que
 * ser exactamente lo que distingue una serie de otra. Si siguiera clavado en
 * el año, cada 1 de enero la serie volvería a empezar y el acta número uno del
 * segundo año chocaría contra el UNIQUE de `actas.consecutivo`.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` en una sola sentencia: crea el contador
 * con la primera acta de esa empresa y lo incrementa a partir de ahí. El
 * `UPDATE` toma el bloqueo de la fila hasta el COMMIT, así que dos peticiones
 * simultáneas **de la misma empresa** se serializan y la segunda recibe el
 * siguiente número, no el mismo. Dos de empresas distintas bloquean filas
 * distintas y no se esperan entre sí.
 *
 * Arranca en 0: la primera acta de cada empresa es la `0000`.
 *
 * Se pide **al final**, cuando ya está todo validado: el bloqueo serializa la
 * emisión y no hay motivo para sostenerlo mientras se comprueban movimientos.
 *
 * Y no es una SEQUENCE a propósito (D25): `nextval` no se deshace con la
 * transacción, así que un acta que falle después de pedir número deja un hueco
 * permanente en la numeración de un documento firmable.
 */
export async function siguienteConsecutivo(
  tx: Ejecutor,
  empresa: EmpresaQueEmite,
): Promise<string> {
  const [fila] = await tx
    .insert(actasConsecutivo)
    .values({ empresa, valor: 0 })
    .onConflictDoUpdate({
      target: actasConsecutivo.empresa,
      set: { valor: sql`${actasConsecutivo.valor} + 1` },
    })
    .returning({ valor: actasConsecutivo.valor });

  return `${PREFIJO_CONSECUTIVO[empresa]}-${String(fila.valor).padStart(4, '0')}`;
}

/** Los datos de la persona que el acta congela, y que sirven para los mensajes. */
interface Persona {
  id: string;
  nombre: string;
  cedula: string | null;
  cargo: string | null;
  area: string | null;
  sede: string | null;
}

/** Modo `firmar`: el movimiento ya existe y hay que encontrarlo. */
async function buscarMovimiento(
  tx: Ejecutor,
  tipoMov: 'Asignación' | 'Devolución',
  equipoId: string,
  nombreEq: string,
  persona: Persona,
): Promise<string> {
  // El más reciente de su tipo CON ESA PERSONA. El filtro por persona no es
  // adorno — un equipo que pasó de A a B tiene dos `Asignación`, y el acta de B
  // no puede colgar de la de A.
  const extremo = tipoMov === 'Asignación' ? 'empleado_destino_id' : 'empleado_origen_id';
  const [mov] = await tx
    .select({ id: movimientos.id })
    .from(movimientos)
    .where(
      and(
        eq(movimientos.equipo_id, equipoId),
        eq(movimientos.tipo, tipoMov),
        eq(movimientos[extremo], persona.id),
      ),
    )
    .orderBy(desc(movimientos.fecha), desc(movimientos.created_at))
    .limit(1);

  if (!mov) {
    throw new SinMovimientoQueDocumentar(
      `No hay ninguna ${tipoMov.toLowerCase()} de ${nombreEq} a nombre de ` +
        `${persona.nombre}. Un acta documenta algo que ya ocurrió: primero la ` +
        `operación, después el papel. Si la entrega es ahora, emitir el acta en ` +
        `modo «entregar ahora».`,
    );
  }
  return mov.id;
}

/**
 * Modo `ejecutar`: el acta CREA el movimiento y lo firma en la misma
 * transacción.
 *
 * La operación la hace `mutar()`, sin copiar nada: las mismas reglas, la misma
 * tabla de transiciones, la misma auditoría y el mismo `FOR UPDATE`. Reescribir
 * aquí un `UPDATE equipos` sería un séptimo sitio donde olvidarse de algo.
 *
 * `mutar` abre su propia transacción, que anidada dentro de esta es un
 * savepoint: si el tercer equipo de un acta de cuatro no se deja mover, la
 * excepción sube y **el acta entera se deshace**. No hay actas a medias.
 */
async function ejecutarOperacion(
  tx: Ejecutor,
  tipo: TipoActa,
  eq_: { id: string; estado: EstadoEquipo; empleado_id: string | null },
  nombreEq: string,
  persona: Persona,
  contexto: { usuarioId: string; ip: string | null },
  observaciones: string | null,
): Promise<string> {
  // Devolver exige que el equipo esté a nombre de ESA persona. Sin esto,
  // `mutar` escribiría el movimiento con el titular real y el acta diría otra
  // cosa: el grupo H se pondría rojo días después, lejos de su causa.
  if (tipo === 'Devolución' && eq_.empleado_id !== persona.id) {
    const titular = eq_.empleado_id
      ? ((
          await tx
            .select({ nombre: empleados.nombre })
            .from(empleados)
            .where(eq(empleados.id, eq_.empleado_id))
        )[0]?.nombre ?? null)
      : null;

    throw new NoEstaANombreDe(
      eq_.id,
      nombreEq,
      titular,
      titular
        ? `${nombreEq} no está a nombre de ${persona.nombre}: figura a nombre de ${titular}. ` +
          `Un acta de devolución la firma quien lo tenía.`
        : `${nombreEq} no está asignado a nadie, así que ${persona.nombre} no puede devolverlo.`,
    );
  }

  try {
    const r = await repoMovimientos.mutar(
      OPERACION_DE[tipo],
      eq_.id,
      { empleado_id: persona.id, observaciones },
      contexto,
      tx,
    );
    return r.movimiento.id;
  } catch (e) {
    if (e instanceof TransicionIlegal) {
      throw new EquipoNoSeDejaMover(
        eq_.id,
        nombreEq,
        e.estadoActual,
        e.alternativas,
        `${nombreEq} está "${e.estadoActual}" y no se puede ${OPERACION_DE[tipo]}. ` +
          `${e.explicacion} No se emitió el acta: no hay actas a medias.`,
      );
    }
    throw e;
  }
}

export async function emitir(
  datos: DatosActa,
  contexto: { usuarioId: string; ip: string | null },
  bd: BD = db,
) {
  const tipoMov = MOVIMIENTO_DE[datos.tipo];
  const modo: ModoActa = datos.modo ?? 'firmar';

  return bd.transaction(async (tx) => {
    // -----------------------------------------------------------------------
    // 1. La persona, con el nombre de su sede resuelto
    // -----------------------------------------------------------------------
    const [persona] = await tx
      .select({
        id: empleados.id,
        nombre: empleados.nombre,
        cedula: empleados.cedula,
        cargo: empleados.cargo,
        area: empleados.area,
        sede: sedes.nombre,
        // De quién es el acta, y por tanto qué logo lleva (D39). Sale de la
        // PERSONA y no de los equipos: el documento va dirigido a alguien de
        // una empresa, y sus equipos pueden ser de otra —eso lo dice la
        // columna «Propietario» de la sección 4, fila a fila.
        empresa: empleados.empresa,
      })
      .from(empleados)
      .leftJoin(sedes, eq(sedes.id, empleados.sede_id))
      .where(eq(empleados.id, datos.empleado_id));

    if (!persona) throw new EmpleadoNoEncontrado(datos.empleado_id);

    /**
     * Antes de mover nada, y antes de pedir número (D42).
     *
     * En modo `ejecutar` el acta hace la operación, así que una guarda puesta
     * más abajo habría dejado equipos movidos en una transacción que después
     * revienta. Aquí no hay nada que deshacer.
     *
     * Y la comprobación estrecha el tipo: `persona.empresa` pasa a ser
     * `EmpresaQueEmite` para el resto de la función, que es lo que permite
     * numerarla sin un `as`.
     */
    if (!puedeEmitir(persona.empresa)) {
      throw new EmpresaSinAsignar(persona.id, persona.nombre);
    }
    const empresaDelActa: EmpresaQueEmite = persona.empresa;

    const [autor] = await tx
      .select({ nombre: usuariosApp.nombre })
      .from(usuariosApp)
      .where(eq(usuariosApp.id, contexto.usuarioId));

    // -----------------------------------------------------------------------
    // 2. Un movimiento por equipo, y la instantánea de cada uno
    // -----------------------------------------------------------------------
    //
    // El equipo se bloquea antes de copiarlo: sin `FOR UPDATE`, una asignación
    // concurrente podría cambiar la fila entre la lectura y el COMMIT, y el
    // acta guardaría una instantánea de un estado que nunca coexistió con su
    // movimiento. Mismo orden de bloqueo que `mutar()` —equipos primero—, que
    // es lo que evita que las dos se esperen en cruz.
    const lineas: (typeof actasEquipos.$inferInsert)[] = [];

    for (const equipoId of datos.equipos) {
      const [eq_] = await tx
        .select({
          id: equipos.id,
          etiqueta: equipos.etiqueta,
          serial: equipos.serial,
          marca: equipos.marca,
          modelo: equipos.modelo,
          categoria: equipos.categoria,
          condicion: equipos.condicion,
          procesador: equipos.procesador,
          ram: equipos.ram,
          disco: equipos.disco,
          sistema_operativo: equipos.sistema_operativo,
          // Sección 4, columna «Propietario» (D36). De qué empresa es ESTE
          // equipo, que no tiene por qué ser la del acta: un acta de RIWI
          // puede entregar un portátil de BBL que RIWI tiene prestado.
          empresa: equipos.empresa,
          // No van a la instantánea —el acta no los imprime— pero hacen falta
          // aquí para validar.
          estado: equipos.estado,
          empleado_id: equipos.empleado_id,
        })
        .from(equipos)
        .where(eq(equipos.id, equipoId))
        .for('update');

      if (!eq_) throw new EquipoNoEncontrado(equipoId);
      const nombreEq = eq_.etiqueta ?? eq_.serial ?? eq_.categoria;

      const movimientoId =
        modo === 'ejecutar'
          ? await ejecutarOperacion(
              tx,
              datos.tipo,
              eq_,
              nombreEq,
              persona,
              contexto,
              datos.observaciones ?? null,
            )
          : await buscarMovimiento(tx, tipoMov, equipoId, nombreEq, persona);

      lineas.push({
        acta_id: '', // se rellena al insertar, cuando exista el id del acta
        empresa: eq_.empresa,
        equipo_id: equipoId,
        movimiento_id: movimientoId,
        etiqueta: eq_.etiqueta,
        serial: eq_.serial,
        marca: eq_.marca,
        modelo: eq_.modelo,
        categoria: eq_.categoria,
        condicion: eq_.condicion,
        procesador: eq_.procesador,
        ram: eq_.ram,
        disco: eq_.disco,
        sistema_operativo: eq_.sistema_operativo,
      });
    }

    // -----------------------------------------------------------------------
    // 3. El consecutivo y el acta
    // -----------------------------------------------------------------------
    const consecutivo = await siguienteConsecutivo(tx, empresaDelActa);
    const chequeo = normalizarChequeo(datos.tipo, datos.chequeo);

    // La fecha se fija aquí y se usa para las dos cosas: la fila y el
    // `CreationDate` del PDF. Si el PDF tomara `now()` por su cuenta, el
    // documento no sería reproducible — regenerarlo mañana daría otros bytes y
    // otro hash (D26).
    const fecha = new Date();
    const generadaPor = autor?.nombre ?? 'desconocido';

    const cabecera = {
      consecutivo,
      tipo: datos.tipo,
      fecha,
      empleado_nombre: persona.nombre,
      empleado_cedula: persona.cedula,
      empleado_cargo: persona.cargo,
      empleado_area: persona.area,
      sede_nombre: persona.sede,
      generada_por_nombre: generadaPor,
      empresa: persona.empresa,
      // Va en la cabecera y no suelto: así el PDF y la fila salen del MISMO
      // objeto y no pueden discrepar. Es la lección de la 0014 aplicada antes
      // de que muerda.
      chequeo,
    };

    // El PDF se genera DENTRO de la transacción, con la misma instantánea que
    // se está guardando. Generarlo después, en otra petición, abriría una
    // ventana en la que el acta existe sin su documento — y el CHECK
    // `actas_pdf_con_hash` obliga a que pdf, hash y plantilla vayan juntos.
    const pdf = await generarPdfActa({
      ...cabecera,
      equipos: lineas.map((l) => ({
        empresa: l.empresa ?? 'Sin clasificar',
        // Los dos campos de la sección 4 que el formato aprobado tiene y el
        // inventario no. Van vacíos hasta que alguien decida de dónde salen;
        // imprimir un guion sería afirmar que no hay accesorios.
        accesorios: null,
        comentarios: null,
        etiqueta: l.etiqueta ?? null,
        serial: l.serial ?? null,
        marca: l.marca ?? null,
        modelo: l.modelo ?? null,
        categoria: l.categoria,
        condicion: l.condicion ?? null,
        procesador: l.procesador ?? null,
        ram: l.ram ?? null,
        disco: l.disco ?? null,
        sistema_operativo: l.sistema_operativo ?? null,
      })),
    });

    const [acta] = await tx
      .insert(actas)
      .values({
        ...cabecera,
        empleado_id: persona.id,
        generada_por: contexto.usuarioId,
        pdf,
        hash_sha256: sha256(pdf),
        plantilla_version: PLANTILLA_VERSION[datos.tipo],
      })
      .returning({ id: actas.id, consecutivo: actas.consecutivo, hash_sha256: actas.hash_sha256 });

    // El UNIQUE sobre `movimiento_id` corta aquí un segundo acta sobre la misma
    // entrega. Se traduce a 409 en la capa HTTP.
    await tx.insert(actasEquipos).values(lineas.map((l) => ({ ...l, acta_id: acta.id })));

    await repoAuditoria.registrar(
      {
        tabla: 'actas',
        registro_id: acta.id,
        accion: 'emitir_acta',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        despues: {
          consecutivo,
          tipo: datos.tipo,
          // Qué camino se usó. Con los dos modos escribiendo el mismo tipo de
          // acta, sin esto no habría forma de saber, mirando el rastro, si el
          // movimiento lo creó el acta o lo firmó de antes.
          modo,
          empleado_id: persona.id,
          equipos: lineas.map((l) => l.equipo_id),
          movimientos: lineas.map((l) => l.movimiento_id),
        },
      },
      tx,
    );

    return { acta, lineas: lineas.length };
  });
}

/**
 * Un acta con lo que dice, **leído de la instantánea y no de las tablas
 * vivas**. Los `equipo_id` y `movimiento_id` van también, para poder saltar al
 * equipo actual desde el documento, pero lo que se imprime es la copia.
 */
export async function porId(id: string, bd: BD = db) {
  // Columnas enumeradas, nunca `select()` a secas. Aquí no hay campos
  // cifrados, pero sí `pdf`: un `SELECT *` lo traería entero a memoria y de
  // ahí a la respuesta JSON en cuanto alguien serialice el objeto. Lo que sale
  // es `tiene_pdf`, y el binario por su propio endpoint (5b).
  const [acta] = await bd
    .select({
      id: actas.id,
      consecutivo: actas.consecutivo,
      tipo: actas.tipo,
      fecha: actas.fecha,
      empleado_id: actas.empleado_id,
      empleado_nombre: actas.empleado_nombre,
      empleado_cedula: actas.empleado_cedula,
      empleado_cargo: actas.empleado_cargo,
      empleado_area: actas.empleado_area,
      sede_nombre: actas.sede_nombre,
      // Decide el logo, y el logo entra en el hash.
      empresa: actas.empresa,
      generada_por: actas.generada_por,
      generada_por_nombre: actas.generada_por_nombre,
      firmada: actas.firmada,
      fecha_firma: actas.fecha_firma,
      hash_sha256: actas.hash_sha256,
      plantilla_version: actas.plantilla_version,
      // Entra en el PDF (sección 5), así que entra en el hash: `recalcularHash`
      // la necesita para regenerar los mismos bytes.
      chequeo: actas.chequeo,
      // NUNCA la columna `pdf`. Un `SELECT *` aquí traería el binario a memoria
      // y de ahí a la respuesta JSON en cuanto alguien serialice el objeto. El
      // documento sale por su propio endpoint, en bytes y con su Content-Type.
      tiene_pdf: sql<boolean>`(actas.pdf IS NOT NULL)`,
      created_at: actas.created_at,
    })
    .from(actas)
    .where(eq(actas.id, id));

  if (!acta) return null;

  const equiposDelActa = await bd
    .select({
      equipo_id: actasEquipos.equipo_id,
      movimiento_id: actasEquipos.movimiento_id,
      etiqueta: actasEquipos.etiqueta,
      serial: actasEquipos.serial,
      marca: actasEquipos.marca,
      modelo: actasEquipos.modelo,
      categoria: actasEquipos.categoria,
      // Entra en el PDF (columna «Propietario»), así que entra en el hash: sin
      // ella, regenerar el acta daría otros bytes.
      empresa: actasEquipos.empresa,
      condicion: actasEquipos.condicion,
      procesador: actasEquipos.procesador,
      ram: actasEquipos.ram,
      disco: actasEquipos.disco,
      sistema_operativo: actasEquipos.sistema_operativo,
    })
    .from(actasEquipos)
    .where(eq(actasEquipos.acta_id, id));

  return { ...acta, equipos: equiposDelActa };
}

/**
 * El PDF de un acta, en bytes.
 *
 * **El único sitio de todo el repositorio donde se selecciona la columna
 * `pdf`.** Se pide por id y de una en una: cualquier consulta que la traiga en
 * lote —un listado, una exportación— se lleva megabytes a memoria por accidente
 * y probablemente a una respuesta JSON.
 */
export async function pdfDe(
  id: string,
  bd: BD = db,
): Promise<{ pdf: Buffer; hash: string; consecutivo: string; plantilla: string } | null> {
  const [fila] = await bd
    .select({
      pdf: actas.pdf,
      hash: actas.hash_sha256,
      consecutivo: actas.consecutivo,
      plantilla: actas.plantilla_version,
    })
    .from(actas)
    .where(eq(actas.id, id));

  if (!fila?.pdf || !fila.hash || !fila.plantilla) return null;
  return { pdf: fila.pdf, hash: fila.hash, consecutivo: fila.consecutivo, plantilla: fila.plantilla };
}

/**
 * Regenera el PDF de un acta desde su instantánea y devuelve el hash que da.
 *
 * Es lo que hace útil «reproducible» (D26): comparar esto con
 * `actas.hash_sha256` responde «¿el documento guardado es el que estos datos
 * producen?», que es una pregunta distinta de «¿los bytes guardados están
 * intactos?» — esa la responde el hash contra el propio binario.
 *
 * Solo tiene sentido si la plantilla guardada es la de hoy: con otra redacción
 * los bytes cambian y la comparación diría que no cuadra, cuando lo que pasa es
 * que el documento se emitió antes del cambio. Por eso se devuelve también
 * `misma_plantilla`.
 */
export async function recalcularHash(id: string, bd: BD = db) {
  const acta = await porId(id, bd);
  if (!acta) return null;

  const pdf = await generarPdfActa({
    consecutivo: acta.consecutivo,
    tipo: acta.tipo,
    fecha: new Date(acta.fecha),
    empresa: acta.empresa,
    empleado_nombre: acta.empleado_nombre,
    empleado_cedula: acta.empleado_cedula,
    empleado_cargo: acta.empleado_cargo,
    empleado_area: acta.empleado_area,
    sede_nombre: acta.sede_nombre,
    generada_por_nombre: acta.generada_por_nombre,
    // Todo lo que el PDF imprime sale de la INSTANTÁNEA, nunca de las tablas
    // vivas: si el equipo cambia de dueño mañana, el acta sigue diciendo lo
    // que decía el día que se firmó, y su hash sigue cuadrando.
    equipos: acta.equipos.map((e) => ({
      ...e,
      accesorios: null,
      comentarios: null,
    })),
    // Desde la columna, nunca `null`. Con `null` aquí la sección 5 saldría en
    // blanco, los bytes no coincidirían y esta función acusaría de manipulada
    // toda acta de entrega con el chequeo relleno (D41).
    chequeo: acta.chequeo,
  });

  return {
    hash_guardado: acta.hash_sha256,
    hash_recalculado: sha256(pdf),
    plantilla_guardada: acta.plantilla_version,
    misma_plantilla: acta.plantilla_version === PLANTILLA_VERSION[acta.tipo],
  };
}

/**
 * Qué equipos se pueden FIRMAR hoy para esta persona: los que tienen un
 * movimiento del tipo que toca, suyo, y todavía sin acta.
 *
 * Es la mitad del filtro de la pantalla que el cliente no puede calcular. Los
 * otros dos casos —modo `ejecutar`— salen de datos que ya tiene: los
 * disponibles para entregar, los que tiene a su nombre para devolver.
 *
 * **Solo el movimiento más reciente de cada equipo**, con `DISTINCT ON`. Es el
 * mismo que elegiría `buscarMovimiento` al emitir: ofrecer uno más antiguo
 * porque aquel no tiene acta llevaría a un 409 sin explicación posible —el acta
 * se emitiría contra el nuevo, que sí la tiene.
 */
export async function firmables(empleadoId: string, tipo: TipoActa, bd: BD = db) {
  const tipoMov = MOVIMIENTO_DE[tipo];
  const extremo = tipoMov === 'Asignación' ? 'empleado_destino_id' : 'empleado_origen_id';

  // SQL crudo con las tablas calificadas a mano: hay subconsulta correlacionada
  // y `DISTINCT ON`, que drizzle no expresa. La regla de siempre.
  const filas = await bd.execute<{
    id: string;
    etiqueta: string | null;
    serial: string | null;
    marca: string | null;
    modelo: string | null;
    categoria: string;
    estado: string;
    sede_id: string | null;
    movimiento_id: string;
    fecha: string;
  }>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (movimientos.equipo_id)
             equipos.id, equipos.etiqueta, equipos.serial, equipos.marca, equipos.modelo,
             equipos.categoria::text AS categoria, equipos.estado::text AS estado,
             equipos.sede_id,
             movimientos.id AS movimiento_id, movimientos.fecha
        FROM movimientos
        JOIN equipos ON equipos.id = movimientos.equipo_id
       WHERE movimientos.tipo = ${tipoMov}
         AND movimientos.${sql.raw(extremo)} = ${empleadoId}
       ORDER BY movimientos.equipo_id, movimientos.fecha DESC, movimientos.created_at DESC
    ) ultimo
    WHERE NOT EXISTS (
      SELECT 1 FROM actas_equipos WHERE actas_equipos.movimiento_id = ultimo.movimiento_id
    )
    ORDER BY ultimo.fecha DESC
  `);

  return filas.rows;
}

/** Las actas emitidas, de la más nueva a la más vieja. */
export async function listar(filtros: { empleado?: string } = {}, bd: BD = db) {
  const donde = filtros.empleado ? eq(actas.empleado_id, filtros.empleado) : undefined;

  return bd
    .select({
      id: actas.id,
      consecutivo: actas.consecutivo,
      tipo: actas.tipo,
      fecha: actas.fecha,
      empleado_id: actas.empleado_id,
      empleado_nombre: actas.empleado_nombre,
      sede_nombre: actas.sede_nombre,
      generada_por_nombre: actas.generada_por_nombre,
      firmada: actas.firmada,
      tiene_pdf: sql<boolean>`(actas.pdf IS NOT NULL)`,
      equipos: sql<number>`(
        SELECT count(*)::int FROM actas_equipos WHERE actas_equipos.acta_id = actas.id
      )`,
    })
    .from(actas)
    .where(donde)
    .orderBy(desc(actas.fecha));
}
