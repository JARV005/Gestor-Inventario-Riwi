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
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  timestamp,
  uuid,
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

export const estadoEquipo = pgEnum('estado_equipo', [
  'Disponible',
  'Asignado',
  'En mantenimiento',
  'En tránsito',
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

export const tipoMovimiento = pgEnum('tipo_movimiento', [
  'Alta',
  'Asignación',
  'Devolución',
  'Traslado',
  'Envío a mantenimiento',
  'Retorno de mantenimiento',
  'Baja',
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
    acta_id: uuid('acta_id').references(() => actas.id, { onDelete: 'restrict' }),
    observaciones: text('observaciones'),
    fecha_confirmacion: timestamp('fecha_confirmacion', { withTimezone: true }),
    transportadora: text('transportadora'),
    guia: text('guia'),
    fecha_estimada: date('fecha_estimada'),
  },
  (t) => [
    index('idx_movimientos_equipo').on(t.equipo_id, t.fecha.desc()),
    // Los traslados abiertos son la fuente del contador "En tránsito" del
    // sidebar y de SedesView (D1). Se consultan en cada carga; son pocos.
    index('idx_movimientos_traslado_abierto')
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
 * `equipos_ids` es un array de UUID, no una tabla puente, tal como lo fija el
 * §2: un acta es un documento firmado y congelado. Su lista de equipos no debe
 * seguir cambiando si después se corrige la fila del equipo.
 */
export const actas = pgTable('actas', {
  ...columnasBase,
  consecutivo: text('consecutivo').notNull().unique(),
  tipo: tipoActa('tipo').notNull(),
  empleado_id: uuid('empleado_id')
    .notNull()
    .references(() => empleados.id, { onDelete: 'restrict' }),
  equipos_ids: uuid('equipos_ids').array().notNull(),
  fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
  generada_por: uuid('generada_por')
    .notNull()
    .references(() => usuariosApp.id, { onDelete: 'restrict' }),
  pdf_path: text('pdf_path'),
  hash_sha256: text('hash_sha256'),
  firmada: boolean('firmada').notNull().default(false),
  fecha_firma: timestamp('fecha_firma', { withTimezone: true }),
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
