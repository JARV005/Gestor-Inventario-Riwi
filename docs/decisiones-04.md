# Decisiones 04 — etapa 5, movimientos y actas

Fecha: 2026-08-06. Etapa 5.
Tomadas **antes de escribir nada**, porque las tres contradicen el esquema
declarado en `docs/plan-migracion-v1.md` §2 o el D1 de `docs/decisiones-01.md`.
Esos documentos no se editan: son el registro de lo que se decidió entonces.

Numeración: la anterior más alta era D11 (`decisiones-02.md`). `decisiones-03.md`
salió con un D6 que chocaba con `decisiones-01.md`; se renumeró a **D12** y se
actualizaron sus siete referencias. Esta empieza en D13.

---

## D13. «En tránsito» deja de ser un estado del equipo

**Contradice D1.** D1 decía que un traslado en curso pone el equipo en
`estado = 'En tránsito'`.

### El choque

`equipos_asignado_implica_empleado` es una **equivalencia**, no una implicación:

```sql
CHECK ((estado = 'Asignado') = (empleado_id IS NOT NULL))
```

Un portátil asignado a alguien y viajando hacia esa persona no cabe. O está
`Asignado` —y entonces no puede estar `En tránsito`— o está `En tránsito` y el
CHECK **obliga** a `empleado_id = NULL`, con lo que se pierde de quién es
mientras dura el viaje.

Y el caso que el propio D1 pone como principal es exactamente ése: «Salida de
`OnboardingModal` → movimiento tipo `Asignación`, o `Traslado` si cambia de
sede». Mandar el kit de onboarding a alguien remoto **es las dos cosas a la
vez**. Eran dos hechos metidos en una columna.

Afecta a los 157 equipos asignados de hoy: con D1 tal cual, trasladar
cualquiera de ellos lo desasignaba.

### Lo que se hace

`estado` responde **de quién es y para qué está** —`Disponible`, `Asignado`,
`Reservado`, `En mantenimiento`, `De baja`— y nada más. «Está viajando» pasa a
derivarse de la existencia de un traslado abierto:

```sql
EXISTS (SELECT 1 FROM movimientos m
         WHERE m.equipo_id = e.id
           AND m.tipo = 'Traslado'
           AND m.fecha_confirmacion IS NULL)
```

El CHECK se queda intacto. El invariante de D1 —«en tránsito ⟺ traslado
abierto»— deja de ser algo que imponer: pasa a ser la **definición**, y un
invariante que no se puede incumplir es mejor que uno vigilado.

`'En tránsito'` sale del enum `estado_equipo`. La migración no tiene que
convertir ninguna fila: hoy hay **cero** equipos en ese estado.

### Consecuencias

- El contador del sidebar cuenta traslados abiertos, no equipos por estado.
  Sigue dando el mismo número, pero ahora por la razón correcta.
- `idx_movimientos_traslado_abierto` pasa a ser **UNIQUE**. Era un índice
  normal, así que nada impedía dos traslados abiertos del mismo equipo — que
  es justo uno de los invariantes que la etapa 5 tiene que garantizar. Con el
  índice único lo impone Postgres en el INSERT, no un verificador a posteriori.
- La entrada de `pendientes.md` sobre «el invariante de D1 no lo impone nadie»
  queda cerrada por construcción, no por un CONSTRAINT TRIGGER.

---

## D14. Las actas llevan tabla puente **con instantánea**

**Contradice §2**, que declara `actas.equipos_ids UUID[]`, y el comentario de
`db/esquema.ts` que lo justificaba.

### Por qué el array no vale

El argumento del §2 era bueno: un acta es un documento firmado y congelado, y
su lista de equipos no debe cambiar porque después se corrija la fila del
equipo. Pero un array **no tiene clave foránea**. «Toda acta apunta a equipos
que existen» no se puede imponer ni verificar sobre él, y ese es uno de los
invariantes que la etapa 5 debe comprobar.

### Por qué la tabla puente sola tampoco

Una puente con solo `acta_id` y `equipo_id` da integridad referencial y pierde
lo que el §2 protegía: si mañana se corrige un serial, el acta ya firmada pasa
a mostrar otro. Un documento legal no puede cambiar de contenido a posteriori.

### Lo que se hace

Las dos cosas a la vez:

```sql
CREATE TABLE actas_equipos (
  acta_id   uuid NOT NULL REFERENCES actas(id)   ON DELETE RESTRICT,
  equipo_id uuid NOT NULL REFERENCES equipos(id) ON DELETE RESTRICT,
  -- lo que el acta DICE, congelado en el momento de generarla:
  etiqueta  text,
  serial    text,
  marca     text,
  modelo    text,
  PRIMARY KEY (acta_id, equipo_id)
);
```

