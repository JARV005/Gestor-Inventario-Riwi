/**
 * Acceso a `equipos`.
 *
 * ============================================================================
 * NUNCA `SELECT *` EN ESTE FICHERO. LAS COLUMNAS SE ENUMERAN SIEMPRE.
 * ============================================================================
 *
 * `equipos` tiene dos columnas que no pueden salir en ningún listado, ni
 * siquiera para un admin: `bios_password_cifrado` y `licencia_serial_cifrado`
 * (§5.2). Solo se leen de una en una, por `GET /api/equipos/:id/bios`, con rol
 * admin y dejando fila en `auditoria`.
 *
 * En Drizzle, `.select()` sin argumentos es literalmente `SELECT *`. Basta con
 * que alguien lo escriba una vez —o añada un endpoint copiando otro— para que
 * los dos campos aparezcan en todas las respuestas de ese endpoint. No haría
 * ruido: el listado seguiría funcionando y nadie mira los campos que no usa.
 *
 * Por eso las consultas de aquí parten de `CAMPOS_PUBLICOS`, que es una lista
 * cerrada, y por eso hay un test que lee este directorio y falla si encuentra
 * un `.select()` sin argumentos. El comentario avisa; el test es lo que impide.
 */

import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import { db, type BD, type Ejecutor } from '../cliente.js';
import { descifrar } from '../cifrado.js';
import * as repoAuditoria from './auditoria.js';
import {
  empresaEmpleado,
  equipos,
  equiposMotivosRevision,
  movimientos,
  prestatario,
} from '../esquema.js';

/**
 * Lo que puede salir de la API. Sin los dos campos cifrados: no están
 * comentados ni excluidos después, sencillamente no se piden.
 */
const CAMPOS_PUBLICOS = {
  id: equipos.id,
  categoria: equipos.categoria,
  etiqueta: equipos.etiqueta,
  nombre_equipo: equipos.nombre_equipo,
  marca: equipos.marca,
  modelo: equipos.modelo,
  serial: equipos.serial,
  serial_cargador: equipos.serial_cargador,
  propiedad: equipos.propiedad,
  sistema_operativo: equipos.sistema_operativo,
  licencia_tipo: equipos.licencia_tipo,
  tamano_pantalla: equipos.tamano_pantalla,
  procesador: equipos.procesador,
  disco: equipos.disco,
  ram: equipos.ram,
  estado: equipos.estado,
  condicion: equipos.condicion,
  sede_id: equipos.sede_id,
  empleado_id: equipos.empleado_id,
  empleado_mencionado_id: equipos.empleado_mencionado_id,
  importacion_id: equipos.importacion_id,
  sesion_usuario: equipos.sesion_usuario,
  fecha_compra: equipos.fecha_compra,
  garantia_vence: equipos.garantia_vence,
  costo: equipos.costo,
  notas: equipos.notas,
  // D44 y D48. `asignable` decide qué operaciones ofrece la pantalla, así que
  // tiene que viajar con el equipo; sin ella, `AccionesEquipo` no puede saber
  // qué lista de `por_estado` mirar.
  asignable: equipos.asignable,
  ubicacion_detalle: equipos.ubicacion_detalle,
  requiere_revision: equipos.requiere_revision,
  // 5e (D31). Que sea una lista cerrada tiene este precio: una columna nueva no
  // sale por la API hasta que se añade aquí, y el síntoma no dice «falta en la
  // proyección», dice `undefined`. Lo cazó el test de `prestar`, que compara la
  // respuesta con lo que pidió en vez de darla por buena.
  empresa: equipos.empresa,
  prestado_a: equipos.prestado_a,
  created_at: equipos.created_at,
  updated_at: equipos.updated_at,
} as const;

export interface FiltrosEquipos {
  estado?: string;
  sede?: string;
  categoria?: string;
  /**
   * De qué empresa. **Incluye lo que esa empresa tiene prestado**, no solo lo
   * que le pertenece: `empresa = X OR prestado_a = X`.
   *
   * Es lo que D31 compró al meter cada máquina en UNA fila. Con dos filas —una
   * por inventario— este filtro sería un `WHERE empresa = X` trivial, y el
   * precio sería que devolver un préstamo obligara a editar dos registros y que
   * el mismo serial existiera en dos estados a la vez.
   */
  empresa?: string;
  q?: string;
  revision?: boolean;
  /** Código de `motivos_revision`. Es para lo que existe la tabla puente. */
  motivo?: string;
  pagina?: number;
  porPagina?: number;
}

