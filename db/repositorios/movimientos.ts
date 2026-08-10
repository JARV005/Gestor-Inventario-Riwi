/**
 * Las mutaciones de estado de un equipo. Etapa 5.
 *
 * ============================================================================
 * REGLA 5 DEL PROYECTO: `equipos` Y `movimientos` EN LA MISMA TRANSACCIÓN.
 * ============================================================================
 *
 * Todo lo de aquí pasa dentro de un `bd.transaction`. No es una preferencia de
 * estilo: un equipo movido sin su movimiento pierde el historial que justifica
 * el proyecto, y un movimiento sin su equipo movido cuenta una historia que no
 * ocurrió. Las dos mitades son el mismo hecho.
 *
 * La auditoría (§5) entra en la misma transacción, no después. Si se dejara
 * para un paso posterior habría que volver a tocar las seis operaciones, y
 * mientras tanto existiría una ventana en la que la mutación cuajó y su rastro
 * no.
 *
 * `SELECT ... FOR UPDATE` sobre la fila antes de decidir: sin él, dos
 * peticiones simultáneas leen el mismo estado de partida, las dos consideran
 * legal su transición y las dos escriben. El CHECK de la base atrapa algunas
 * combinaciones —dos asignaciones a la vez— pero no todas: dos `baja` sobre el
 * mismo equipo pasarían las dos y dejarían dos movimientos `Baja`.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db, type BD } from '../cliente.js';
import { empleados, equipos, movimientos, sedes, usuariosApp } from '../esquema.js';
import {
  comprobarTransicion,
  type EstadoEquipo,
  type Operacion,
} from '../transiciones.js';
import * as repoAuditoria from './auditoria.js';

/** Lo que la operación necesita saber además del equipo. */
export interface DatosMutacion {
  /** Obligatorio en `asignar`. */
  empleado_id?: string | null;
  /** Obligatorio en `trasladar`: a qué sede va. */
  sede_destino_id?: string | null;
  observaciones?: string | null;
  /** Solo `trasladar`. Campos de D1, opcionales. */
  transportadora?: string | null;
  guia?: string | null;
  fecha_estimada?: string | null;
}

export class EquipoNoEncontrado extends Error {}
export class FaltaDato extends Error {}

/** El id no corresponde a ningún movimiento. */
export class MovimientoNoEncontrado extends Error {}
/** Existe, pero no es un traslado: confirmar solo tiene sentido sobre uno. */
export class NoEsTraslado extends Error {}
/** Ya se confirmó. El trigger de `0001_reglas.sql` no deja reabrirlo. */
export class TrasladoYaConfirmado extends Error {}

/** El estado del equipo antes de tocarlo. Lo que va a `auditoria.antes`. */
interface Antes {
  estado: EstadoEquipo;
  empleado_id: string | null;
  sede_id: string | null;
}

/**
 * Ejecuta una de las seis operaciones.
 *
 * Una sola función y no seis: lo único que cambia entre ellas es la fila de
 * `TRANSICIONES` y qué campos del movimiento se rellenan. Seis copias de este
 * cuerpo serían seis sitios donde olvidarse de la auditoría o del `FOR UPDATE`.
 */