La FK garantiza que el equipo existe; las cuatro columnas de instantánea
garantizan que el documento no cambia. Se elimina `actas.equipos_ids`.

---

## D15. El PDF del acta vive en Postgres, no en disco

**Contradice §2**, que declara `actas.pdf_path`.

### Por qué

El §5 exige **probar la restauración de un backup al menos una vez**, y
`pendientes.md` ya recoge que esa prueba tiene que llegar hasta descifrar una
fila. Un fichero suelto en disco es una segunda cosa que respaldar, restaurar y
mantener en paso con la fila que lo referencia. Un `pg_dump` que termina en
verde sobre una base cuyos PDF se quedaron en otro disco es una restauración a
medias que no lo parece.

Un acta pesa del orden de 40 KB. Con el volumen de este inventario, guardarlas
en la fila no es un problema de tamaño.

### Lo que se hace

```sql
actas.pdf          bytea NOT NULL
actas.hash_sha256  text  NOT NULL
-- se elimina pdf_path
```

`pg_dump` se lleva el documento y su hash juntos, y la restauración se verifica
recalculando el sha256 sobre la propia columna.

---

## D16. `pdfkit`, y el PDF tiene que ser reproducible

### La dependencia

`pdfkit`. JS puro: sin módulos nativos, sin navegador headless, sin descargas
en `npm install` más allá del tarball. Eso pesa más desde D12: la aplicación no
habla con ningún servicio externo, y meter Puppeteer traería ~150 MB de
Chromium en la instalación y un proceso de navegador por cada acta.

Descartados y por qué:

| Candidato | Motivo |
|---|---|
| `puppeteer` / `playwright` | Mejor fidelidad, pero ~150 MB de Chromium y un navegador por acta |
| `@react-pdf/renderer` | Encaja con el stack, pero su reconciler suele ir por detrás de React y la 19 es reciente |
| `pdfmake` | Razonable; construido sobre pdfkit. Sería la elección si el acta creciera en tablas |

Acentos: la Helvetica estándar del formato PDF usa WinAnsiEncoding, que cubre
`á é í ó ú ñ ü ¿ ¡`. Aun así se embebe una fuente, para que el resultado no
dependa de la sustitución que haga el lector.

### El hash tiene que poder recalcularse

pdfkit estampa `CreationDate` y `Producer` en cada render, así que **la misma
acta generada dos veces produce bytes distintos y hash distinto**. Un
`hash_sha256` que nadie puede recalcular no prueba nada: no distingue un
documento íntegro de uno alterado, solo ocupa una columna.

Por eso el generador fija `CreationDate` a `actas.fecha` y fija el `Producer`.
Con eso, regenerar el acta desde los datos congelados de `actas_equipos` años
después da byte a byte el mismo PDF, y comparar el hash es una comprobación de
verdad. Eso entra en `verificar-datos.sql` como invariante.

---

## D17. `Reservado` deja de ser un estado terminal

`Reservado` existe en `estado_equipo` desde la 0000 y **ningún movimiento podía
producirlo**: se podía salir de ese estado pero no entrar. El importador dejó un
equipo así y nadie más podía crear otro, aunque «reservar un equipo para quien
entra el mes que viene» es una operación corriente.

Se añaden dos valores a `tipo_movimiento` (0008) y dos mutaciones:

```
POST /api/equipos/:id/reservar   ->  Disponible  ->  Reservado
POST /api/equipos/:id/liberar    ->  Reservado   ->  Disponible
```

`Liberación` y no `Devolución`: devolver es lo que hace quien tenía el equipo.
Liberar una reserva no devuelve nada, porque nadie llegó a tenerlo. Son dos
hechos distintos y el historial tiene que poder distinguirlos.

Con esto la etapa 5 tiene **seis** mutaciones, no cuatro: asignar, devolver,
trasladar, dar de baja, reservar y liberar.

---

## D18. Los usuarios no se borran nunca, y el RESTRICT es deliberado

`auditoria.usuario_app_id` y `movimientos.usuario_app_id` son
`ON DELETE RESTRICT`. En cuanto la etapa 5 audite toda escritura sobre
`equipos`, ningún usuario que haya hecho algo podrá borrarse.

**Eso no es un efecto secundario que haya que tolerar: es el punto.** Un rastro
que se borra borrando al usuario no es un rastro. El caso real con un equipo de
TI de una a tres personas es que alguien se va, y eso ya está resuelto:
`activo = false` corta sus sesiones en el acto —comprobado en la etapa 3— y
conserva su historial.

El riesgo es que dentro de un año alguien reciba un error de clave foránea al
intentar borrar un usuario y lo «arregle» cambiando el RESTRICT por CASCADE, que
es exactamente lo que no debe pasar. Por eso queda escrito en tres sitios, no en
uno:

1. **En la base**, como `COMMENT ON CONSTRAINT` sobre las dos FK (0008). Sale en
   un `\d+ auditoria` sin tener que encontrar ningún documento.
2. **En el código**, cuando exista el endpoint de borrado de usuarios: devuelve
   **409** explicando que las cuentas se desactivan, no se borran, y con la
   ruta del `PATCH` que sí hace lo que se quería. Un 500 con «violates foreign
   key constraint» invita a ir a tocar la constraint.
3. **Aquí.**

Ya mordió una vez: en la 4b la limpieza del arnés de tests llevaba rota desde la
etapa 3 por este mismo RESTRICT, tapada porque `node:test` no cuenta el fallo de
un hook en `# fail`. La solución correcta fue que la suite borrase su propia
auditoría antes que sus usuarios, no relajar la constraint.

---

## D19. El `PATCH` de un equipo no puede mover estado, responsable ni sede

`PATCH /api/equipos/:id` edita la **ficha**: marca, modelo, RAM, notas, costo.
Desde la etapa 5 rechaza con **409** cualquier cuerpo que traiga `estado`,
`empleado_id` o `sede_id`, y el mensaje dice por qué endpoint va cada uno.

No es una restricción de forma. La regla 5 del proyecto —«las mutaciones de
estado escriben en `equipos` y `movimientos` en la misma transacción, nunca por
separado»— tenía una puerta trasera abierta desde la etapa 3: un `PATCH` que
cambiara el estado escribía en `equipos` y en nada más. El equipo cambiaba de
dueño sin dejar rastro de quién lo tenía antes, y el historial —lo único que
justifica el proyecto— quedaba con agujeros que nadie ve, porque un historial
incompleto se lee igual que uno completo.

**409 y no descarte silencioso.** La alternativa fácil era quitar los tres
campos del esquema de zod y ya: el `PATCH` los ignoraría y devolvería 200. Es el
mismo modo de fallo que tenía `costo` en el `POST`, encontrado en la 4b — el
formulario mandaba el dato, la API lo tiraba, y nadie se enteraba porque la
respuesta decía que todo había ido bien.

**Lo que esto hace comprobable.** Con esa puerta cerrada, el estado de un equipo
solo puede venir de un movimiento, y eso ya es un invariante que se puede
contar: `verificar-datos.sql` §F2 comprueba que el estado de cada equipo es el
que dejó su último movimiento de estado, que su responsable es el de su última
`Asignación`, y que su sede es el destino de su último traslado confirmado. Si
alguien reabre la puerta, esas tres se ponen rojas.

**Lo que queda fuera:** el `POST` sí pone estado, responsable y sede, porque el
alta los establece en vez de cambiarlos, y escribe su movimiento `Alta` en la
misma transacción. Y el importador escribe directo contra la base, que es lo
correcto para una carga masiva con su propio rastro (`importaciones`).

---

## D20. La entrega de un kit no es atómica, y se dice

`OnboardingModal` entrega varios equipos a la vez: un portátil, un monitor,
periféricos. Cada uno se manda por separado —`POST /api/equipos/:id/asignar`, y
un `trasladar` detrás si el equipo no está en la sede de quien lo recibe—, y
**no hay ninguna transacción que abarque el kit entero**.

Cada llamada sí es atómica por dentro. Lo que no existe es «los tres o
ninguno». Un endpoint de lote lo daría, y se descartó porque el caso que hace
fallar a uno del kit no es un error del sistema: es que alguien se llevó ese
portátil hace un minuto. Deshacer las otras dos asignaciones por eso sería peor
—dos equipos que ya salieron del almacén volverían a figurar como disponibles.

La consecuencia es de interfaz y es obligatoria: el modal enseña el resultado
**equipo por equipo**, y el confeti solo salta si salieron todos. Celebrar un
kit a medias esconde justo lo que hay que mirar: el equipo que no se asignó
sigue disponible para otra persona, y alguien tiene que enterarse hoy y no
cuando lo reclame el colaborador.

Si más adelante hace falta el todo-o-nada, el sitio es un endpoint de lote que
llame a `mutar()` varias veces dentro de una sola transacción; la función ya
acepta el ejecutor por parámetro precisamente para eso.

---

## D21. Los botones de las mutaciones los decide el servidor

`GET /api/transiciones` devuelve la tabla de `db/transiciones.ts` entera —qué
operaciones hay, desde qué estados, qué dato exige cada una, con qué etiqueta se
pinta el botón y cuáles son irreversibles— y `por_estado`, el mapa que dice qué
se puede hacer con un equipo en cada estado.