/**
 * Cuántos equipos ve cada empresa, con las tres claves SIEMPRE.
 *
 * Mismo criterio que `repoEmpleados.conteoPorEmpresa` (D28): `GROUP BY` no
 * devuelve grupos vacíos, y sin rellenarlos la interfaz no distinguiría
 * «ninguno» de «no se pudo contar».
 *
 * Y cuenta con el mismo `OR prestado_a` que el filtro, a propósito: si el
 * número del chip no cuadrara con lo que sale al pulsarlo, el chip sería una
 * cifra decorativa. Por eso los tres números suman más que el total — los nueve
 * prestados se cuentan en las dos empresas, que es justo lo que significan.
 */
export async function conteoPorEmpresa(bd: BD = db): Promise<Record<string, number>> {
  const r = await bd.execute<{ empresa: string; n: number }>(
    sql`SELECT x.empresa, count(*)::int AS n
          FROM (
            SELECT equipos.id, equipos.empresa::text AS empresa FROM equipos
            UNION ALL
            SELECT equipos.id, equipos.prestado_a::text FROM equipos
             WHERE equipos.prestado_a IS NOT NULL
          ) x
         GROUP BY x.empresa`,
  );
  // Las tres de `empresa` SIEMPRE, aunque valgan cero (D28). ISF no: no es una
  // de nuestras empresas, solo existe mientras tenga algo prestado, y un chip
  // «ISF 0» permanente sería una categoría inventada.
  const base: Record<string, number> = { RIWI: 0, 'BBL Labs': 0, 'Sin clasificar': 0 };
  for (const fila of r.rows) {
    const n = Number(fila.n);
    if (fila.empresa in base || n > 0) base[fila.empresa] = n;
  }
  return base;
}

/**
 * Quién hace la escritura y desde dónde. **Obligatorio en todo lo que escribe.**
 *
 * La misma forma que usa `repoMovimientos.mutar`, y a propósito: el §5 exige
 * que toda escritura sobre `equipos` deje fila en `auditoria`, y la manera de
 * que eso no dependa de acordarse es que ninguna función que escriba pueda
 * llamarse sin saber quién la llama.
 *
 * Se añadió tarde, y así se vio: `cerrarMotivo` y `fijarTenedor` llevaban una
 * etapa entera cambiando `requiere_revision` y `empleado_id` sin dejar rastro.
 * Salió a la luz al preguntarle a `auditoria` quién había desmarcado dos filas
 * del corpus y encontrarla **vacía** — que es el fallo funcionando: la tabla no
 * tenía nada que decir porque nadie escribía en ella.
 */
export interface ContextoEscritura {
  usuarioId: string;
  ip: string | null;
}

/** El equipo no tiene ese motivo puesto. */
export class MotivoNoPuesto extends Error {}
/** Fijar quién lo tiene solo aplica a un equipo prestado. */
export class NoEstaPrestado extends Error {
  constructor(readonly estado_actual: string) {
    super(estado_actual);
  }
}

/**
 * Cierra un motivo de revisión: alguien lo miró y lo resolvió.
 *
 * Y **baja la marca cuando era el último**, en la misma transacción. Las dos
 * cosas son el mismo hecho —lo dice el CONSTRAINT TRIGGER deferido de la
 * 0006— y separarlas dejaría un equipo con `requiere_revision = true` y cero
 * motivos, que es una fila atrapada en la bandeja sin nada escrito que
 * resolver.
 *
 * Bajar la marca reactiva los índices únicos parciales de `serial` y
 * `etiqueta`: si el duplicado que motivó la marca sigue ahí, Postgres rechaza
 * el UPDATE. Es deliberado y es de la etapa 2 — la limpieza no se puede cerrar
 * en falso.
 */
