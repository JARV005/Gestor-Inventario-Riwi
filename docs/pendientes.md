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

**Medio cerrado en la etapa 5.** Las seis mutaciones y la confirmación de
traslado escriben su fila de `auditoria` dentro de la misma transacción. Siguen
sin dejar rastro `POST /api/equipos` (el alta, cuyo rastro hoy es su movimiento
`Alta`) y `PATCH /api/equipos/:id` (la edición de la ficha, que desde la etapa 5
ya no puede tocar estado, responsable ni sede). Cerrar los dos en la etapa 7,
con el resto del endurecimiento.

---

## Etapa 5 — movimientos y actas

### El cuerpo del acta: escrito, y SIN REVISAR POR LEGAL

**Al día tras la 5b.** El acta se registra, se genera su PDF y se descarga desde
`HandoverDocumentView`. El `TODO(5)` ya no existe en el código.

**Lo que queda no es código.** Las cláusulas de `db/acta-pdf.ts` son un borrador
escrito a partir de la plantilla de abajo, y nadie de la organización las ha
revisado. Mientras `PLANTILLA_VERSION` diga `borrador`, el PDF lo imprime en su
pie y la vista lo avisa en pantalla. Cambiar esa constante quita el aviso de los
dos sitios a la vez, y **es lo último que hay que hacer**, cuando quien vaya a
firmar el acta haya dado el visto bueno.

Hay dos actas de ejemplo con datos inventados en `data/origen/`
(`acta-ejemplo-entrega.pdf` y `acta-ejemplo-devolucion.pdf`) para poder
enseñarlas sin datos de nadie.

El resto de esta entrada se conserva porque la plantilla transcrita es el punto
de partida del que salió la redacción actual, y las tres correcciones de abajo
ya están aplicadas.


Sin IA (`decisiones-03.md` §D12), el acta pasa a plantilla fija. Construirla es
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

### BUG — «Reasignar» no reasigna: abre un modal que solo sabe asignar

**Es un defecto, no una decisión abierta.** El botón existe, se pulsa, y la
operación que promete no ocurre.

`InventoryView` tiene un botón **Reasignar** sobre un equipo concreto, y
`EmployeesView` tiene **Offboarding**. Los dos abren `OnboardingModal` sin
pasarle nada, así que el asistente empieza de cero. Y como el asistente solo
lista equipos `Disponible` o `Reservado` —los únicos que se pueden asignar—, el
equipo desde el que se pulsó **no aparece en su desplegable**. Quien pulsa
Reasignar sobre un portátil asignado se encuentra un formulario en el que ese
portátil no está.

**Qué falta.** Reasignar es `devolver` + `asignar`: dos mutaciones, las dos
existen desde la etapa 5, y la operación compuesta no existe en ninguna parte.
Necesita además la pregunta que hoy nadie hace —«¿lo devolvió de verdad?»—,
porque la devolución es un hecho físico y no un paso de formulario.

No se arregla en la etapa 5: 5a y 5b primero. Al arreglarlo, el modal tiene que
recibir el equipo de partida en vez de empezar de cero.

`Offboarding` era el tercer caso de este mismo bug y ya está cerrado: tiene su
propio modal (`OffboardingModal`), que devuelve en vez de asignar.

**Atenuante desde que existen los botones del detalle:** hoy la operación se
puede hacer, aunque no desde este botón. Desde el detalle del equipo salen
«Registrar devolución» y luego «Asignar a alguien», que son exactamente las dos
mitades de reasignar. Lo que falta es el atajo, no la capacidad.

### Etapa 5c — el acta de varios equipos desde la interfaz

La API ya acepta hasta 50 equipos por acta y la plantilla los imprime en lista
(comprobado: cuatro caben en una página, ocho ocupan dos). Lo que emite de uno
en uno es **`HandoverDocumentView`**, porque su selector es de un solo equipo y
cambiarlo cambia lo que la pantalla muestra.

Un onboarding entrega portátil, teclado, ratón y diadema el mismo día. Cuatro
actas separadas para una entrega son cuatro números de consecutivo, cuatro
firmas y cuatro papeles que archivar — fricción que devuelve a la gente al
método anterior, que es el fallo que este proyecto existe para arreglar.

Al hacerlo: el selector pasa a marcar varios de los equipos que la persona tiene
a su nombre, igual que hace `OffboardingModal`. El servidor no necesita ningún
cambio.

### El equipo perdido o robado mientras estaba asignado

**No resolver todavía.** Se anota porque va a aparecer, no porque haya que
inventarle una operación ahora.

Dar de baja un equipo `Asignado` está prohibido a propósito (`db/transiciones.ts`):
destruir en el inventario algo que una persona tiene en la mano deja a esa
persona con un activo que el sistema cree que ya no existe. La salida que el 409
ofrece es «devuélvelo primero».

Eso funciona para un equipo que se rompe o se jubila. **No funciona para uno que
se perdió o lo robaron**: nadie devolvió nada, y registrar una `Devolución` para
poder dar la baja es escribir en el historial un hecho que no ocurrió — el
equipo nunca volvió a manos de TI.

Cuando ocurra el primer caso real, se decide con él delante: si es un
`tipo_movimiento` nuevo (`Pérdida`, `Baja por siniestro`), si es una baja con
motivo que sí acepta salir de `Asignado`, o si el flujo pasa por otro sitio
—acta, denuncia, seguro— antes de tocar el inventario. La respuesta depende de
qué haga la empresa con el papel, y eso no se puede adivinar desde aquí.

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

### ~~Los traslados abiertos desaparecieron de la interfaz~~

Cerrado en la etapa 5, paso 3. Era la única funcionalidad **visible** que se
perdió al sustituir `LogisticsHubsView` por `SedesView` en la etapa 4a.

Vuelve como lista bajo las tarjetas de sede, con origen → destino, equipo,
responsable, transportadora, guía, llegada prevista y días en tránsito —este
último calculado por Postgres, no por el navegador. Cada fila lleva su botón de
confirmar llegada, que es `POST /api/movimientos/:id/confirmar`.

Lo que cambia respecto al prototipo: **los datos existen**. El original los
inventaba (DHL / FedEx / Estafeta y hubs con capacidad); estos salen de las
columnas que `movimientos` tenía vacías desde la 0000. Lo que no volvió es la
capacidad de los hubs, que nunca tuvo de dónde salir.

El badge del sidebar y esta lista salen de la misma condición —`tipo =
'Traslado'` y `fecha_confirmacion IS NULL`—, así que no pueden discrepar.

### ~~El invariante de D1 no lo impone nadie~~

Disuelto por D13 en la etapa 5, que es mejor que impuesto.

El invariante era «un equipo está `En tránsito` ⟺ existe un movimiento
`Traslado` con `fecha_confirmacion IS NULL`», y hacía falta un CONSTRAINT
TRIGGER deferido porque cruza dos tablas. Al quitar `En tránsito` del enum de
estados (0008) y **derivar** «está viajando» del traslado abierto, el lado
izquierdo de la equivalencia dejó de existir: ya no hay dos sitios que puedan
contradecirse. El índice único parcial cubre lo que quedaba —que no haya dos
traslados abiertos del mismo equipo, que sería el equipo en dos sitios a la vez.

Lo que sí quedó por comprobar, y está en `verificar-datos.sql` §F2: que la sede
de un equipo sea la del destino de su último traslado confirmado.

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