**El frontend no tiene ni un `if` sobre el estado.** Los botones son
`por_estado[equipo.estado]`. Cualquier alternativa —una lista de operaciones en
el componente, un `switch` por estado, un array de etiquetas— sería una segunda
tabla de transiciones, y las dos se separarían sin que nadie lo note: un botón
que siempre da 409, o una operación nueva sin botón. Lo segundo es peor porque
es invisible: nadie echa de menos lo que nunca vio.

`por_estado` se genera recorriendo los valores del enum, no una lista aparte.
Un estado nuevo aparece solo, aunque sea con la lista vacía, y esa lista vacía
también es información: significa que no hay forma de salir de él.

### Por qué existe

Las seis mutaciones se construyeron en el paso 2 y ninguna tenía punto de
entrada: solo se podían ejecutar por `curl`. Es el mismo patrón que el estado de
error de `InventoryView` en la etapa 4a —código correcto e inalcanzable, con la
interfaz como capa que falta— y con una consecuencia concreta: quien no
encuentra cómo dar de baja un equipo termina pidiendo que se lo cambien en la
base a mano, que es justo lo que D19 acaba de cerrar.

### El caso de fallo

Si el catálogo no carga, **no se pinta ningún botón** y se explica por qué.
Pintarlos adivinando pondría en pantalla operaciones que van a dar 409, y una
interfaz que ofrece lo que no se puede hacer es peor que una que no ofrece nada.

Comprobado: con Postgres parado, `GET /api/transiciones` responde 500 —el
endpoint no consulta la base, pero el guardián de sesión sí—, y el detalle del
equipo enseña el aviso en vez de una fila de botones.

---

## D22. Offboarding es la operación contraria a onboarding, no la misma

Herencia del prototipo, encontrada probando la aplicación en el navegador: los
botones **Offboarding** de `EmployeesView` y **Enviar Kit Onboarding** abrían el
mismo modal, que asigna equipos. Offboarding hace lo contrario: la persona
entrega lo que tiene y los equipos vuelven a `Disponible`. Una pone
`empleado_id` y la otra lo quita.

En el prototipo daba igual porque ninguno de los dos escribía nada. Desde que el
asistente de entrega escribe de verdad, el botón de recoger equipos asignaba
más.

`OffboardingModal` es ahora su propio flujo: elegir a la persona (viene de la
tarjeta), listar lo que tiene hoy con `GET /api/empleados/:id/equipos`, marcar
lo que entrega, y un `POST /api/equipos/:id/devolver` por cada uno. Mismo
tratamiento por equipo que la entrega y por el mismo motivo (D20).

**Enlaza con el bloqueo de la etapa 3.** Un empleado con equipos a su nombre no
se puede desactivar; el `PATCH` responde 409 diciendo que hay que devolverlos
primero. Ese 409 era hasta ahora un callejón sin salida en la interfaz: decía lo
que faltaba y no había forma de hacerlo. Ahora la recogida termina justo en la
condición que lo levanta, y cuando no queda nada a nombre de la persona el modal
ofrece desactivarla. Las dos mitades de la misma operación, en el mismo sitio.

---

## D23. La instantánea del acta incluye a la persona, no solo al equipo

La 0008 (D14) congeló etiqueta, serial, marca y modelo del equipo. Al escribir
la 5a quedó claro que eso era **media instantánea**.

El cuerpo del acta imprime, además de eso: el nombre, el cargo y el documento
del colaborador, su sede, las especificaciones del equipo (procesador, RAM,
disco, sistema operativo) y su estado físico. Todo eso se habría leído por FK al
pintar el documento — y entonces corregir el cargo de alguien en marzo cambiaría
el acta que firmó en enero. Es exactamente el fallo que la instantánea existe
para impedir, aplicado a la mitad de la tabla que nadie miró.

La 0009 lo cierra: `actas` gana el bloque de la persona, `actas_equipos` el
resto del equipo. `empleado_nombre` y `generada_por_nombre` van **NOT NULL**, y
eso no es cosmética: es lo que impide que alguien añada mañana un segundo camino
de creación que se olvide de copiar la instantánea y deje el acta apuntando solo
por FK. El caso 30 de `verificar-esquema.sql` lo comprueba.

**Qué NO se congela:** nada que el acta no imprima. La instantánea es la copia
de lo que el documento dice, no un duplicado de la fila.

Y la regla para leerlo: en cualquier vista que muestre un acta emitida, los
datos salen de la instantánea. Volver a consultar `equipos` o `empleados` desde
ahí deshace todo esto sin cambiar una sola línea de esquema.

---

## D24. El acta se ata al movimiento que la origina

Un acta se emite **sobre una operación que ya ocurrió**: una entrega documenta
la `Asignación`, una devolución documenta la `Devolución`. No al revés — no se
emite el acta y luego se entrega el equipo.