export async function mutar(
  operacion: Operacion,
  equipoId: string,
  datos: DatosMutacion,
  contexto: { usuarioId: string; ip: string | null },
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    // FOR UPDATE: nadie más toca esta fila hasta que la transacción termine.
    const [actual] = await tx
      .select({
        id: equipos.id,
        estado: equipos.estado,
        empleado_id: equipos.empleado_id,
        sede_id: equipos.sede_id,
      })
      .from(equipos)
      .where(eq(equipos.id, equipoId))
      .for('update');

    if (!actual) throw new EquipoNoEncontrado(equipoId);

    // Lanza TransicionIlegal, que la capa HTTP traduce a 409.
    const t = comprobarTransicion(operacion, actual.estado);

    if (t.requiere === 'empleado' && !datos.empleado_id) {
      throw new FaltaDato('Hay que decir a quién se le asigna el equipo.');
    }
    if (t.requiere === 'sede' && !datos.sede_destino_id) {
      throw new FaltaDato('Hay que decir a qué sede se traslada el equipo.');
    }

    const antes: Antes = {
      estado: actual.estado,
      empleado_id: actual.empleado_id,
      sede_id: actual.sede_id,
    };

    // -----------------------------------------------------------------------
    // 1. La fila de `equipos`, si la operación la cambia
    // -----------------------------------------------------------------------
    //
    // `trasladar` es la única que no la toca (D13): mover un equipo de sede no
    // cambia de quién es, y `sede_id` no se mueve hasta que el traslado se
    // confirma. Hasta entonces el equipo sigue perteneciendo a su sede origen.
    let despues: Antes = antes;

    if (t.hacia !== null) {
      // `empleado_id` va acoplado al estado por el CHECK
      // `equipos_asignado_implica_empleado`, que es una EQUIVALENCIA: ponerlo
      // o quitarlo no es opcional según a qué estado se vaya.
      const nuevoEmpleado = t.hacia === 'Asignado' ? (datos.empleado_id ?? null) : null;

      const [fila] = await tx
        .update(equipos)
        .set({ estado: t.hacia, empleado_id: nuevoEmpleado })
        .where(eq(equipos.id, equipoId))
        .returning({
          estado: equipos.estado,
          empleado_id: equipos.empleado_id,
          sede_id: equipos.sede_id,
        });

      despues = fila;
    }

    // -----------------------------------------------------------------------
    // 2. El movimiento
    // -----------------------------------------------------------------------
    //
    // Origen y destino se rellenan según lo que la operación mueve de verdad.
    // Un `Traslado` no toca empleados; una `Asignación` no toca sedes.
    const [movimiento] = await tx
      .insert(movimientos)
      .values({
        equipo_id: equipoId,
        tipo: t.movimiento,
        empleado_origen_id: antes.empleado_id,
        empleado_destino_id: t.hacia === 'Asignado' ? (datos.empleado_id ?? null) : null,
        sede_origen_id: t.movimiento === 'Traslado' ? antes.sede_id : null,
        sede_destino_id: t.movimiento === 'Traslado' ? (datos.sede_destino_id ?? null) : null,
        usuario_app_id: contexto.usuarioId,
        observaciones: datos.observaciones ?? null,
        transportadora: t.movimiento === 'Traslado' ? (datos.transportadora ?? null) : null,
        guia: t.movimiento === 'Traslado' ? (datos.guia ?? null) : null,
        fecha_estimada: t.movimiento === 'Traslado' ? (datos.fecha_estimada ?? null) : null,
      })
      .returning({ id: movimientos.id, tipo: movimientos.tipo, fecha: movimientos.fecha });

    // -----------------------------------------------------------------------
    // 3. La auditoría, aquí y no después
    // -----------------------------------------------------------------------
    //
    // Solo los tres campos que la operación puede cambiar. Volcar la fila
    // entera de `equipos` metería `bios_password_cifrado` y
    // `licencia_serial_cifrado` en la tabla que existe para vigilar que no se
    // filtren.
    await repoAuditoria.registrar(
      {
        tabla: 'equipos',
        registro_id: equipoId,
        accion: operacion,
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes,
        despues: { ...despues, movimiento_id: movimiento.id },
      },
      tx,
    );

    return { movimiento, antes, despues };
  });
}

/**
 * El historial de un equipo, **con nombres**.
 *
 * Es la pantalla que justifica el proyecto: «¿quién tenía el BBL-0301 en
 * marzo?». Devolver UUIDs obligaría al navegador a resolverlos con seis
 * peticiones más, o —peor— a enseñarlos tal cual, y un historial que responde
 * `a3f9c1e2-…` no responde nada.
 *
 * Cinco LEFT JOIN y no subconsultas: aquí sí hay más de una tabla, así que
 * drizzle califica las columnas solo. Los joins son a favor de índice por PK y
 * el historial de un equipo son unas pocas filas.
 *
 * LEFT y no INNER: los cuatro extremos son NULL-ables por diseño. Un `Alta` no
 * tiene empleado de origen, una `Asignación` no tiene sedes, y un equipo sin
 * sede —hay 9— no tiene nombre que resolver. Con INNER, esas filas
 * desaparecerían del historial sin dejar rastro de que existieron.
 */
export async function historialConNombres(equipoId: string, bd: BD = db) {
  const empOrigen = alias(empleados, 'emp_origen');
  const empDestino = alias(empleados, 'emp_destino');
  const sedeOrigen = alias(sedes, 'sede_origen');
  const sedeDestino = alias(sedes, 'sede_destino');

  return bd
    .select({
      id: movimientos.id,
      tipo: movimientos.tipo,
      fecha: movimientos.fecha,
      observaciones: movimientos.observaciones,

      empleado_origen_id: movimientos.empleado_origen_id,
      empleado_origen: empOrigen.nombre,
      empleado_destino_id: movimientos.empleado_destino_id,
      empleado_destino: empDestino.nombre,

      sede_origen_id: movimientos.sede_origen_id,
      sede_origen: sedeOrigen.nombre,
      sede_destino_id: movimientos.sede_destino_id,
      sede_destino: sedeDestino.nombre,

      usuario_app_id: movimientos.usuario_app_id,
      usuario: usuariosApp.nombre,
      usuario_email: usuariosApp.email,

      fecha_confirmacion: movimientos.fecha_confirmacion,
      transportadora: movimientos.transportadora,
      guia: movimientos.guia,
      fecha_estimada: movimientos.fecha_estimada,
    })
    .from(movimientos)
    .leftJoin(empOrigen, eq(empOrigen.id, movimientos.empleado_origen_id))
    .leftJoin(empDestino, eq(empDestino.id, movimientos.empleado_destino_id))
    .leftJoin(sedeOrigen, eq(sedeOrigen.id, movimientos.sede_origen_id))
    .leftJoin(sedeDestino, eq(sedeDestino.id, movimientos.sede_destino_id))
    .leftJoin(usuariosApp, eq(usuariosApp.id, movimientos.usuario_app_id))
    .where(eq(movimientos.equipo_id, equipoId))
    // Más nuevo primero. `created_at` desempata: dos movimientos de la misma
    // transacción comparten `fecha` al milisegundo, y sin desempate el orden
    // entre ellos lo decide el planificador.
    .orderBy(desc(movimientos.fecha), desc(movimientos.created_at));
}

