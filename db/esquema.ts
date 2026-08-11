/**
 * Esquema de la base de datos — fuente de verdad.
 *
 * Traduce `docs/plan-migracion-v1.md` §2, con los campos que `docs/decisiones-01.md`
 * D1 añade a `movimientos`. Los nombres van en snake_case y en español, igual que
 * en el plan; las propiedades de TypeScript también, para que no haya dos
 * vocabularios que mantener sincronizados.
 *
 * Lo que NO vive aquí, porque drizzle-kit no lo modela y se escribe a mano en
 * `db/migraciones/0001_reglas.sql`:
 *   - el trigger de `updated_at`
 *   - las restricciones de append-only sobre `movimientos`
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  inet,
  integer,
  json,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * drizzle-orm 0.45 no expone `bytea`. Los dos únicos campos cifrados del
 * esquema lo necesitan: guardar AES-256-GCM en `text` obligaría a codificar en
 * base64 y a que cada lectura recuerde decodificar.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** Columnas presentes en todas las tablas, por convención del §2. */
const columnasBase = {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// Tipos enumerados
// ---------------------------------------------------------------------------

export const rolUsuario = pgEnum('rol_usuario', ['admin', 'tecnico']);

export const estadoEmpleado = pgEnum('estado_empleado', [
  'Activo',
  'Onboarding',
  'Offboarding',
  'Inactivo',
]);

export const categoriaEquipo = pgEnum('categoria_equipo', [
  'Portátil',
  'Desktop',
  'Monitor',
  'Teclado',
  'Mouse',
  'Diadema',
  'Celular',
  'Otro',
]);

export const propiedadEquipo = pgEnum('propiedad_equipo', ['Empresa', 'Cliente', 'Empleado']);

export const licenciaTipo = pgEnum('licencia_tipo', [
  'RETAIL',
  'OEM',
  'Sin licencia',
  'No aplica',
]);

/**
 * De quién es el equipo y para qué está. **No dónde está.**
 *
 * `En tránsito` estuvo aquí hasta la 0008 y no podía quedarse (D13): el CHECK
 * `equipos_asignado_implica_empleado` es una equivalencia, así que un equipo
 * asignado y viajando a la vez no cabía. O conservaba a su responsable y no
 * podía estar en tránsito, o estaba en tránsito y el CHECK obligaba a
 * `empleado_id = NULL`. El caso principal del propio D1 —mandar el kit de
 * onboarding a alguien remoto— es justo ese.
 *
 * «Está viajando» se deriva ahora de que exista un `Traslado` sin
 * `fecha_confirmacion`, y el índice único de `movimientos` garantiza que no
 * haya dos. El invariante de D1 dejó de ser algo que vigilar: es la
 * definición.
 */
export const estadoEquipo = pgEnum('estado_equipo', [
  'Disponible',
  'Asignado',
  'En mantenimiento',
  'Reservado',
  'De baja',
]);

/**
 * `Usado` no estaba en el §2. Lo exige la hoja de periféricos, que trae 48
 * filas `USADO` y 13 `NUEVO`. Mapear `USADO` a `Bueno` seria inventar una
 * valoración del estado que nadie hizo; dejarlo en NULL tiraría un dato real.
 */
export const condicionEquipo = pgEnum('condicion_equipo', [
  'Nuevo',
  'Excelente',
  'Bueno',
  'Usado',
  'Requiere reparación',
]);

/**
 * `Reserva` y `Liberación` son de la 0008.
 *
 * `Reservado` existía en `estado_equipo` desde la 0000 y ningún movimiento
 * podía producirlo: se podía salir de ese estado pero no entrar. El importador
 * dejó un equipo así y nadie más podía crear otro, aunque «reservar un equipo
 * para quien entra el mes que viene» es una operación corriente.
 *
 * `Liberación` y no `Devolución`: devolver es lo que hace quien tenía el
 * equipo. Liberar una reserva no devuelve nada, porque nadie llegó a tenerlo.
 */
export const tipoMovimiento = pgEnum('tipo_movimiento', [
  'Alta',
  'Asignación',
  'Devolución',
  'Traslado',
  'Envío a mantenimiento',
  'Retorno de mantenimiento',
  'Baja',
  'Reserva',
  'Liberación',
]);

export const estadoMantenimiento = pgEnum('estado_mantenimiento', [
  'Pendiente',
  'En taller',
  'Completado',
  'Devuelto',
]);

export const tipoActa = pgEnum('tipo_acta', ['Entrega', 'Devolución']);

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

/**
 * Solo personal de TI. No hay registro público: las filas se siembran.
 * `password_hash` es NULL para el usuario de sistema de D4, que existe para
 * atribuir los movimientos de la importación y nunca inicia sesión.
 */
export const usuariosApp = pgTable('usuarios_app', {
  ...columnasBase,
  email: text('email').notNull().unique(),
  nombre: text('nombre').notNull(),
  password_hash: text('password_hash'),
  rol: rolUsuario('rol').notNull(),
  activo: boolean('activo').notNull().default(true),
  ultimo_acceso: timestamp('ultimo_acceso', { withTimezone: true }),
});

/**
 * `nombre` es UNIQUE, que el §2 no pedía: sin eso la semilla no puede ser
 * idempotente y correr `npm run seed` dos veces duplicaría las cinco sedes.
 */
export const sedes = pgTable('sedes', {
  ...columnasBase,
  nombre: text('nombre').notNull().unique(),
  ciudad: text('ciudad'),
  direccion: text('direccion'),
  responsable: text('responsable'),
  contacto_email: text('contacto_email'),
  contacto_telefono: text('contacto_telefono'),
  activa: boolean('activa').notNull().default(true),
});

/**
 * `sede_id` es NULL-able aunque el §2 no lo marcase. El Excel de origen tiene
 * filas sin sede legible y `empleados` no tiene `requiere_revision` donde
 * aparcarlas: con NOT NULL la etapa 2 tendría que inventar una sede para poder
 * importar, que es justo lo que prohíbe la regla 3 de CLAUDE.md.
 */
export const empleados = pgTable(
  'empleados',
  {
    ...columnasBase,
    nombre: text('nombre').notNull(),
    cedula: text('cedula').unique(),
    email_corporativo: text('email_corporativo'),
    cargo: text('cargo'),
    area: text('area'),
    sede_id: uuid('sede_id').references(() => sedes.id, { onDelete: 'restrict' }),
    estado: estadoEmpleado('estado').notNull().default('Activo'),
    fecha_ingreso: date('fecha_ingreso'),
    telefono: text('telefono'),
    direccion: text('direccion'),
    activo: boolean('activo').notNull().default(true),
  },
  (t) => [index('idx_empleados_sede').on(t.sede_id)],
);

/**
 * Store de sesiones de `connect-pg-simple`. §5.4: sesión en cookie con el
 * estado en Postgres, nada de JWT en localStorage.
 *
 * Se declara aquí, y no se deja que connect-pg-simple la cree al arrancar,
 * porque eso sería un cambio de esquema sin migración (regla 7). Declarada,
 * sale en la 0007 como cualquier otra tabla y `drizzle-kit generate` no la ve
 * como sobrante.
 *
 * Es la única tabla del esquema sin `id` UUID ni `created_at`/`updated_at`: su
 * forma es un contrato de la librería, no una decisión nuestra. Los nombres en
 * inglés y la tabla en singular vienen de ahí.
 */
export const session = pgTable(
  'session',
  {
    sid: varchar('sid').primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6, mode: 'date' }).notNull(),
  },
  (t) => [index('IDX_session_expire').on(t.expire)],
);