Sin la atadura, dentro de un año hay actas que nadie sabe a qué entrega
corresponden, y movimientos de los que nadie sabe si se firmó papel. Son las dos
caras de la misma pregunta y hoy no se podía responder ninguna.

**Dónde vive:** `actas_equipos.movimiento_id`, NOT NULL. No en
`movimientos.acta_id`, que era la columna que había desde la 0000 y que se ha
borrado. Dos razones:

1. Un acta cubre N equipos y **cada equipo tiene su propio movimiento**. El par
   (acta, equipo) ya vive en `actas_equipos`; el movimiento es un atributo de
   ese par, no del acta ni del movimiento por separado.
2. `movimientos` es append-only y su trigger solo permite cambiar
   `fecha_confirmacion`. Como el acta se emite **después** del movimiento,
   rellenar `movimientos.acta_id` habría exigido relajar por segunda vez la
   regla que protege el historial. La columna era, literalmente, imposible de
   escribir sin tocarla — y nunca tuvo un valor: 0 de 190 filas.

**La FK es compuesta**, `(movimiento_id, equipo_id) → movimientos(id, equipo_id)`,
y eso requirió añadir un UNIQUE redundante sobre `movimientos(id, equipo_id)`.
Merece la pena: con dos FK sueltas, ambas apuntarían a filas que existen y se
podría firmar el acta de un portátil contra la asignación de otro. Nadie lo
vería hasta leer el acta. Ahora lo rechaza Postgres en el INSERT.

**Un movimiento se firma una vez**, por UNIQUE sobre `movimiento_id`. Dos actas
sobre la misma entrega son dos papeles con distinto número, y el día que
discrepen no hay forma de saber cuál vale.

Lo que la FK no puede imponer —que el movimiento sea del *tipo* que el acta dice
documentar, y que la persona del acta sea la del extremo correcto del
movimiento— está en el grupo H de `verificar-datos.sql`.

---

## D25. El consecutivo es una tabla, no una SEQUENCE

`actas_consecutivo(anio, valor)`, incrementada dentro de la transacción del acta:

```sql
INSERT INTO actas_consecutivo (anio, valor) VALUES ($1, 1)
ON CONFLICT (anio) DO UPDATE SET valor = actas_consecutivo.valor + 1
RETURNING valor;
```

**Por qué no `nextval()`.** Una secuencia es inmune a los duplicados, que es el
riesgo grave, pero no participa en la transacción: un acta que falle después de
pedir su número se lo lleva para siempre. Un hueco en la numeración de un
documento firmable es una pregunta que alguien tendrá que responder —«¿dónde
está el acta 47?»— y «se perdió en un rollback» no es una respuesta que valga
delante de nadie.

Con la tabla, el `UPDATE` toma el bloqueo de fila hasta el COMMIT: los
concurrentes se serializan y reciben números seguidos, y un rollback devuelve el
número al contador. Ni repetidos ni huecos.

**El precio** es que emitir actas se serializa. Con tres personas en la
aplicación no se nota, y la alternativa es un número repetido en un documento
que se firma.

**El UNIQUE de `actas.consecutivo` sigue siendo la última red.** Si esta lógica
se rompiera, el INSERT falla en vez de emitir dos actas con el mismo número — y
eso no es teoría: al comprobar que el test muerde, la versión ingenua
(`max(...)+1`) hizo fallar 11 de 12 peticiones simultáneas con
`Ya existe un acta con el consecutivo "ACT-2026-0001"`. La red hizo su trabajo.

**Cómo está probado**, que era la pregunta: doce peticiones HTTP simultáneas por
doce conexiones distintas del pool, no un razonamiento sobre el bloqueo. Se
comprueban las tres cosas —doce números distintos, seguidos y sin huecos, y el
contador donde debe quedar— y además que un acta fallida no adelanta el
contador. El test se validó sustituyendo la implementación por un `max(...)+1`
y viendo que se pone rojo.

---

## D26. El PDF es reproducible, y por eso guarda de qué plantilla salió

Un PDF lleva por defecto la fecha de generación y el nombre del programa que lo
hizo, así que el mismo documento generado dos veces produce dos ficheros
distintos. Con eso, un hash no dice nada útil: no se puede volver a calcular.

Se fijan las cuatro cosas que varían: `CreationDate` y `ModDate` toman **la
fecha del acta**, no `now()`, y `Producer`/`Creator` son constantes. Fuentes,
solo las estándar de PDF (Helvetica), que no se incrustan y por tanto no meten
bytes que dependan de la versión de una fuente del sistema.

Comprobado **antes** de construir nada encima, no después: dos generaciones
separadas 1,1 s dan el mismo sha256; cambiar el contenido o la fecha lo cambia.