/**
 * Confirma un traslado: cierra el movimiento y mueve el equipo, **a la vez**.
 *
 * ============================================================================
 * LAS DOS ESCRITURAS SON EL MISMO HECHO. Si solo cuaja una, el equipo está en
 * dos sedes a la vez según a qué tabla se le pregunte:
 *
 *   - `equipos.sede_id` movido y el traslado abierto → la tarjeta de la sede
 *     destino ya lo cuenta, y `SedesView` lo sigue enseñando en tránsito.
 *   - el traslado cerrado y el equipo sin mover → el traslado desaparece de la
 *     lista habiendo dejado el equipo donde estaba, y ya no se puede reabrir:
 *     el trigger append-only lo impide, así que la contradicción es permanente.
 * ============================================================================
 *
 * **Orden de bloqueo: primero `equipos`, después `movimientos`.** Es el mismo
 * que usa `mutar`, y tiene que serlo: si una confirmación bloqueara primero el
 * movimiento y una mutación primero el equipo, dos peticiones simultáneas sobre
 * el mismo equipo se esperarían en cruz. La primera lectura del movimiento va
 * SIN bloqueo y solo sirve para saber qué equipo bloquear; la que decide es la
 * segunda, ya con el equipo en la mano.
 */
export async function confirmarTraslado(
  movimientoId: string,
  contexto: { usuarioId: string; ip: string | null },
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    // 1. Solo para saber a qué equipo pertenece. `equipo_id` y `tipo` no pueden
    //    cambiar bajo los pies: la tabla es append-only salvo la confirmación.
    const [cabecera] = await tx
      .select({ equipo_id: movimientos.equipo_id, tipo: movimientos.tipo })
      .from(movimientos)
      .where(eq(movimientos.id, movimientoId));

    if (!cabecera) throw new MovimientoNoEncontrado(movimientoId);
    if (cabecera.tipo !== 'Traslado') throw new NoEsTraslado(cabecera.tipo);

    // 2. El equipo, bloqueado. Nadie lo asigna ni lo da de baja mientras dura.
    const [equipo] = await tx
      .select({ id: equipos.id, sede_id: equipos.sede_id, estado: equipos.estado })
      .from(equipos)
      .where(eq(equipos.id, cabecera.equipo_id))
      .for('update');

    if (!equipo) throw new EquipoNoEncontrado(cabecera.equipo_id);

    // 3. Y ahora sí el movimiento, bloqueado. Entre 1 y 2 pudo confirmarse.
    const [mov] = await tx
      .select({
        id: movimientos.id,
        sede_origen_id: movimientos.sede_origen_id,
        sede_destino_id: movimientos.sede_destino_id,
        fecha_confirmacion: movimientos.fecha_confirmacion,
      })
      .from(movimientos)
      .where(eq(movimientos.id, movimientoId))
      .for('update');

    if (mov.fecha_confirmacion) throw new TrasladoYaConfirmado(movimientoId);
    if (!mov.sede_destino_id) {
      // No debería poder existir: `mutar` exige la sede destino y la FK la
      // valida. Si aparece, mover el equipo a NULL sería inventarse el
      // resultado del traslado.
      throw new FaltaDato('El traslado no dice a qué sede iba: no se puede confirmar.');
    }

    const antes = { sede_id: equipo.sede_id, fecha_confirmacion: null };

    // 4. El equipo se mueve. Solo `sede_id`: quién lo tiene y en qué estado
    //    está no cambian por llegar a destino (D13).
    await tx
      .update(equipos)
      .set({ sede_id: mov.sede_destino_id })
      .where(eq(equipos.id, equipo.id));

    // 5. El movimiento se cierra. `isNull` en el WHERE además del bloqueo: si
    //    por lo que sea otra transacción se coló, aquí no hay fila y sale el
    //    409 en vez de un cierre silencioso sobre algo ya cerrado.
    const [cerrado] = await tx
      .update(movimientos)
      .set({ fecha_confirmacion: sql`now()` })
      .where(and(eq(movimientos.id, movimientoId), isNull(movimientos.fecha_confirmacion)))
      .returning({
        id: movimientos.id,
        tipo: movimientos.tipo,
        fecha: movimientos.fecha,
        fecha_confirmacion: movimientos.fecha_confirmacion,
        sede_origen_id: movimientos.sede_origen_id,
        sede_destino_id: movimientos.sede_destino_id,
      });

    if (!cerrado) throw new TrasladoYaConfirmado(movimientoId);

    // 6. La auditoría, dentro. El `registro_id` es el equipo y no el
    //    movimiento: la pregunta que se le hace a esta tabla es «qué le pasó a
    //    este equipo», y el id del movimiento va en `despues`.
    await repoAuditoria.registrar(
      {
        tabla: 'equipos',
        registro_id: equipo.id,
        accion: 'confirmar_traslado',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes,
        despues: {
          sede_id: mov.sede_destino_id,
          fecha_confirmacion: cerrado.fecha_confirmacion,
          movimiento_id: cerrado.id,
        },
      },
      tx,
    );

    return { movimiento: cerrado, equipo_id: equipo.id };
  });
}