export async function cerrarMotivo(
  id: string,
  codigo: string,
  contexto: ContextoEscritura,
  bd: Ejecutor = db,
) {
  return bd.transaction(async (tx) => {
    const borradas = await tx
      .delete(equiposMotivosRevision)
      .where(
        and(
          eq(equiposMotivosRevision.equipo_id, id),
          eq(equiposMotivosRevision.motivo_codigo, codigo),
        ),
      )
      .returning({ codigo: equiposMotivosRevision.motivo_codigo });
    if (borradas.length === 0) throw new MotivoNoPuesto(codigo);

    const quedan = await tx
      .select({ codigo: equiposMotivosRevision.motivo_codigo })
      .from(equiposMotivosRevision)
      .where(eq(equiposMotivosRevision.equipo_id, id));

    if (quedan.length === 0) {
      await tx.update(equipos).set({ requiere_revision: false }).where(eq(equipos.id, id));
    }

    const [fila] = await tx.select(CAMPOS_PUBLICOS).from(equipos).where(eq(equipos.id, id));
    if (!fila) return null;

    // En la misma transacción que la escritura, como en `mutar`. Dejarlo para
    // después abriría una ventana en la que el motivo está cerrado y su rastro
    // no existe.
    await repoAuditoria.registrar(
      {
        tabla: 'equipos',
        registro_id: id,
        accion: 'cerrar_motivo',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes: { motivo: codigo, requiere_revision: true },
        despues: { motivos_restantes: quedan.map((m) => m.codigo), requiere_revision: fila.requiere_revision },
      },
      tx,
    );

    return { ...fila, motivos_revision: quedan.map((m) => m.codigo) };
  });
}

/** Lo que le pasó a una fila dentro de un cierre en bloque. */
export interface ResultadoEnBloque {
  equipo_id: string;
  etiqueta: string | null;
  serial: string | null;
  /** `null` si se cerró; el motivo del rechazo si no. */
  problema: string | null;
}

/**
 * Cierra un motivo en TODAS las filas que lo tengan, de una vez.
 *
 * ============================================================================
 * LA BANDEJA SE ATACA POR BLOQUES, ASÍ QUE TIENE QUE PODER ACTUAR POR BLOQUES.
 * ============================================================================
 *
 * `ResolverMotivos` ya cerraba motivos, pero de uno en uno y desde el panel de
 * un equipo: para los 37 de `LICENCIA_OK` eran 37 aperturas y 37 clics, y una
 * bandeja que cuesta 37 clics por bloque no se vacía — se abandona, que es
 * exactamente lo que hacía cuando solo se leía. El listado ya se filtra por
 * motivo; esto es la otra mitad.
 *
 * **Fila a fila, cada una en su SAVEPOINT.** Cerrar el último motivo de una fila
 * baja `requiere_revision`, y eso reactiva los índices únicos parciales de
 * `serial` y `etiqueta` sobre ella (etapa 2): si el duplicado que la marcó sigue
 * ahí, Postgres rechaza ESA. Con una sola transacción envolvente, la primera que
 * choca se llevaría las otras treinta y seis por delante y el informe diría
 * «falló» sin decir cuál. Con savepoints, cada rechazo se queda en su fila y el
 * resto entra.
 *
 * La `nota` no es decoración. Un `NULL` sin más y un `NULL` con constancia de
 * que alguien lo revisó se leen igual dentro de un año, y no son lo mismo: el
 * primero es «nadie miró esto» y el segundo es «se miró y el dato no se sabe».
 * Es el mismo problema que la tabla de auditoría vacía.
 */
