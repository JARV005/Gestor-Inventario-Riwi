# Pendientes

Cosas detectadas al construir, que no se arreglan donde se encontraron. Cada
una dice a qué etapa pertenece. **No es una lista de deseos**: si algo entra
aquí es porque ya sabemos que hay que hacerlo.

---

## Etapa 3 — auth y API núcleo

### `POLIZA DE SEGURO` y `z No asignar` están en `empleados`

Son dos artefactos de hoja de cálculo importados como personas. Se dejaron
deliberadamente para que el recuento del Excel y el de la BD coincidieran
(`decisiones-02.md` D10 punto 4).

**Son el primer caso de prueba de la gestión de empleados**: la corrección es
marcarlos `activo = false` desde la aplicación, no un `UPDATE` a mano ni una
reimportación. Si la etapa 3 no permite hacerlo, no está terminada.

Riesgo mientras tanto: en la etapa 5 aparecerán en el desplegable de «a quién se
le entrega un equipo» y pueden acabar en un acta.

### Nadie escribe en `auditoria`

La tabla existe desde la 0000 y sigue vacía. El §5 la exige para toda escritura
sobre `equipos` y todo desciframiento de BIOS. La importación de la etapa 2 no
escribió ni una fila; su rastro equivalente son `importaciones` y los 186
movimientos `Alta`.

---

## Etapa 5 — movimientos

### El invariante de D1 no lo impone nadie

«Un equipo está `En tránsito` ⟺ existe un movimiento `Traslado` con
`fecha_confirmacion IS NULL`». Cruza dos tablas, así que no cabe en un CHECK.
Hoy no hay ni un traslado, así que no hay nada incumplido, pero tampoco nada
que lo impida.

Cuando exista el primero, decidir si va como CONSTRAINT TRIGGER deferido —el
mismo patrón que `0006_motivos_referenciales.sql`— o si se deja a la capa de
transacciones.

### El importador dejará de poder reimportar

Hoy la única forma de rehacer una carga es `npm run db:reset`, porque
`movimientos` es append-only y no hay llave natural para reconciliar. Es
aceptable mientras el único contenido sea la importación y la semilla.

En cuanto haya un movimiento hecho por una persona, `db:reset` destruye trabajo
real y el importador tendrá que crecer: reconciliar por `importacion_id`, o
importar solo lo que no existía. `importaciones.hash_sha256` ya permite
detectar que el archivo cambió.

---

## Etapa 6 — dashboard y bandeja

### `motivos_revision.recomendacion`

La tabla se creó con `codigo` y `descripcion` a propósito. La recomendación de
resolución vive hoy en `db/motivos.ts` y solo sale al CSV; cuando la bandeja
tenga interfaz, se sube a la tabla y la interfaz la lee de ahí.

Mientras tanto hay una duplicación tolerada: `descripcion` está en el código y
en la BD. La semilla la propaga con `onConflictDoUpdate`, así que el código
manda.

### Códigos huérfanos

Si un código se borra de `db/motivos.ts`, `npm run seed` **no** lo borra de la
tabla: la semilla solo inserta y actualiza. La FK impediría borrarlo si algún
equipo lo usa, que es lo correcto, pero un código retirado y sin uso se queda
ahí para siempre. Añadir el barrido cuando la bandeja tenga interfaz para
verlos.

---

## Etapa 7 — endurecimiento

### Rotar `ENCRYPTION_KEY` no tiene procedimiento

`db/cifrado.ts` cachea la clave y no contempla más de una. Rotarla hoy
significa que todo lo cifrado con la anterior deja de descifrarse. Hace falta un
script de recifrado, y probablemente un byte de versión al principio del `bytea`
para poder convivir con dos claves durante la migración.

---

---

## Resueltos

### ~~`verificar-datos.sql` es vacuamente verde en una BD vacía~~

Cerrado al final de la etapa 2. El fichero ahora aborta en su primera línea si
`equipos` está vacía, con exit 3. El motivo de que no bastara con imprimir el
recuento: `npm run db:reset` deja la BD exactamente así, de modo que correrlo
justo después es el camino natural y no un descuido raro. Un test de datos
sobre cero datos no está en verde, está inaplicable.
