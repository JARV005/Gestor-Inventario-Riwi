# Pendientes

Cosas detectadas al construir, que no se arreglan donde se encontraron. Cada
una dice a qué etapa pertenece. **No es una lista de deseos**: si algo entra
aquí es porque ya sabemos que hay que hacerlo.

Revisado al cerrar la etapa 5d: **no queda ninguna entrada de la etapa 5 sin
cerrar**. Lo que quedaba abierto se reasignó a la etapa que le toca, y lo que se
cerró está abajo, en Resueltos.

| Sección | Abiertas |
|---|---|
| Etapa 5e — la base se reconstruye desde los dos archivos nuevos | 0 |
| Bandeja de revisión — 177 filas marcadas esperando a una persona | 1 |
| Etapa 5f — el formato del acta | 3 |
| Etapa 6 — dashboard, bandeja y flujos que faltan | 7 |
| Etapa 7 — endurecimiento | 2 |
| Sin etapa: no son decisiones de quien programa | 2 |
| **Total** | **15** |

La 5d se cerró con sus cuatro puntos **y sus pantallas**: los endpoints estaban
desde antes, y un endpoint sin pantalla no es una etapa cerrada. Ver Resueltos.
La 5e abre con lo suyo propio en `decisiones-05.md`, no aquí: sus decisiones no
son cosas detectadas al construir, son el encargo.

---

## Etapa 5f — el formato del acta

### El texto de devolución espera aprobación de BBL

**Es lo único de la 5f-1 que no está cerrado**, y no se puede cerrar aquí: no
existe formato de devolución aprobado. El de entrega sí, y se adaptó lo mínimo.
Mientras tanto, `plantilla_version` de las devoluciones dice `1-borrador` y el
PDF lo lleva escrito en rojo en el pie.

Esto es lo que BBL tiene que mirar. Las cláusulas 7.1–7.9 del formato aprobado
están escritas para quien **recibe** y asume custodia; copiadas tal cual a una
devolución dirían que la persona sigue obligada a custodiar equipos que acaba de
entregar.

**Qué se conservó, adaptado:**

| Devolución | Sale de | Cambio |
|---|---|---|
| 1. Cese de la custodia | 7.1.a | Invertida: la original obliga a custodiar, aquí esa obligación **termina** |
| 2. Estado de los activos devueltos | 7.2.b y 7.2.c | Las dos únicas del formato aprobado que hablan de devolver y no de recibir |
| 3. Confidencialidad y tratamiento de la información | 7.7 | **Sin cambios.** Es la única obligación que sobrevive intacta: no termina al entregar el portátil |
| 4. Responsabilidad por daño detectado en la recepción | 7.8 | Acotada a lo que aparezca en la verificación técnica, en vez de a pérdida y robo durante la custodia |

**Qué se dejó fuera, y por qué:** 7.3 (custodia física y transporte), 7.4 (uso
permitido), 7.5 (contraseñas), 7.6 (instalación de software) y 7.9 (no
devolución). Las cinco hablan de una custodia que acaba de terminar, o —la
última— de que el equipo no se devolvió, cuando el documento existe justamente
porque sí se devolvió.

**No se inventó ninguna cláusula nueva.** Cada una de las cuatro sale de una de
las nueve.

Y tres cambios más, que se ven al abrir el PDF:

- La sección 6 certifica **recepción**, no entrega, y dice que la verificación
  técnica es posterior.
- El orden de las firmas se invierte: en una devolución quien entrega es el
  usuario.
- «Accesorios entregados» pasa a «Accesorios devueltos».

Falta además decidir si una devolución necesita su propia lista de chequeo
—borrado de datos, recuperación de la clave de BitLocker, cierre de cuenta—. En
la 5f-2 se dejó **fuera** a propósito: inventar cuatro items para un documento
legal es exactamente lo que no debe hacer quien programa. Hoy la devolución
tiene siete secciones en vez de ocho.

### ~~Escribir en `equipos` sin dejar rastro en `auditoria`~~

Cerrado al empezar la 5f-2, antes del consecutivo.

Eran **cuatro** funciones y no dos: `crear`, `actualizar`, `cerrarMotivo` y
`fijarTenedor`. Ninguna de las cuatro auditaba, y `db/repositorios/equipos.ts`
no importaba siquiera el módulo. Las cuatro escriben ahora en `auditoria`
dentro de la misma transacción, con el patrón de `mutar`, y ninguna puede
llamarse sin `ContextoEscritura` — quien escribe tiene que saber quién le
llama.

`actualizar` guarda solo los campos que de verdad cambiaron: volcar la fila
entera haría que editar una nota registrara treinta columnas idénticas y que
nadie viera de un vistazo qué se tocó.