export async function cerrarMotivoEnBloque(
  codigo: string,
  nota: string | null,
  contexto: ContextoEscritura,
  bd: BD = db,
): Promise<ResultadoEnBloque[]> {
  // Fuera de la transacción: solo lee, y sostener el bloqueo de 300 filas
  // mientras se decide qué hacer no aporta nada.
  const afectados = await bd
    .select({
      id: equipos.id,
      etiqueta: equipos.etiqueta,
      serial: equipos.serial,
    })
    .from(equipos)
    .innerJoin(equiposMotivosRevision, eq(equiposMotivosRevision.equipo_id, equipos.id))
    .where(eq(equiposMotivosRevision.motivo_codigo, codigo))
    .orderBy(equipos.etiqueta);

  const salida: ResultadoEnBloque[] = [];

  for (const eq_ of afectados) {
    const base = { equipo_id: eq_.id, etiqueta: eq_.etiqueta, serial: eq_.serial };
    try {
      await bd.transaction(async (tx) => {
        // La nota primero: si el cierre falla, tampoco queda la nota diciendo
        // que se revisó algo que sigue marcado.
        if (nota) {
          const [previo] = await tx
            .select({ notas: equipos.notas })
            .from(equipos)
            .where(eq(equipos.id, eq_.id));

          await tx
            .update(equipos)
            .set({
              // Se ACUMULA, no se sustituye: las notas del importador dicen de
              // dónde salió la fila, y perderlas para dejar constancia de una
              // revisión sería cambiar un dato por otro.
              //
              // `equipos.notas` va calificado A MANO y no interpolado: la
              // interpolación de columnas dentro de `sql` ya ha fallado tres
              // veces en este proyecto, y la última devolvía ceros plausibles
              // sin error. El SQL emitido se comprobó con `.toSQL()`.
              notas: sql`concat_ws(E'\n', nullif(equipos.notas, ''), ${nota}::text)`,
            })
            .where(eq(equipos.id, eq_.id));

          // Su propia fila, con acción propia: `cerrar_motivo` cuenta que el
          // motivo se fue, y esto cuenta que la nota entró. Son dos cambios
          // distintos sobre la misma fila y el rastro tiene que poder
          // distinguirlos — si no, dentro de un año la constancia aparece en
          // `notas` sin nada que diga quién la escribió.
          await repoAuditoria.registrar(
            {
              tabla: 'equipos',
              registro_id: eq_.id,
              accion: 'anotar_revision',
              usuario_app_id: contexto.usuarioId,
              ip: contexto.ip,
              antes: { notas: previo?.notas ?? null },
              despues: { nota_anadida: nota, motivo: codigo },
            },
            tx,
          );
        }
        await cerrarMotivo(eq_.id, codigo, contexto, tx);
      });
      salida.push({ ...base, problema: null });
    } catch (e) {
      // El rechazo de ESTA fila, con su texto. Es lo que permite atacar el
      // resto del bloque y volver sobre las que necesitan una decisión.
      salida.push({
        ...base,
        problema: e instanceof Error ? (e.message.split('\n')[0] ?? 'error') : 'error',
      });
    }
  }

  return salida;
}

/**
 * Fija quién tiene en la mano un equipo PRESTADO.
 *
 * Es la única grieta que D19 no cubría, y la abrió la 0012 al relajar la
 * equivalencia: `Prestado` es el único estado donde `empleado_id` es libre, y
 * ninguna de las diez operaciones lo escribe —`prestar` mueve el estado y deja
 * el tenedor a NULL—. Sin esto, el `RESPONSABLE_EN_CONFLICTO` de `F5X8494`
 * sería visible y no resoluble: los dos nombres en una nota y ninguna forma de
 * elegir.
 *
 * No es una edición de estado —el equipo sigue prestado a la misma empresa— así
 * que no abre la puerta que D19 cerró: fuera de `Prestado` lanza, y el 409 dice
 * qué operación toca.
 */
export async function fijarTenedor(
  id: string,
  empleadoId: string | null,
  contexto: ContextoEscritura,
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    const [actual] = await tx
      .select({ estado: equipos.estado, empleado_id: equipos.empleado_id })
      .from(equipos)
      .where(eq(equipos.id, id))
      .for('update');
    if (!actual) return null;
    if (actual.estado !== 'Prestado') throw new NoEstaPrestado(actual.estado);

    await tx.update(equipos).set({ empleado_id: empleadoId }).where(eq(equipos.id, id));
    const [fila] = await tx.select(CAMPOS_PUBLICOS).from(equipos).where(eq(equipos.id, id));
    if (!fila) return null;
    const motivos = await tx
      .select({ codigo: equiposMotivosRevision.motivo_codigo })
      .from(equiposMotivosRevision)
      .where(eq(equiposMotivosRevision.equipo_id, id));

    await repoAuditoria.registrar(
      {
        tabla: 'equipos',
        registro_id: id,
        accion: 'fijar_tenedor',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes: { empleado_id: actual.empleado_id },
        despues: { empleado_id: empleadoId },
      },
      tx,
    );

    return { ...fila, motivos_revision: motivos.map((m) => m.codigo) };
  });
}