**La plantilla se guarda con el acta** (`actas.plantilla_version`, 0010). El
hash contra los bytes guardados responde «¿está intacto el fichero?». La
pregunta que D16 quería poder responder es otra: «¿el documento guardado es el
que estos datos producen?», y esa exige regenerarlo — lo que solo tiene sentido
frente a la redacción que lo produjo. En cuanto se corrija una cláusula, las
actas nuevas cambian de bytes y las viejas no; sin la columna no habría forma de
saber cuál de las dos redacciones regenera cada una.

Es el argumento de la instantánea (D23) aplicado al documento en vez de a los
datos: lo que se firmó no cambia porque cambie lo que se firmaría hoy.
`GET /api/actas/:id/verificar` devuelve las dos respuestas y dice si la
plantilla guardada es la de hoy.

### El texto no está aprobado, y el documento lo dice

`PLANTILLA_VERSION = '1-borrador'`. Mientras diga «borrador», el PDF imprime en
el pie que su texto no lo ha revisado el área legal. Quien decide qué debe decir
un acta de entrega en esta organización no es quien la programa. Cuando esté
revisada se cambia la constante: el aviso desaparece del pie y de la pantalla a
la vez, y las actas ya emitidas conservan su `plantilla_version` — que es
precisamente para lo que existe la columna.

Hay dos actas de ejemplo con datos inventados en `data/origen/`, para poder
enseñar la redacción sin datos de nadie.

### Un defecto que solo se vio abriéndolo

La primera versión producía **tres páginas** para un acta de un solo equipo,
con las firmas huérfanas en la primera. El pie se escribía por debajo del margen
inferior y pdfkit añadía una página; el segundo `text()` añadía otra.

El generador no fallaba: devolvía un PDF válido, con su hash, y todos los tests
en verde. Ninguna comprobación sobre bytes lo habría encontrado. Es la lección
de la etapa 4a otra vez —los caminos se prueban ejecutándolos sobre el sistema
completo— aplicada a un artefacto que hay que mirar. De ahí que el test cuente
las páginas: 1 equipo → 1 página, 8 → 2.

---

## D27. El acta ejecuta la operación, y el asistente de entrega no es lo mismo

`POST /api/actas` tiene dos modos, y el de por defecto es `firmar`.

  - **`firmar`** — documenta movimientos que ya existen. Es lo de la 5a.
  - **`ejecutar`** — crea los movimientos y los firma, en una sola transacción.

**No se invierte la dirección.** El acta sigue colgando de un movimiento que
existe antes que ella; lo que cambia es que ahora puede crearlo en el mismo
instante. De eso dependen el grupo F2, la FK compuesta de `actas_equipos` y el
grupo H, y ninguno se toca. Lo que desaparece es el doble paso para quien
entrega: asignar y luego emitir eran dos pantallas para un solo hecho.

`ejecutar` **reutiliza `mutar()`**, no copia nada: las mismas reglas, la misma
tabla de transiciones, la misma auditoría, el mismo `FOR UPDATE`. Su transacción
anidada es un savepoint, así que si el tercer equipo de un acta de cuatro no se
deja mover, la excepción sube y el acta entera se deshace. No hay actas a medias
ni equipos movidos sin papel.

**`firmar` es el modo implícito a propósito**: un modo que muta datos no puede
serlo. Una petición sin `modo` se comporta como antes de la 5c.

### Dos validaciones que el modo `ejecutar` necesitaba

**Devolver exige que el equipo esté a nombre de esa persona.** Sin ello,
`mutar('devolver')` escribiría el movimiento con el titular real mientras el
acta dice otro nombre, y el grupo H se pondría rojo días después, lejos de su
causa. El 409 dice qué equipo y a nombre de quién figura.

**El 409 de transición ilegal dice cuál de los equipos.** `TransicionIlegal`
sabe de operación y de estado, pero no de equipo; sobre un acta de cuatro, un
«no se puede asignar» a secas obliga a adivinar. Se envuelve con la etiqueta y
se le añade el `puedes` del catálogo, igual que en las mutaciones.

### El acta NO abre el traslado, y el asistente sí

Aquí los dos caminos **divergen a propósito**, y queda escrito para que dentro
de un año no parezca un descuido:

  - `OnboardingModal` asigna **y** abre el traslado si el equipo está en otra
    sede. Es un flujo operativo: describe lo que va a pasar.
  - El acta en modo `ejecutar` solo asigna. Es un documento: dice lo que **ya**
    pasó, y firmar la recepción de un equipo que todavía viaja mete en un papel
    un hecho que no ha ocurrido.