/**
 * Todos los traslados en curso, con nombres. Es la lista que `SedesView`
 * perdió al sustituir a `LogisticsHubsView` en la etapa 4a.
 *
 * `dias_en_transito` se calcula en Postgres y no en el navegador: el reloj del
 * cliente puede estar en otra zona o desajustado, y «lleva 9 días» es
 * precisamente el número por el que alguien va a llamar a la transportadora.
 */
export async function listarTrasladosAbiertos(bd: BD = db) {
  const sedeOrigen = alias(sedes, 'sede_origen');
  const sedeDestino = alias(sedes, 'sede_destino');

  return bd
    .select({
      id: movimientos.id,
      fecha: movimientos.fecha,
      equipo_id: movimientos.equipo_id,
      etiqueta: equipos.etiqueta,
      marca: equipos.marca,
      modelo: equipos.modelo,
      categoria: equipos.categoria,
      estado: equipos.estado,
      responsable: empleados.nombre,
      sede_origen_id: movimientos.sede_origen_id,
      sede_origen: sedeOrigen.nombre,
      sede_destino_id: movimientos.sede_destino_id,
      sede_destino: sedeDestino.nombre,
      transportadora: movimientos.transportadora,
      guia: movimientos.guia,
      fecha_estimada: movimientos.fecha_estimada,
      observaciones: movimientos.observaciones,
      usuario: usuariosApp.nombre,
      // Tablas calificadas a mano dentro del fragmento crudo, aunque aquí haya
      // JOIN y drizzle fuera a calificar solo: la regla es no depender de eso.
      dias_en_transito: sql<number>`(now()::date - movimientos.fecha::date)::int`,
    })
    .from(movimientos)
    .innerJoin(equipos, eq(equipos.id, movimientos.equipo_id))
    .leftJoin(empleados, eq(empleados.id, equipos.empleado_id))
    .leftJoin(sedeOrigen, eq(sedeOrigen.id, movimientos.sede_origen_id))
    .leftJoin(sedeDestino, eq(sedeDestino.id, movimientos.sede_destino_id))
    .leftJoin(usuariosApp, eq(usuariosApp.id, movimientos.usuario_app_id))
    .where(and(eq(movimientos.tipo, 'Traslado'), isNull(movimientos.fecha_confirmacion)))
    // El más antiguo primero: el que lleva nueve días parado es el que hay que
    // mirar, y en una lista ordenada por lo más nuevo queda el último.
    .orderBy(asc(movimientos.fecha));
}

/** El traslado sin confirmar de un equipo, si lo hay. Como mucho hay uno. */
export async function trasladoAbierto(equipoId: string, bd: BD = db) {
  const [fila] = await bd
    .select({
      id: movimientos.id,
      fecha: movimientos.fecha,
      sede_origen_id: movimientos.sede_origen_id,
      sede_destino_id: movimientos.sede_destino_id,
      transportadora: movimientos.transportadora,
      guia: movimientos.guia,
      fecha_estimada: movimientos.fecha_estimada,
    })
    .from(movimientos)
    .where(
      and(
        eq(movimientos.equipo_id, equipoId),
        eq(movimientos.tipo, 'Traslado'),
        isNull(movimientos.fecha_confirmacion),
      ),
    );
  return fila ?? null;
}
