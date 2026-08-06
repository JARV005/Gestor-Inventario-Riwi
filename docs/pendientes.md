# Pendientes

Cosas detectadas al construir, que no se arreglan donde se encontraron. Cada
una dice a qué etapa pertenece. **No es una lista de deseos**: si algo entra
aquí es porque ya sabemos que hay que hacerlo.

---

## Etapa 3 — auth y API núcleo

### Nadie escribe en `auditoria` salvo el desciframiento de BIOS

La etapa 3 la llena solo en `GET /api/equipos/:id/bios`. El §5 la exige también
para **toda escritura sobre `equipos`**, y eso todavía no ocurre: un `POST` o un
`PATCH` no dejan rastro.

Encaja mejor con la etapa 5, cuando existan las mutaciones de estado y haya un
`antes`/`despues` que valga la pena guardar. La importación de la etapa 2
tampoco escribió aquí; su rastro equivalente son `importaciones` y los 186
movimientos `Alta`.

---

## Etapa 5 — movimientos y actas

### El cuerpo del acta quedó en TODO(5)

Sin IA (`decisiones-03.md` §D6), el acta pasa a plantilla fija. Construirla es
trabajo de la etapa 5; lo que la 4b dejó hecho es la mitad de lectura:
`HandoverDocumentView` saca de la base los datos del colaborador (nombre,
puesto, área, cédula, sede) y del equipo (modelo, etiqueta, serial, licencia,
sede, estado, especificaciones).

Falta el cuerpo: razón social, número de acta, cláusulas de custodia y uso,
protocolo de devolución y los dos bloques de firma. Está marcado con `TODO(5)`
en la vista, y **el hueco se ve en pantalla a propósito**: el documento dice que
sirve para consultar y no para firmarse. Un acta que se imprime con aspecto de
completa y sin cláusulas es la que alguien firma sin mirar.

**Punto de partida — NO revisado por legal.** Es la plantilla del `fallback` del
endpoint de Gemini, la que salía cuando no había clave de API. Se transcribe
aquí entera porque el endpoint se borró y esto es lo único aprovechable que
tenía dentro. Hay que pasarla por alguien de legal antes de imprimir nada:

```markdown
# ACTA DE ENTREGA Y RESPONSABILIDAD DE EQUIPO DE COMPUTO
**Organización:** <razón social>
**Fecha:** <fecha de entrega>
**Lugar / Sede:** <sede>

---

### DATOS DEL COLABORADOR
- **Nombre Completo:** <nombre>
- **Puesto / Rol:** <cargo>
- **Documento / ID:** <cédula>

### DETALLE DEL EQUIPO ASIGNADO
- **Equipo / Modelo:** <marca y modelo>
- **Número de Serie:** <serial>
- **Especificaciones:** <procesador, RAM, disco, SO>
- **Estado Físico:** <condición>

---

### COMPROMISO Y CONDICIONES DE USO
1. El colaborador declara haber recibido el equipo descrito arriba en perfectas
   condiciones operativas y físicas.
2. El equipo está destinado exclusivamente para el desempeño de las labores
   asignadas por la empresa.
3. El colaborador se compromete a cuidar el bien y notificar de inmediato
   cualquier falla, extravío o daño a TI.
4. En caso de desvinculación (Offboarding), el colaborador deberá devolver el
   equipo.

---
**Firma del Colaborador:** _______________________
**Firma de Entrega TI:** _______________________
```

Tres cosas que hay que corregir al montarla, y que en el original estaban mal:

- **«Estado Físico: Excelente / Como Nuevo (Certificado FirstPlug)» iba fijo**,
  sin mirar el equipo. Va `equipos.condicion`, y si es NULL va vacío: es
  precisamente el campo que `verificar-datos.sql` §D prohíbe rellenar en
  equipos de cómputo, así que en un portátil quedará en blanco.
- **La cláusula 4 mandaba usar «el kit de recolección FirstPlug»**, que no
  existe. El protocolo de devolución hay que escribirlo.
- **El original llevaba número de acta inventado** (`FP-2026-9041`) y una
  firmante que no existe. Si el acta lleva número, tiene que salir de una
  secuencia real; el firmante, de la sesión.

### Los traslados abiertos desaparecieron de la interfaz

Es la única funcionalidad **visible** que se perdió al sustituir
`LogisticsHubsView` por `SedesView` en la etapa 4a. Todo lo demás que se fue
—capacidad de los hubs, transportadoras, números de guía— nunca tuvo datos
detrás: ni en el Excel ni en el esquema.

**Qué mostraba antes.** Una lista de envíos en curso, cada uno con:
transportadora (DHL / FedEx / Estafeta), número de guía, fecha estimada de
entrega, hub de origen y de destino, nombre del empleado y equipos incluidos.
Todo ello inventado por el prototipo.

**Qué tiene que mostrar cuando existan los movimientos.** Un traslado abierto
es una fila de `movimientos` con `tipo = 'Traslado'` y
`fecha_confirmacion IS NULL` (D1). El esquema ya tiene los campos, vacíos desde
la migración 0000:

| Columna | Qué es |
|---|---|
| `transportadora` | Quién lo lleva |
| `guia` | Número de seguimiento |
| `fecha_estimada` | Entrega prevista |
| `sede_origen_id` / `sede_destino_id` | De dónde a dónde |
| `equipo_id` | Qué se mueve |

En `SedesView` va como lista bajo las tarjetas de sede: origen → destino,
equipo, transportadora, guía y días en tránsito. Y el contador «en tránsito» de
cada tarjeta, que hoy sale de `equipos.estado`, debe cuadrar con el número de
traslados abiertos de esa sede — es el invariante de D1 y son las dos caras del
mismo hecho.

El sitio en el código está marcado con `TODO(5)` al final de
`src/components/SedesView.tsx`, pero **el TODO no es el recordatorio**: esta
entrada lo es.

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

Sube de prioridad desde la etapa 4a: el arranque ya se niega a funcionar con una
clave que no descifra (`db/comprobar-cifrado.ts`), así que el fallo es visible.
Lo que sigue sin existir es la salida — si la clave se filtra, hoy no hay forma
de cambiarla sin perder los datos. Ver la sección de custodia en `despliegue.md`.

### La restauración de un backup debe incluir descifrar

El §5 exige probar la restauración al menos una vez. Esa prueba tiene que llegar
hasta descifrar una fila con la clave que se guarda aparte: una base restaurada
cuyos campos cifrados no se pueden leer está restaurada solo a medias, y el
`pg_restore` termina en verde igualmente.

---

---

## Resueltos

### ~~`POLIZA DE SEGURO` y `z No asignar` están en `empleados`~~

Cerrado en la etapa 3, **desde la aplicación** y no con un `UPDATE`: los dos
quedaron `activo = false` vía `PATCH /api/empleados/:id` con sesión de admin.
La transcripción de las peticiones está en `api.md`.

Resolverlos por SQL habría cerrado el síntoma sin demostrar lo que importaba:
que la aplicación es capaz de hacerlo. De paso quedó el bloqueo que impide
desactivar a alguien con equipos a su nombre, comprobado contra un empleado real
del inventario.

### ~~`verificar-datos.sql` es vacuamente verde en una BD vacía~~

Cerrado al final de la etapa 2. El fichero ahora aborta en su primera línea si
`equipos` está vacía, con exit 3. El motivo de que no bastara con imprimir el
recuento: `npm run db:reset` deja la BD exactamente así, de modo que correrlo
justo después es el camino natural y no un descuido raro. Un test de datos
sobre cero datos no está en verde, está inaplicable.