export async function listar(f: FiltrosEquipos = {}, bd: BD = db) {
  const condiciones: SQL[] = [];
  if (f.estado) condiciones.push(eq(equipos.estado, f.estado as never));
  if (f.sede) condiciones.push(eq(equipos.sede_id, f.sede));
  if (f.categoria) condiciones.push(eq(equipos.categoria, f.categoria as never));
  if (f.empresa) {
    // Los dos enums NO tienen los mismos valores, y por eso cada comparación se
    // añade solo si su enum conoce el valor: `Sin clasificar` es una empresa
    // pero no un prestatario, e `ISF` es un prestatario pero no una empresa.
    // Comparar a ciegas revienta con «invalid input value for enum prestatario»
    // en cuanto alguien filtra por «Sin clasificar» — y el 500 llega desde
    // Postgres, no desde la validación, que es el peor sitio para enterarse.
    //
    // La pregunta se le hace al propio enum y no a una lista escrita aquí: dos
    // listas de valores son dos tablas del mismo hecho.
    const partes: SQL[] = [];
    if ((empresaEmpleado.enumValues as readonly string[]).includes(f.empresa)) {
      partes.push(eq(equipos.empresa, f.empresa as never));
    }
    if ((prestatario.enumValues as readonly string[]).includes(f.empresa)) {
      partes.push(eq(equipos.prestado_a, f.empresa as never));
    }
    // Helpers tipados y no un fragmento crudo: `or(eq(), eq())` se recalifica
    // solo, que es lo que la regla de CLAUDE.md sobre interpolar en `sql` pide.
    const suyos = partes.length > 1 ? or(...partes) : partes[0];
    if (suyos) condiciones.push(suyos);
  }
  if (f.revision !== undefined) condiciones.push(eq(equipos.requiere_revision, f.revision));
  if (f.motivo) {
    // EXISTS y no JOIN: un equipo con tres motivos aparecería tres veces, y el
    // total de la paginación contaría filas en vez de equipos.
    //
    // `equipos.id` escrito y calificado a mano: interpolado, drizzle lo emite
    // como `"id"` a secas. Aquí funcionaba de milagro —la tabla puente no
    // tiene columna `id`, así que resolvía hacia fuera— pero es suerte, no
    // diseño. La misma forma sobre `empleados` devolvía 0 para todos.
    condiciones.push(
      sql`EXISTS (SELECT 1 FROM equipos_motivos_revision m
                   WHERE m.equipo_id = equipos.id AND m.motivo_codigo = ${f.motivo})`,
    );
  }
  if (f.q) {
    const patron = `%${f.q}%`;
    const busqueda = or(
      ilike(equipos.etiqueta, patron),
      ilike(equipos.serial, patron),
      ilike(equipos.nombre_equipo, patron),
      ilike(equipos.marca, patron),
      ilike(equipos.modelo, patron),
    );
    if (busqueda) condiciones.push(busqueda);
  }
  const donde = condiciones.length ? and(...condiciones) : undefined;

  const porPagina = Math.min(Math.max(f.porPagina ?? 50, 1), 200);
  const pagina = Math.max(f.pagina ?? 1, 1);

  const filas = await bd
    .select(CAMPOS_PUBLICOS)
    .from(equipos)
    .where(donde)
    .orderBy(equipos.etiqueta, equipos.id)
    .limit(porPagina)
    .offset((pagina - 1) * porPagina);

  const [{ total }] = await bd
    .select({ total: sql<number>`count(*)::int` })
    .from(equipos)
    .where(donde);

  // Los motivos, en una segunda consulta y no con un JOIN, por lo mismo que
  // arriba: el JOIN multiplicaría las filas de los equipos con varios motivos.
  const ids = filas.map((f) => f.id);
  const porEquipo = new Map<string, string[]>();
  if (ids.length > 0) {
    const motivos = await bd
      .select({
        equipo_id: equiposMotivosRevision.equipo_id,
        codigo: equiposMotivosRevision.motivo_codigo,
      })
      .from(equiposMotivosRevision)
      .where(inArray(equiposMotivosRevision.equipo_id, ids));
    for (const m of motivos) {
      const lista = porEquipo.get(m.equipo_id) ?? [];
      lista.push(m.codigo);
      porEquipo.set(m.equipo_id, lista);
    }
  }

  return {
    filas: filas.map((f) => ({ ...f, motivos_revision: porEquipo.get(f.id) ?? [] })),
    total,
    pagina,
    porPagina,
  };
}