**La red que lo sostiene, en dos capas**, porque ninguna basta sola:

- `api.test.ts` recorre `db/repositorios/equipos.ts`, busca las tres formas de
  escribir con drizzle y exige que cada función que escriba mencione
  `repoAuditoria.registrar`. Estático a propósito: un caso que ejercitara los
  cuatro endpoints comprobaría los cuatro que existen hoy; este se pone rojo
  con el quinto que alguien escriba. Falsificado retirando la auditoría de
  `fijarTenedor`: falla nombrándola.
- `equipos.test.ts` comprueba que la fila **llega** a `auditoria` al cerrar un
  motivo y al fijar un tenedor. Sin esta, una llamada dentro de un `if` que
  nunca se cumple pasaría la primera capa.

El caso estático lleva además una guarda contra sí mismo: si detecta menos de
cuatro funciones que escriben, falla. Sin ella, renombrar la tabla o cambiar de
ORM lo dejaría en verde sin comprobar nada.

### El acta dejó de imprimir el estado del equipo

Lo destapó un test al ponerse rojo: «cambiar cualquier dato cambia el hash»
fallaba al cambiar `condicion`, porque **el formato aprobado no tiene columna
para el estado del equipo**. La plantilla anterior sí lo imprimía.

No es un fallo del generador: es lo que BBL aprobó. La sección 4 tiene seis
columnas fijas —tipo, marca/modelo, serie, propietario, accesorios y
comentarios— y ninguna es el estado.

Dos salidas, y ninguna se tomó porque las dos son decisión de BBL: que el
estado vaya en «Comentarios» cuando exista, o que el acta no lo diga y se
consulte en el inventario. Rellenar «Comentarios» por nuestra cuenta sería
escribir en un documento legal algo que nadie pidió.

### El `0000` está sin mirar con el número delante

No bloquea: el sistema funciona así y es lo que se pidió. Queda anotado porque
Johan quiere verlo en pantalla antes de que se emita la primera acta real, por si
prefiere que la primera sea la `0001`.

**La ventana se cierra con la primera acta.** Mientras las series estén vacías es
un cambio de una línea; con actas emitidas deja de serlo, porque renumerar
documentos firmados no es una opción y habría que convivir con dos criterios a la
vez.

Hoy las series están vacías: `actas_consecutivo` no tiene ninguna fila en
desarrollo.

### ~~El prefijo de `Sin clasificar` es `SC`~~

Cerrado en la 5f-2 con **D42**: no hay prefijo porque no hay serie. Una persona
sin empresa no puede recibir un acta, el formulario lo dice y ofrece el
desplegable de dos opciones, y la API responde 409 a quien llegue por otro
camino. El razonamiento con el que puse `SC` miraba al sistema —«que no
bloquee»— en vez de al papel: `SC-0000` en la cabecera no le dice nada a quien
firma.

### El logo de BBL es de 176 × 98 px

Sin prioridad. Se extrajo del PDF de referencia porque no hay archivo suelto, y
a la escala a la que va en el acta da **200 dpi**: suficiente para una marca
plana de dos colores, blando bajo lupa. Si algún día BBL encuentra el original
vectorial, sustituirlo es cambiar el fichero de `assets/logos/` **y subir
`plantilla_version`** (D39) — los bytes del logo están dentro del hash.

---

## Bandeja de revisión — no es deuda de código

### 177 de 305 filas marcadas, y ya se pueden cerrar

La 5e dejó la bandeja con 27 bloques. **No es una entrada de trabajo de
programación**: el mecanismo está terminado —cada motivo se cierra desde la
ficha, y el último baja la marca— y lo que falta es que alguien mire los datos.

Se apunta aquí porque un número así se normaliza si nadie lo escribe en ninguna
parte, y porque los tres bloques grandes son de una sola tarde:

- `SECRETO_NO_ES_SECRETO` (114) — recuperar las claves de Windows reales, o
  confirmar que esos equipos no tienen.
- `LICENCIA_OK` (37) — clasificar los 37 «OK» como RETAIL, OEM, Sin licencia o
  No aplica. Es el bloque que la etapa 2 ya identificó y sigue igual.
- `SIN_SERIAL` (27) — leer el serial de la etiqueta física.

Los tres suman 178 de los 296 motivos. El resto son bloques de menos de 25.

---

## Sin etapa — no son decisiones de quien programa

Las dos esperan a una persona o a un hecho, no a que alguien escriba código.
Ponerles número de etapa sería fingir que se pueden planificar.

### ~~El texto del acta está sin revisar por legal~~ — la mitad, cerrada