/**
 * Catálogo de códigos de `equipos_motivos_revision`.
 *
 * Es una tabla y no un CHECK con lista literal porque los códigos crecen: la
 * etapa 2 ya añadió uno que no estaba previsto. Con CHECK, cada código nuevo
 * costaría una migración; con tabla, una línea en `db/motivos.ts` y `npm run
 * seed`, que es de donde se siembra.
 *
 * `recomendacion` llegará en la etapa 6, cuando la bandeja tenga interfaz.
 * Hoy vive solo en `db/motivos.ts`, que es lo que alimenta el CSV.
 */
export const motivosRevision = pgTable('motivos_revision', {
  codigo: text('codigo').primaryKey(),
  descripcion: text('descripcion').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Una corrida del importador.
 *
 * Existe porque la reconciliación «187 leídas = 186 insertadas + 1 rechazada»
 * la observa el importador y se evapora cuando termina. Sin esta tabla, dentro
 * de tres meses nadie puede responder cuántas filas tenía el archivo sin
 * reabrir el Excel.
 *
 * `hash_sha256` es lo que delata que alguien reimportó una versión distinta
 * del archivo con el mismo nombre.
 */
export const importaciones = pgTable(
  'importaciones',
  {
    ...columnasBase,
    archivo: text('archivo').notNull(),
    hash_sha256: text('hash_sha256').notNull(),
    fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
    usuario_app_id: uuid('usuario_app_id')
      .notNull()
      .references(() => usuariosApp.id, { onDelete: 'restrict' }),
    filas_leidas: integer('filas_leidas').notNull(),
    filas_insertadas: integer('filas_insertadas').notNull(),
    filas_rechazadas: integer('filas_rechazadas').notNull(),
    filas_marcadas: integer('filas_marcadas').notNull(),
  },
  () => [
    // La aritmética de la reconciliación cabe en una sola fila, así que puede
    // ser un CHECK de verdad y no una comprobación que alguien tenga que
    // acordarse de correr.
    check(
      'importaciones_cuadran',
      sql`filas_leidas = filas_insertadas + filas_rechazadas`,
    ),
    check('importaciones_marcadas_caben', sql`filas_marcadas <= filas_insertadas`),
  ],
);

/**
 * Tabla única para portátiles y periféricos, discriminada por `categoria`.
 *
 * `serial` y `etiqueta` NO llevan UNIQUE simple. Un UNIQUE a secas hace
 * imposible la etapa 2: el Excel trae el serial GH14W64 repetido, y el §3 manda
 * meter esas filas marcadas con `requiere_revision` en vez de descartarlas o
 * deduplicarlas a ojo. Con UNIQUE la segunda no entra, ni marcada, y el
 * importador revienta en la primera fila conflictiva.
 *
 * La unicidad va como índice parcial que excluye lo pendiente de revisión: ver
 * `equipos_serial_uk` más abajo.
 */
export const equipos = pgTable(
  'equipos',
  {
    ...columnasBase,
    categoria: categoriaEquipo('categoria').notNull(),
    etiqueta: text('etiqueta'),
    nombre_equipo: text('nombre_equipo'),
    marca: text('marca'),
    modelo: text('modelo'),
    serial: text('serial'),
    serial_cargador: text('serial_cargador'),
    propiedad: propiedadEquipo('propiedad').notNull().default('Empresa'),
    sistema_operativo: text('sistema_operativo'),
    licencia_tipo: licenciaTipo('licencia_tipo'),
    licencia_serial_cifrado: bytea('licencia_serial_cifrado'),
    bios_password_cifrado: bytea('bios_password_cifrado'),
    // Texto libre a propósito: el origen trae "16 GB", "512GB SSD", "14\"".
    // Normalizarlos a número exigiría interpretar, y la etapa 1 no interpreta.
    tamano_pantalla: text('tamano_pantalla'),
    procesador: text('procesador'),
    disco: text('disco'),
    ram: text('ram'),
    estado: estadoEquipo('estado').notNull(),
    condicion: condicionEquipo('condicion'),
    sede_id: uuid('sede_id').references(() => sedes.id, { onDelete: 'restrict' }),
    empleado_id: uuid('empleado_id').references(() => empleados.id, { onDelete: 'restrict' }),
    /**
     * «Esta fila menciona a esta persona, pero el equipo no está asignado a
     * ella». Ocurre cuando el origen trae responsable con un estado distinto de
     * `Asignado`: el invariante prohíbe el vínculo real, pero el nombre es un
     * dato y ahora que los empleados existen hay una FK donde ponerlo.
     *
     * Sustituye a dejar el nombre suelto en `notas`, que obligaba a quien
     * resolviera la fila a releerlo y teclearlo sin equivocarse.
     */
    empleado_mencionado_id: uuid('empleado_mencionado_id').references(() => empleados.id, {
      onDelete: 'restrict',
    }),
    /** Corrida del importador de la que vino. NULL = creado a mano. */
    importacion_id: uuid('importacion_id').references(() => importaciones.id, {
      onDelete: 'restrict',
    }),
    sesion_usuario: text('sesion_usuario'),
    fecha_compra: date('fecha_compra'),
    garantia_vence: date('garantia_vence'),
    // Pesos colombianos (D3). El widget de costo queda fuera de la v1 porque el
    // Excel no trae ni un solo valor cargado; el campo sí se conserva.
    costo: numeric('costo', { precision: 14, scale: 2 }),
    notas: text('notas'),
    /**
     * Marca de la bandeja de limpieza. Los motivos están en
     * `equipos_motivos_revision`; la equivalencia entre esta bandera y la
     * existencia de motivos la impone un CONSTRAINT TRIGGER deferido.
     *
     * Ojo al tocarla: es la condición de los índices únicos parciales de
     * `serial` y `etiqueta`.
     */
    requiere_revision: boolean('requiere_revision').notNull().default(false),
  },
  (t) => [
    // Invariante del §2. Es una equivalencia, no una implicación: un equipo
    // 'Asignado' sin responsable y un responsable sobre un equipo 'Disponible'
    // son ambos el mismo error de estado. Ninguno de los dos lados puede ser
    // NULL, así que la igualdad siempre da true o false.
    //
    // Las columnas van sin interpolar: drizzle las emitiría calificadas
    // ("equipos"."estado") y Postgres no admite calificación dentro de un CHECK
    // ni en el predicado de un índice parcial. Mismo motivo abajo.
    check(
      'equipos_asignado_implica_empleado',
      sql`(estado = 'Asignado') = (empleado_id IS NOT NULL)`,
    ),
    index('idx_equipos_importacion').on(t.importacion_id),
    // Unicidad de serial y etiqueta, pero solo entre las filas ya limpias.
    //
    // El predicado hace dos trabajos:
    //   - `IS NOT NULL` deja convivir los vacíos. En Postgres los NULL ya no
    //     colisionan entre sí, así que es redundante para la corrección; está
    //     por tamaño del índice y porque dice la intención en voz alta.
    //   - `requiere_revision = false` es lo que hace importable el Excel. Las
    //     filas dudosas entran marcadas y quedan fuera del índice; el día que
    //     alguien resuelve el duplicado y baja la marca, la BD comprueba la
    //     unicidad en ese momento y rechaza si el conflicto seguía ahí.
    //
    // Es decir: la limpieza de la etapa 2 no se puede cerrar en falso.
    uniqueIndex('equipos_serial_uk')
      .on(t.serial)
      .where(sql`serial IS NOT NULL AND requiere_revision = false`),
    uniqueIndex('equipos_etiqueta_uk')
      .on(t.etiqueta)
      .where(sql`etiqueta IS NOT NULL AND requiere_revision = false`),
    index('idx_equipos_estado').on(t.estado),
    index('idx_equipos_sede').on(t.sede_id),
    index('idx_equipos_empleado').on(t.empleado_id),
    index('idx_equipos_categoria').on(t.categoria),
    // Parcial: la bandeja de limpieza del §4 solo consulta las que están en
    // true, y tras la etapa 2 esas son la minoría.
    index('idx_equipos_revision')
      .on(t.id)
      .where(sql`requiere_revision`),
  ],
);

/**
 * Motivos por los que un equipo está marcado. Tabla puente y no `text[]`.
 *
 * Un array no tiene integridad referencial: `ARRAY['SIN_SERAIL']` con la errata
 * entraba sin protestar y esa fila desaparecía de su bloque en la bandeja sin
 * que nadie se enterase. Mismo razonamiento que `actas.equipos_ids`, pero al
 * revés — allí el array es correcto porque un acta congela su contenido; aquí
 * los motivos se resuelven y necesitan un catálogo vivo.
 *
 * La PK compuesta hace imposible el motivo duplicado sin depender de que el
 * importador se acuerde de comprobarlo.
 *
 * La equivalencia con `equipos.requiere_revision` la impone un CONSTRAINT
 * TRIGGER deferido, en `0006_motivos_referenciales.sql`. No cabe en un CHECK
 * porque cruza dos tablas, y no puede quedarse en un test porque
 * `requiere_revision` es la condición de los índices únicos parciales de
 * `serial` y `etiqueta`: desincronizarla no pierde una entrada en la bandeja,
 * pierde en silencio la garantía de unicidad.
 */
export const equiposMotivosRevision = pgTable(
  'equipos_motivos_revision',
  {
    equipo_id: uuid('equipo_id')
      .notNull()
      .references(() => equipos.id, { onDelete: 'cascade' }),
    motivo_codigo: text('motivo_codigo')
      .notNull()
      .references(() => motivosRevision.codigo, { onDelete: 'restrict' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.equipo_id, t.motivo_codigo] }),
    // La bandeja se lee por bloques: "dame los 37 de LICENCIA_OK".
    index('idx_motivos_por_codigo').on(t.motivo_codigo),
  ],
);

/**
 * El historial que el Excel nunca tuvo. Append-only: ver las reglas en
 * `db/migraciones/0001_reglas.sql`.
 *
 * Los cuatro últimos campos son de D1: un traslado en curso es una fila de tipo
 * 'Traslado' con `fecha_confirmacion IS NULL`. Confirmarlo la rellena y mueve el
 * equipo a la sede destino en la misma transacción.
 */
export const movimientos = pgTable(
  'movimientos',
  {
    ...columnasBase,
    equipo_id: uuid('equipo_id')
      .notNull()
      .references(() => equipos.id, { onDelete: 'restrict' }),
    tipo: tipoMovimiento('tipo').notNull(),
    empleado_origen_id: uuid('empleado_origen_id').references(() => empleados.id, {
      onDelete: 'restrict',
    }),
    empleado_destino_id: uuid('empleado_destino_id').references(() => empleados.id, {
      onDelete: 'restrict',
    }),
    sede_origen_id: uuid('sede_origen_id').references(() => sedes.id, { onDelete: 'restrict' }),
    sede_destino_id: uuid('sede_destino_id').references(() => sedes.id, { onDelete: 'restrict' }),
    fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
    usuario_app_id: uuid('usuario_app_id')
      .notNull()
      .references(() => usuariosApp.id, { onDelete: 'restrict' }),
    // `acta_id` estuvo aquí desde la 0000 y nunca tuvo un valor. Se fue en la
    // 0009: el vínculo acta↔movimiento vive en `actas_equipos.movimiento_id`,
    // que es donde está el par (acta, equipo). Además esta columna era
    // imposible de escribir — el acta se emite después del movimiento, y el
    // trigger append-only solo deja cambiar `fecha_confirmacion`.
    observaciones: text('observaciones'),
    fecha_confirmacion: timestamp('fecha_confirmacion', { withTimezone: true }),
    transportadora: text('transportadora'),
    guia: text('guia'),
    fecha_estimada: date('fecha_estimada'),
  },
  (t) => [
    index('idx_movimientos_equipo').on(t.equipo_id, t.fecha.desc()),
    /**
     * No añade unicidad —`id` ya es la PK— pero es lo que permite que
     * `actas_equipos` referencie `(movimiento_id, equipo_id)` como par. Sin
     * ella, Postgres rechaza la FK compuesta.
     */
    unique('movimientos_id_equipo_uq').on(t.id, t.equipo_id),
    /**
     * UNIQUE, y no solo un índice de consulta (D13, 0008).
     *
     * Desde que «en tránsito» se deriva de que exista un traslado abierto,
     * dos traslados abiertos del mismo equipo no son un dato feo: son una
     * contradicción sobre dónde está. La derivación diría «viajando» sin poder
     * decir hacia dónde.
     *
     * Lo impide Postgres en el INSERT. Un verificador que lo comprobara
     * después encontraría el equipo ya en dos sitios.
     */
    uniqueIndex('idx_movimientos_traslado_abierto')
      .on(t.equipo_id)
      .where(sql`tipo = 'Traslado' AND fecha_confirmacion IS NULL`),
  ],
);

export const mantenimientos = pgTable(
  'mantenimientos',
  {
    ...columnasBase,
    equipo_id: uuid('equipo_id')
      .notNull()
      .references(() => equipos.id, { onDelete: 'restrict' }),
    tipo: text('tipo').notNull(),
    descripcion: text('descripcion'),
    estado: estadoMantenimiento('estado').notNull().default('Pendiente'),
    fecha_reporte: timestamp('fecha_reporte', { withTimezone: true }).notNull().defaultNow(),
    fecha_cierre: timestamp('fecha_cierre', { withTimezone: true }),
    responsable: text('responsable'),
    proveedor: text('proveedor'),
    costo: numeric('costo', { precision: 14, scale: 2 }),
  },
  (t) => [
    index('idx_mantenimientos_equipo').on(t.equipo_id),
    index('idx_mantenimientos_estado').on(t.estado),
  ],
);

/**
 * Los equipos del acta están en `actas_equipos`, no en un array (D14, 0008).
 *
 * El §2 los fijaba como `uuid[]` con un argumento bueno: un acta es un
 * documento firmado y congelado, y su lista no debe cambiar porque después se
 * corrija la fila del equipo. Pero un array no tiene clave foránea, así que
 * «toda acta apunta a equipos que existen» no se podía imponer ni comprobar.
 * La puente resuelve las dos cosas a la vez; ver el comentario de
 * `actasEquipos`.
 *
 * El PDF va en la fila y no en una ruta de disco (D15): el §5 exige probar la
 * restauración de un backup, y un fichero suelto es una segunda cosa que
 * restaurar en paso con lo que lo referencia.
 */
export const actas = pgTable(
  'actas',
  {
    ...columnasBase,
    consecutivo: text('consecutivo').notNull().unique(),
    tipo: tipoActa('tipo').notNull(),
    empleado_id: uuid('empleado_id')
      .notNull()
      .references(() => empleados.id, { onDelete: 'restrict' }),
    fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
    generada_por: uuid('generada_por')
      .notNull()
      .references(() => usuariosApp.id, { onDelete: 'restrict' }),

    /**
     * Instantánea de la persona: lo que el acta DICE, copiado al emitirla
     * (D23). No se lee de `empleados` al pintar el documento.
     *
     * La FK `empleado_id` responde «de quién es este acta»; esto responde «qué
     * se firmó». Son preguntas distintas y la segunda no puede cambiar: si en
     * marzo se corrige el cargo de alguien, el acta que firmó en enero sigue
     * diciendo el cargo de enero.
     */
    empleado_nombre: text('empleado_nombre').notNull(),
    empleado_cedula: text('empleado_cedula'),
    empleado_cargo: text('empleado_cargo'),
    empleado_area: text('empleado_area'),
    sede_nombre: text('sede_nombre'),
    /** Quién la emitió, con su nombre congelado por lo mismo. */
    generada_por_nombre: text('generada_por_nombre').notNull(),
    pdf: customType<{ data: Buffer; driverData: Buffer }>({
      dataType: () => 'bytea',
    })('pdf'),
    hash_sha256: text('hash_sha256'),
    firmada: boolean('firmada').notNull().default(false),
    fecha_firma: timestamp('fecha_firma', { withTimezone: true }),
  },
  (t) => [
    // O están el documento y su hash, o no está ninguno. Un PDF sin hash no se
    // puede verificar; un hash sin PDF no verifica nada.
    check('actas_pdf_con_hash', sql`(pdf IS NULL) = (hash_sha256 IS NULL)`),
    index('idx_actas_empleado').on(t.empleado_id),
  ],
);

/**
 * Qué equipos entrega o recibe un acta, **y qué decía el acta de cada uno**.
 *
 * Las cuatro columnas de instantánea no son denormalización por comodidad: son
 * el contenido del documento. La FK garantiza que el equipo existe; la
 * instantánea, que lo impreso no cambia si mañana alguien corrige el serial.
 * Con solo una de las dos cosas se pierde la otra — un array tenía la segunda
 * y ninguna FK; una puente pelada tendría FK y un documento que muta.
 *
 * `ON DELETE RESTRICT` en las dos: ni un acta ni un equipo referenciado por un
 * acta se borran. Un acta firmada es un documento legal.
 */
/**
 * Un equipo dentro de un acta, **con lo que ese equipo era al firmar**.
 *
 * Las columnas de instantánea no son una desnormalización por rendimiento: son
 * el contenido del documento. La FK dice que el equipo existe; la instantánea,
 * que lo impreso no cambia cuando la fila de `equipos` cambie (D14, D23).
 */
export const actasEquipos = pgTable(
  'actas_equipos',
  {
    acta_id: uuid('acta_id')
      .notNull()
      .references(() => actas.id, { onDelete: 'restrict' }),
    equipo_id: uuid('equipo_id')
      .notNull()
      .references(() => equipos.id, { onDelete: 'restrict' }),
    /**
     * El movimiento que este acta documenta (D24). Un acta se emite sobre algo
     * que ya ocurrió: la `Asignación` de una entrega, la `Devolución` de una
     * recogida.
     *
     * La FK es COMPUESTA con `equipo_id` —ver 0009—: ata el acta al movimiento
     * **de ese equipo**. Con dos FK sueltas se podría firmar el acta de un
     * portátil contra la asignación de otro, y nadie lo vería hasta leerla.
     */
    movimiento_id: uuid('movimiento_id').notNull(),

    etiqueta: text('etiqueta'),
    serial: text('serial'),
    marca: text('marca'),
    modelo: text('modelo'),
    categoria: categoriaEquipo('categoria').notNull(),
    condicion: condicionEquipo('condicion'),
    procesador: text('procesador'),
    ram: text('ram'),
    disco: text('disco'),
    sistema_operativo: text('sistema_operativo'),
  },
  (t) => [
    primaryKey({ name: 'actas_equipos_pk', columns: [t.acta_id, t.equipo_id] }),
    index('idx_actas_equipos_equipo').on(t.equipo_id),
    /** Un movimiento se firma una vez: dos actas sobre la misma entrega son
     *  dos papeles con distinto número, y el día que discrepen no hay forma de
     *  saber cuál vale. */
    uniqueIndex('idx_actas_equipos_movimiento').on(t.movimiento_id),
    foreignKey({
      name: 'actas_equipos_movimiento_del_mismo_equipo',
      columns: [t.movimiento_id, t.equipo_id],
      foreignColumns: [movimientos.id, movimientos.equipo_id],
    }).onDelete('restrict'),
  ],
);

/**
 * El contador del consecutivo, por año. **Tabla y no SEQUENCE** (D25).
 *
 * `nextval()` no participa en la transacción: es inmune a los duplicados pero
 * deja huecos, porque un acta que falle después de pedir su número se lo lleva.
 * Un hueco en la numeración de un documento firmable es una pregunta que
 * alguien tendrá que responder, y «se perdió en un rollback» no es respuesta.
 *
 * La fila se incrementa dentro de la transacción del acta, así que el bloqueo
 * serializa a los concurrentes y un rollback devuelve el número.
 */
export const actasConsecutivo = pgTable('actas_consecutivo', {
  anio: integer('anio').primaryKey(),
  valor: integer('valor').notNull(),
});

/**
 * Obligatoria por el §5: toda escritura sobre `equipos` y todo desciframiento
 * de una clave BIOS deja rastro aquí.
 *
 * `usuario_app_id` admite NULL para poder registrar intentos de acceso que no
 * llegaron a identificar a nadie.
 */
export const auditoria = pgTable(
  'auditoria',
  {
    ...columnasBase,
    tabla: text('tabla').notNull(),
    registro_id: uuid('registro_id').notNull(),
    accion: text('accion').notNull(),
    usuario_app_id: uuid('usuario_app_id').references(() => usuariosApp.id, {
      onDelete: 'restrict',
    }),
    fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
    antes: jsonb('antes'),
    despues: jsonb('despues'),
    ip: inet('ip'),
  },
  (t) => [
    index('idx_auditoria_registro').on(t.tabla, t.registro_id),
    index('idx_auditoria_fecha').on(t.fecha.desc()),
  ],
);