/**
 * Los agregados del dashboard y del contador del sidebar.
 *
 * Se agrupa **en Postgres**. La alternativa era pedir el listado entero y
 * contar en el navegador, que es lo que hacía `mockData`, y tiene dos
 * problemas: se rompe en cuanto la paginación recorta —el número saldría de
 * las 200 filas traídas, no de las que hay— y sobre todo deja de ser
 * comprobable. Un `GROUP BY` se contrasta con el mismo `GROUP BY` en psql; un
 * `Array.filter` sobre una página solo se puede contrastar contra sí mismo.
 *
 * Helpers tipados (`count`, `groupBy`) y no ``sql`` `` crudo: aquí no hay
 * subconsulta correlacionada que pueda resolver contra la tabla equivocada,
 * porque no hay cadena que abra un ámbito que drizzle no vea.
 *
 * Un estado sin ninguna fila **no sale** en `por_estado`: `GROUP BY` no
 * inventa grupos vacíos. Quien lo pinte debe tratar la ausencia como cero, no
 * suponer que están los seis.
 */
export async function resumen(bd: BD = db) {
  const [porEstado, porCategoria, totales, enTransito] = await Promise.all([
    bd
      .select({ estado: equipos.estado, equipos: count() })
      .from(equipos)
      .groupBy(equipos.estado)
      .orderBy(asc(equipos.estado)),
    bd
      .select({ categoria: equipos.categoria, equipos: count() })
      .from(equipos)
      .groupBy(equipos.categoria)
      .orderBy(asc(equipos.categoria)),
    bd.select({ total: count() }).from(equipos),
    // «En tránsito» ya no es un estado (D13): son los equipos con un traslado
    // abierto. Va aparte de `por_estado` a propósito — sumarlo ahí haría que
    // los grupos no cuadraran con el total, porque un equipo que viaja SIGUE
    // estando Asignado o Disponible. Son dos hechos distintos, no dos valores
    // del mismo campo.
    bd
      .select({ n: count() })
      .from(movimientos)
      .where(and(eq(movimientos.tipo, 'Traslado'), isNull(movimientos.fecha_confirmacion))),
  ]);

  return {
    por_estado: porEstado,
    por_categoria: porCategoria,
    total: totales[0]?.total ?? 0,
    traslados_abiertos: enTransito[0]?.n ?? 0,
  };
}

/** Cuántos equipos hay por cada código. Alimenta la bandeja de revisión. */
export async function conteoPorMotivo(bd: BD = db) {
  return bd
    .select({
      codigo: equiposMotivosRevision.motivo_codigo,
      equipos: sql<number>`count(*)::int`,
    })
    .from(equiposMotivosRevision)
    .groupBy(equiposMotivosRevision.motivo_codigo)
    .orderBy(sql`count(*) DESC`, equiposMotivosRevision.motivo_codigo);
}

export async function porId(id: string, bd: BD = db) {
  const [fila] = await bd.select(CAMPOS_PUBLICOS).from(equipos).where(eq(equipos.id, id));
  if (!fila) return null;
  const motivos = await bd
    .select({ codigo: equiposMotivosRevision.motivo_codigo })
    .from(equiposMotivosRevision)
    .where(eq(equiposMotivosRevision.equipo_id, id));
  return { ...fila, motivos_revision: motivos.map((m) => m.codigo) };
}

/**
 * Alta de un equipo: la fila **y su movimiento `Alta`**, en una transacción.
 *
 * Las dos escrituras juntas no son una preferencia de estilo, son un
 * invariante comprobado: `verificar-datos.sql` §F exige que todo equipo tenga
 * exactamente un `Alta` y que sea su movimiento más antiguo. La versión
 * anterior de esta función insertaba solo en `equipos`, así que el primer alta
 * hecha desde la interfaz habría dejado el verificador en rojo — no al
 * crearla, sino la próxima vez que alguien lo corriera, que es cuando ya no se
 * sabe quién la metió.
 *
 * Se descubrió al conectar `NewDeviceModal`: mientras nadie escribía equipos,
 * el hueco no tenía forma de notarse. Los 186 del Excel sí traen su `Alta`,
 * porque el importador lo escribía a mano.
 *
 * `usuarioId` es obligatorio y no tiene valor por defecto: `movimientos`
 * existe para saber quién hizo qué, y un alta sin autor es justo lo que la
 * columna `NOT NULL` está impidiendo.
 */