**BBL aprobó el formato de ENTREGA.** El texto ya no es un borrador escrito a
partir de la plantilla del prototipo: son las nueve cláusulas del formato que
BBL trajo, literales, y viven en `db/acta-formato.ts` con
`PLANTILLA_VERSION.Entrega = '1'`. El aviso de borrador desapareció de las actas
de entrega.

**La otra mitad sigue abierta** y está arriba, en la 5f: no hay formato de
devolución aprobado, así que se adaptó del de entrega y sus actas siguen
diciendo `1-borrador` con el aviso en rojo.

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

---

## Etapa 6 — dashboard, bandeja y flujos que faltan

### La campana de notificaciones se retiró y no la sustituye nada

La quitó la 5g porque sus tres avisos eran inventados —personas que no existen,
envíos de DHL y FedEx que este sistema no gestiona, un «Hub CDMX»— con un punto
rojo permanente encima que invitaba a actuar sobre cosas que no habían pasado.

**Hay material real para llenarla**, y por eso queda anotado en vez de darse por
cerrado: 177 filas en la bandeja de revisión, los traslados sin confirmar que ya
cuenta el badge de la barra lateral, y los partes de mantenimiento abiertos. Los
tres son consultas que ya existen.

Lo que falta decidir es qué merece interrumpir a alguien, que no es lo mismo que
qué se puede contar.

### Los cinco widgets retirados del dashboard, y qué haría falta para volver

Se quitaron en la etapa 8 porque eran recuadros con título y sin número: un
«Valor Total Inventario» vacío invita a leer cero, que es peor que no estar.

| Widget | Qué le falta para volver |
|---|---|
| **Valor del inventario** | Ni una de las 938 filas trae costo. El campo existe en la BD; el widget vuelve cuando haya datos |
| **Inversión en hardware por área** | Lo mismo, más un área por equipo que hoy solo tienen los celulares |
| **Envíos y retiros** · **Actividad de envíos** | Los traslados ya existen y se ven en Sedes. Aquí harían falta las cifras agregadas, que es trabajo de dashboard, no de datos |
| **Ocupación por sede** | Ninguna sede tiene capacidad declarada, así que no hay porcentaje que calcular. El **conteo** por sede sí es real y está en Sedes |
| **Cumplimiento (MDM)** | **No vuelve.** No hay MDM y el widget graficaba un dato inventado (D3) |

Los cuatro primeros son pendientes de verdad. El quinto está cerrado.

### El desplegable de equipos de la pantalla de licencias trae 200 de 938

Para activar una licencia hay que elegir el equipo en una lista, y esa lista está
topada en 200 como la de colaboradores del generador de actas. Con 938 equipos,
lo más probable es que el que se busca no esté.

Es el mismo problema que 5f-3 resolvió para «Equipos a entregar» y la misma
solución: un buscador contra el servidor. Lo que **ya no** es un problema es leer
a qué equipo apunta una licencia —eso lo resuelve el servidor con un JOIN desde
la etapa 8e—; lo que falta es elegirlo.

### El dashboard usa 52 colores que no son de la paleta

`DashboardView.tsx` pinta con `slate-`, `blue-`, `emerald-` y seis hexadecimales
sueltos de Tailwind por defecto. El resto de la aplicación va por los tokens de
`docs/paleta.md`.

Se nota en el tema oscuro: las tarjetas del dashboard se quedan blancas con
texto gris mientras todo lo demás cambia. No se arregló en la 5g porque esa
pantalla se rehace entera en la etapa 6 —tiene seis marcadores de posición— y
retocar los colores de algo que va a desaparecer es trabajo tirado.

El desglose por estado sí se arregló allí, porque no era cosmético: se dejaba 24
equipos fuera del gráfico.

### El importador dejará de poder reimportar

Hoy la única forma de rehacer una carga es `npm run db:reset`, porque
`movimientos` es append-only y no hay llave natural para reconciliar. Era
aceptable mientras el único contenido fuese la importación y la semilla.

**Ya no lo es.** Al cerrar la etapa 5, la base de desarrollo tiene 7 movimientos
hechos por una persona desde la interfaz: `db:reset` ahora destruye trabajo
real. El importador tendrá que crecer —reconciliar por `importacion_id`, o
importar solo lo que no existía—, y `importaciones.hash_sha256` ya permite
detectar que el archivo cambió. Sube de prioridad dentro de la etapa 6.

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

### ~~El alta y la edición de ficha no dejan rastro en `auditoria`~~

Cerrado al empezar la 5f-2, antes de tiempo: no esperaba a la etapa 7 porque
toda la etapa 5 se apoya en que ninguna escritura queda sin auditar.