Cuando los elegidos están en otra sede que la persona, la pantalla lo avisa y no
bloquea: puede haber ido a recogerlos, y eso el sistema no lo sabe.

### El filtro de la pantalla son cuatro casos, no dos

|  | Entrega | Devolución |
|---|---|---|
| **ejecutar** | Disponible o Reservado | los que tiene hoy |
| **firmar** | los que ya tiene y cuya entrega no se firmó | los que devolvió y cuya devolución no se firmó |

La celda que lo demuestra es `firmar + Entrega`: documentar una entrega que ya
ocurrió necesita los equipos que la persona **ya tiene**, no los disponibles.
Filtrar siempre por disponibles dejaría tres de los cuatro casos vacíos.

Las dos celdas de `firmar` las calcula el servidor
(`GET /api/actas/firmables`): saber qué movimientos siguen sin acta no está en
ninguna lista que el navegador tenga. Y devuelve **solo el movimiento más
reciente de cada equipo**, que es el mismo que elegiría al emitir: ofrecer uno
más antiguo porque aquel no tiene acta llevaría a un 409 inexplicable.

**En pantalla los modos no se llaman así.** Se llaman «entregar ahora» y
«registrar una entrega ya hecha». Quien entrega un portátil no tiene por qué
saber qué es firmar contra un movimiento.

---

## D28. `empresa` en empleados, y por qué el conteo tiene que verse

Columna nueva con enum `RIWI` / `BBL Labs` / `Sin clasificar`, y los 113
cargados del Excel quedan en la tercera.

**`Sin clasificar` no es un hueco de datos: es una tarea pendiente.** Nadie ha
dicho todavía de quién es cada persona, y poner `RIWI` por defecto sería
inventarlo para 113 filas de golpe — la regla 3 del proyecto.

Lo que evita que se queden así para siempre no es la columna, es que **el conteo
se vea**, como la bandeja de revisión de equipos. Un valor más en un desplegable
no lo mira nadie: es el mismo mecanismo que dejó 37 equipos en «licencia OK»
hasta que la bandeja los puso delante. Por eso `GET /api/empleados` devuelve
`conteos_empresa` junto al listado, con las tres claves siempre —incluida
`Sin clasificar` en cero si algún día no queda ninguna—, y la vista lo pinta
arriba con un filtro de un clic.

Que la clave no desaparezca al llegar a cero importa: `GROUP BY` no devuelve
grupos vacíos, y sin rellenarla la interfaz no podría distinguir «ninguna» de
«no se pudo contar».

---

## D29. Mantenimiento: dos operaciones más, y cerrar es un solo gesto

`Envío a mantenimiento` y `Retorno de mantenimiento` son la **séptima y octava
operación**, con su movimiento, y las dispara el flujo de partes.

La alternativa —que el parte cambiara `equipos.estado` por su cuenta— reabriría
exactamente la puerta que D19 cerró: un equipo cambiando de estado sin dejar
movimiento. Cerrar el `PATCH` de equipos costó una decisión entera; dejar entrar
lo mismo por la puerta del taller sería deshacerla.

**Con esto `ESTADOS_SIN_OPERACION` queda vacío**, y ese es el criterio de que el
modelo está completo: cada estado del enum tiene entrada y salida. Hubo dos
huecos, `Reservado` (D17) y `En mantenimiento`, y los dos se descubrieron tarde.
La constante se queda aunque esté vacía, con un caso que la comprueba: es lo que
hará visible el tercero.

`Asignado` queda fuera de `enviar_mantenimiento`, igual que en `baja` y por el
mismo argumento: un equipo que se va al taller no está en las manos de la
persona a la que figura asignado.

### Cerrar el parte devuelve el equipo — un gesto, no dos

Era la pregunta abierta, y la respuesta estaba en el enum desde la 0000:
**`Completado` y `Devuelto` ya eran estados distintos**. El taller termina antes
de que el equipo vuelva al armario, y ese paso intermedio ya tiene su propio
estado. No hace falta un segundo botón: hace falta que el que existe no deje el
equipo a medias.

Así que cerrar cierra el parte **y** saca el equipo del taller, en la misma
transacción. Un equipo que vuelve y se queda en `En mantenimiento` porque
alguien cerró el parte sin devolverlo es un equipo perdido con pasos extra: el
inventario diría que está en el taller, el taller diría que lo entregó, y nadie
sabría cuál de los dos mira mal.

**Dos desenlaces, y `desenlace` es obligatorio sin valor por defecto.** La
pregunta «¿volvió, o no tenía arreglo?» solo la puede contestar quien lo tiene
delante:

  - `retorno` → `Retorno de mantenimiento`, el equipo queda `Disponible`.
  - `baja` → `Baja`, el equipo queda `De baja`, y el parte cierra como
    `Baja tras revisión` (valor nuevo del enum, 0011).