export async function crear(
  datos: typeof equipos.$inferInsert,
  contexto: ContextoEscritura,
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    const [fila] = await tx.insert(equipos).values(datos).returning(CAMPOS_PUBLICOS);

    await tx.insert(movimientos).values({
      equipo_id: fila.id,
      tipo: 'Alta',
      // Destino y no origen: antes del alta el equipo no estaba en ningún
      // sitio ni con nadie. Origen se queda NULL a propósito.
      sede_destino_id: fila.sede_id,
      empleado_destino_id: fila.empleado_id,
      usuario_app_id: contexto.usuarioId,
      observaciones: 'Alta manual desde la aplicación',
    });

    // El movimiento `Alta` ya deja rastro de que el equipo nació, pero no es
    // lo mismo: `movimientos` cuenta la vida del equipo y `auditoria` cuenta
    // quién tocó la base. El §5 pide la segunda.
    await repoAuditoria.registrar(
      {
        tabla: 'equipos',
        registro_id: fila.id,
        accion: 'crear',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes: null,
        despues: { etiqueta: fila.etiqueta, serial: fila.serial, estado: fila.estado },
      },
      tx,
    );

    return fila;
  });
}

export async function actualizar(
  id: string,
  datos: Partial<typeof equipos.$inferInsert>,
  contexto: ContextoEscritura,
  bd: BD = db,
) {
  return bd.transaction(async (tx) => {
    // El «antes» se lee dentro de la transacción y con la misma proyección que
    // el «después»: una auditoría que solo guarde el resultado no permite
    // reconstruir qué cambió, que es justo para lo que se consulta.
    const [previo] = await tx.select(CAMPOS_PUBLICOS).from(equipos).where(eq(equipos.id, id));
    if (!previo) return null;

    const [fila] = await tx
      .update(equipos)
      .set(datos)
      .where(eq(equipos.id, id))
      .returning(CAMPOS_PUBLICOS);
    if (!fila) return null;

    // Solo los campos que de verdad cambiaron. Volcar la fila entera haría que
    // cada edición de una nota guardara treinta columnas idénticas y que nadie
    // pudiera ver de un vistazo qué se tocó.
    const antes: Record<string, unknown> = {};
    const despues: Record<string, unknown> = {};
    for (const clave of Object.keys(datos) as (keyof typeof fila)[]) {
      if (previo[clave] !== fila[clave]) {
        antes[clave] = previo[clave];
        despues[clave] = fila[clave];
      }
    }

    await repoAuditoria.registrar(
      {
        tabla: 'equipos',
        registro_id: id,
        accion: 'actualizar',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes,
        despues,
      },
      tx,
    );

    return fila;
  });
}

/**
 * El único punto del sistema que lee los campos cifrados. Quien llama es
 * responsable de haber comprobado el rol y de dejar la fila en `auditoria`.
 */
export async function descifrarSecretos(id: string, bd: BD = db) {
  const [fila] = await bd
    .select({
      bios: equipos.bios_password_cifrado,
      licencia: equipos.licencia_serial_cifrado,
    })
    .from(equipos)
    .where(eq(equipos.id, id));
  if (!fila) return null;
  return {
    bios_password: descifrar(fila.bios as Buffer | null),
    licencia_serial: descifrar(fila.licencia as Buffer | null),
  };
}

export async function historial(id: string, bd: BD = db) {
  return bd
    .select({
      id: movimientos.id,
      tipo: movimientos.tipo,
      fecha: movimientos.fecha,
      empleado_origen_id: movimientos.empleado_origen_id,
      empleado_destino_id: movimientos.empleado_destino_id,
      sede_origen_id: movimientos.sede_origen_id,
      sede_destino_id: movimientos.sede_destino_id,
      usuario_app_id: movimientos.usuario_app_id,
      observaciones: movimientos.observaciones,
      fecha_confirmacion: movimientos.fecha_confirmacion,
    })
    .from(movimientos)
    .where(eq(movimientos.equipo_id, id))
    .orderBy(desc(movimientos.fecha));
}