Eran **cuatro** funciones y no las dos que decía esta entrada —`crear`,
`actualizar`, `cerrarMotivo` y `fijarTenedor`—, y `db/repositorios/equipos.ts`
no importaba siquiera el módulo. Las cuatro auditan ahora dentro de su
transacción, y ninguna puede llamarse sin `ContextoEscritura`: quien escribe
tiene que saber quién le llama.

El detalle está arriba, en la sección de la etapa 5f.

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

### ~~BUG — «Reasignar» no reasigna~~

Cerrado. Era el último defecto marcado como BUG.

`reasignar` es la **undécima operación** y la única compuesta: `devolver` +
`asignar`, las dos en la misma transacción y **con sus dos movimientos**. Un
atajo que escribiera uno solo —«Reasignación»— se comería la devolución, y el
historial es lo único que justifica el proyecto.

La composición va como **campo de la tabla de transiciones** (`compuesta`), no
como un `if` en el endpoint: es la misma lección que `disparo`. Quien lea la
fila ve que son dos movimientos, y `mutar` los ejecuta porque lo dice la tabla.
Cada mitad pasa por su comprobación de transición, su `FOR UPDATE`, su
movimiento y su fila de auditoría.

Tres cosas que el atajo NO se salta:

- **La pregunta.** «El equipo ya volvió de X» es una casilla que hay que marcar
  antes de que el desplegable se active. Devolver es un hecho físico, no un paso
  de formulario, y sin la casilla el historial afirmaría una entrega que quizá
  no ocurrió.
- **La persona distinta.** Reasignar a quien ya lo tiene da 400 y no escribe
  nada: serían dos movimientos que no cuentan nada.
- **La atomicidad.** Si la segunda mitad falla, la primera se deshace. Hay un
  caso que lo prueba con un empleado inexistente: el equipo NO se queda
  devuelto a medias.

Y se retiraron los dos cabos muertos: `handleReasignar` en `App`, que abría el
asistente de onboarding, y la prop `onReasignar` de `InventoryView`, que ya no
la usaba nadie desde que la vista se reescribió.

### ~~Etapa 5d — lo que BBL pidió y no es del generador de actas~~

Los cuatro, con pantalla:

- **CRUD de colaboradores.** Alta y edición en `EmployeesView`, con su
  formulario. Borrar sigue sin existir (D18): se desactiva, y ese botón ya
  estaba.
- **CRUD de mantenimiento.** `MaintenanceView` deja de ser de solo lectura:
  abre partes con buscador de equipo, mueve el parte entre los tres estados
  abiertos y lo cierra preguntando el desenlace, sin valor por defecto (D29).
- **`empresa` en colaboradores**, con filtro y **el conteo de «Sin clasificar»
  arriba y de un clic**, no escondido en un desplegable.
- **Dirección para la sede Remoto**: aviso en la tarjeta y en el formulario. La
  condición es `sede.ciudad IS NULL`, no el nombre «Remoto» — vale para
  cualquier sede que tampoco sea una oficina.

Y una cosa que no estaba en la lista y salió al conectar las pantallas: el
catálogo ofrecía «Enviar a mantenimiento» como botón y esa ruta no existía. Ver
D29, subsección «El catálogo prometía un botón que no existía».

### ~~Etapa 5c — el acta de varios equipos, y el doble paso~~

Cerrada. Tres cosas que eran una:

- **El acta ejecuta la operación** (D27). `POST /api/actas` tiene modo
  `ejecutar`, que crea los movimientos y los firma en la misma transacción
  reutilizando `mutar()`. El camino manual —los botones del detalle— sigue
  intacto: son dos caminos al mismo sitio.
- **Varios equipos en una sola acta.** El selector pasó a casillas. Un
  onboarding de portátil, teclado, ratón y diadema es un acta con un número, no
  cuatro.
- **El filtro depende de modo × tipo**, cuatro casos. Las dos celdas de `firmar`
  las calcula el servidor, que es el único que sabe qué movimientos siguen sin
  acta.

Lo que NO se hizo, y está en D27: el acta no abre traslados. El asistente de
entrega sí, y esa divergencia es deliberada.

### ~~`notas` existía en el esquema y no había forma de escribirlo~~

Cerrado con la 5c. Editable en el detalle del equipo y presente en el alta.

Las notas que dejó el importador —`USUARIO RESPONSABLE de origen: "..."`, el
único rastro de lo que decía la hoja sobre los responsables que no eran
personas, y del que depende `verificar-datos.sql` §A— se muestran aparte, en
solo lectura, y no entran en el cuadro de edición. Borrarlas sigue siendo
posible, pero hay que marcar una casilla que dice lo que se pierde.

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