El segundo existe porque sin él, dar de baja un equipo irreparable obligaría a
cerrarlo como devuelto —dejando un portátil muerto en `Disponible`— y darlo de
baja después. El inventario se puede leer en ese minuto.

`PATCH /api/mantenimientos/:id` **rechaza `estado: 'Devuelto'` con 409** y dice
por dónde va: cerrar mueve el equipo, y no puede entrar por una ruta cuyo nombre
no lo diga.

Y un parte cerrado no se reabre. Si el equipo vuelve al taller, se abre otro:
`idx_mantenimientos_abierto` garantiza que solo haya uno abierto por equipo, la
misma forma que el traslado abierto (D13).

---

### El catálogo prometía un botón que no existía

Descubierto al conectar las pantallas, no al escribir el servidor. Va aquí y no
como decisión propia porque es la misma de D29 terminada: las dos operaciones
las dispara el flujo de partes, y eso hasta ahora estaba escrito en prosa.

`AccionesEquipo` no lee prosa. Pinta un botón por cada operación de
`catalogo.por_estado[estado]`, y `por_estado` sale de `TRANSICIONES`. Así que
todo equipo `Disponible` mostraba **«Enviar a mantenimiento», y pulsarlo daba
404**: la ruta no existía, porque el bucle de `registrarRutasMovimientos`
llevaba las seis escritas a mano.

Tres cosas que debían coincidir estaban en tres sitios:

| Hecho | Dónde vivía |
|---|---|
| la operación existe y es legal desde X | `TRANSICIONES` |
| la operación tiene endpoint | lista literal en `registrarRutasMovimientos` |
| la operación se pinta como botón | «todo lo de `por_estado`», en el cliente |

`disparo: 'directa' | 'parte'` las vuelve una sola. El bucle de rutas recorre
`OPERACIONES_DIRECTAS`, derivada del campo; el catálogo lo expone; y
`AccionesEquipo` parte `por_estado` en las que pinta como botón y las que
anuncia con una frase que dice dónde se hacen. **Las de `parte` se siguen
enseñando**: callarlas dejaría `En mantenimiento` sin explicación visible desde
el equipo, que es el hueco contrario y no mejor.

El caso que lo habría cazado está en `movimientos.test.ts`: recorre el catálogo
y comprueba que cada `directa` responde algo distinto de 404 y que cada `parte`
responde 404. Se comprobó por los dos lados desincronizando a mano el catálogo
de las rutas, y sale en rojo con el nombre de la operación en el mensaje.

### El tipo `Operacion` del frontend era una copia, y se separó en silencio

`src/types.ts` tenía las seis escritas a mano. La 5d añadió dos a la tabla y esa
copia no se enteró: `tsc --noEmit` siguió en verde mientras el servidor devolvía
ocho y el cliente creía en seis. Ahora se re-exporta de `db/transiciones.ts`.

Lo llamativo es que el aviso ya estaba puesto, en el propio fichero que falló:
el comentario de `Transicion.etiqueta` explica que una lista de operaciones en
el frontend «sería una segunda tabla de transiciones que se desincroniza en
silencio». Lo decía de las etiquetas. Ocurrió en el tipo.

**Lo que falló no fue el criterio, fue el alcance.** `src/types.ts` declara en su
cabecera que se deriva del esquema y no se escribe a mano; `Operacion` era la
única excepción y nadie la contó como tal.

### Y un 409 que no se alcanzaba

`PATCH /api/mantenimientos/:id` con `estado: 'Devuelto'` debía dar 409 diciendo
que cerrar va por su ruta. Daba **400**: la validación de zod corría antes, y
`esquemaActualizar` solo admite los tres estados abiertos, así que el 409 moría
sin ejecutarse. Otra vez código correcto e inalcanzable. La comprobación va
ahora antes de validar, y cubre los **dos** estados de cierre —`Baja tras
revisión` tenía el mismo problema y no estaba probado.

---

## D30. La dirección de la sede Remoto se avisa, no se exige

Un colaborador en sede Remoto necesita dirección: no hay oficina a la que
mandarle el equipo. Pero **no va como CHECK**.

Hay empleados ya cargados del Excel sin dirección, y una constraint los dejaría
sin poder editarse ni siquiera para corregir otra cosa —el `UPDATE` fallaría por
un campo que quien edita quizá no conoce—. Peor: convertiría un dato que falta
en un bloqueo para arreglar el resto de la ficha.

El aviso va en el formulario y en la ficha, que es donde alguien puede hacer
algo al respecto. Es la misma forma que el aviso de «equipo en otra sede» al
emitir un acta (D27): decir lo que falta sin impedir el trabajo.
