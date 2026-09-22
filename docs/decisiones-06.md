# Decisiones de la etapa 5f — el formato del acta aprobado por BBL

Gana sobre `decisiones-05.md` y sobre todo lo anterior.

**La numeración empieza en D36**, no en D35: `decisiones-05.md` cerró con D35
(«Reasignar es compuesta»). Comprobado antes de crear este fichero.

Esta etapa va en tres tramos, y este documento cubre el primero:

| Tramo | Contenido | Estado |
|---|---|---|
| **5f-1** | El documento: constantes, logos, ocho secciones, texto de devolución | **cerrado** |
| **5f-2** | Consecutivo por empresa, lista de chequeo, aviso de cédula | **cerrado** |
| 5f-3 | Buscador en «Equipos a entregar» | pendiente |

El corte está donde está porque el tramo 1 es el que necesita ojos: lo que salió
mal la última vez —el acta de tres páginas con las firmas huérfanas— tenía el
hash correcto y todas las comprobaciones sobre bytes en verde.

---

## Lo que la exploración corrigió antes de escribir nada

| El encargo decía | El archivo dice |
|---|---|
| `entrega_valeria.pdf` | `formato-acta.pdf` |
| `Logo_con_marca_registrada-04.png` | `Logo-con-marca-registrada-04.png`, con guiones |
| El logo de BBL es «casi cuadrado» | Es 1.80:1 — exactamente la mitad de apaisado que el de RIWI (3.61:1) |
| La sección 2 es constante del formato | Su contenido describe la entrega de Valeria, no el formato (ver D36) |

Y una cosa que el propio formato aprobado confirma: **el número de documento
está en blanco en la muestra**. No hay que bloquear la emisión por él.

### Cómo se extrajo el logo de BBL, y el error que casi lo da por bueno

No hay archivo suelto: el logo solo existe incrustado en el PDF de referencia,
como una imagen plana con máscara alfa de **176 × 98 px**. La primera
extracción salió cizallada, con el texto envuelto sobre sí mismo
(`IRDLABS BLACKB`), y era plausible: parecía un logo mal recortado.

La causa era del lector, no del archivo. **En PDF los datos de imagen son
muestras crudas: no llevan el byte de filtro por fila que sí lleva PNG.**
Suponerlo desplaza una columna por fila y produce una imagen válida y
equivocada — el mismo modo de fallo que el acta de tres páginas.

Con el stride correcto el logo sale entero. La referencia lo coloca a
63,4 × 35,3 pt, así que 176 px dan **200 dpi**: suficiente para una marca plana
de dos colores. Anotado en `pendientes.md` por si algún día aparece el
vectorial.

---

## D36. El formato aprobado sustituye a la plantilla, y la sección 2 habla del formato

Las ocho secciones del PDF de referencia, con las tablas y bordes que tiene.
Las secciones 1 y 2 son metadatos del **formato**, no del acta: valen lo mismo
en todas las actas de una misma `plantilla_version`, así que van en
`db/acta-formato.ts` y no en la base. Guardarlas por acta sería repetir el mismo
dato trescientas veces y abrir la puerta a que dos actas de la misma versión
digan cosas distintas.

### La sección 2 no podía congelarse tal cual

La muestra trae aquí «Entrega de quipo» y «Ingreso a la compañía». Eso describe
**la entrega concreta de Valeria Taborda**, no una revisión del formato.
Congelado como constante, un acta de devolución diría que esa persona ingresa a
la compañía, y una reasignación lo mismo.

Como la sección es del formato, se llena con contenido de formato:

```
Versión 1 · Autor: Sebastián Espitia · Fecha: 26 de marzo de 2026
Descripción: «Versión inicial del formato»
Motivo:      «Adopción del formato en el sistema de inventario»
Aprobado por: Eduardo Rebage
```

**Y el «quipo» de la muestra es una errata, corregida.** Se anota aquí para que
quien compare nuestro documento contra el de BBL no lo lea como un error
nuestro: es un campo que reescribimos igualmente, y una errata en un documento
legal que va a salir cientos de veces no merece conservarse por fidelidad.

### `plantilla_version` pasa a ser por tipo de acta

```
Entrega     → '1'            aprobado, sin aviso
Devolución  → '1-borrador'   con el aviso en rojo
```

---

## D37. El texto de devolución se adapta, y sigue en borrador

No existe formato de devolución. Las cláusulas 7.1–7.9 están escritas para
quien **recibe** y asume custodia: copiadas tal cual dirían que la persona sigue
obligada a custodiar equipos que acaba de entregar, y la sección 6 certificaría
una entrega cuando lo que ocurre es una recepción.

El criterio ha sido **no inventar cláusulas nuevas**: cada una de las cuatro que
quedan sale de una de las nueve, y las cinco que faltan se han dejado fuera
porque hablan de una custodia que acaba de terminar. El detalle está en
`pendientes.md`, que es lo que BBL tiene que revisar.

El documento de devolución tiene **siete secciones y no ocho**: la lista de
chequeo (5) no aplica, y las demás se renumeran. Si un chequeo de devolución
—borrado de datos, recuperación de BitLocker, cierre de cuenta— tiene sentido,
es una decisión de BBL y va en 5f-2.

Dos cosas más que se adaptaron y no estaban en el encargo, porque se ven al
abrir el PDF:

- **El orden de las firmas se invierte.** En una devolución quien entrega es el
  usuario; dejar «Persona que recibe» primero lo pondría a firmar como receptor
  de lo que acaba de devolver.
- **La columna «Accesorios entregados» pasa a «Accesorios devueltos».**

---

## D38. La empresa entra en la instantánea del acta

Migración `0014`. No estaba en el encargo y es obligatoria.

El formato imprime la empresa en dos sitios distintos: el **logo** del
encabezado (de quién es el acta) y la columna **«Propietario»** de la sección 4
(de quién es cada equipo, fila a fila). No son el mismo dato — un acta de RIWI
puede entregar un portátil de BBL que RIWI tiene prestado, y el ejemplo
`ejemplo-entrega-riwi.pdf` lo enseña.

Las dos entran en los bytes del PDF, así que entran en el hash. Y
`recalcularHash` regenera el acta **desde su instantánea** para comprobar que el
PDF guardado no se ha tocado:

> Sin la empresa guardada, la regeneración usaría otro logo o dejaría la columna
> vacía, los bytes saldrían distintos y la comprobación diría **que el documento
> no cuadra**.

Es el peor modo de fallo posible para esa función: no revienta, **acusa**.
Alguien miraría un acta legítima y concluiría que la habían manipulado. La
instantánea de la 5a (D14, D23) se congeló sin estas columnas porque el formato
de entonces no imprimía la empresa; ahora la imprime.

`actas` estaba vacía tras la reimportación de la 5e —0 actas, 0 líneas, 0
contadores, comprobado antes de escribir la migración—, así que el DEFAULT no
rellenó nada real.

---

## D39. Logo por empresa, y por qué eso ata la versión

Dos archivos, en **ruta fija del repo**: `assets/logos/logo-riwi.png` y
`assets/logos/logo-bbl.png`. Fuera de `data/origen`, que está gitignorado.

### Se escala por altura, con el ancho libre

Los dos logos tienen proporciones muy distintas —RIWI 3.61:1, BBL 1.80:1— así
que una caja de ancho y alto fijos aplastaría al de RIWI. Se le da el alto
(34 pt) y el ancho sale del ratio. **Comprobado abriendo las actas, no
calculándolo.**

Los dos tienen canal alfa: en el PDF generado la transparencia se resuelve
sobre blanco y no queda recuadro gris. También comprobado mirando.

### Los bytes del logo entran en el hash

De ahí dos reglas, escritas junto a la constante donde las vea quien las toque:

1. **El logo se lee de una ruta fija del repo, nunca de una subida por
   interfaz.** Un fichero que cualquiera puede cambiar sin dejar rastro no
   puede ser parte de un hash que se usa como prueba.
2. **Cambiar un logo obliga a subir `plantilla_version`.** Si no, todas las
   actas nuevas salen con un hash distinto por un cambio que nadie registró, y
   comparar una de mañana contra una de hoy deja de significar nada.

La regla se comprobó por sus dos lados, y el tercer caso es el que la justifica:

```
mismo acta, 1,2 s después      OK   (mismo hash)
otra empresa (logo + texto)    OK   (distinto)
solo el fichero del logo       OK   (distinto: se sustituyó el PNG sin tocar un dato)
logo restaurado, hash vuelve   OK   (vuelve al hash original)
```

El tercero no se pudo hacer corrompiendo un byte del PNG: eso rompe el zlib y
pdfkit revienta antes de generar nada. Tiene que ser **otro PNG válido**.

Y el cuarto existe porque sin él el tercero podría estar pasando por suciedad
acumulada y no porque el logo cuente.

---

## D40. Una serie de consecutivos por empresa, y sin año

Migración `0015`. `actas_consecutivo` deja de estar clavada en el año y pasa a
estarlo en la empresa.

```
antes   ACT-2026-0001     una serie, reiniciada cada enero
ahora   BBL-0000          una serie por empresa, sin año
        RIWI-0000
        SC-0000
```

El prefijo hace imposible confundir dos actas de series distintas en un correo:
con una serie por empresa, `0007` a secas es ambiguo y `BBL-0007` no lo es.

### La clave tiene que ser lo que distingue una serie de otra

Como el número **ya no lleva el año**, dejar el contador clavado en `anio`
habría reiniciado la serie cada 1 de enero, y el acta número uno del segundo
año habría chocado contra el UNIQUE de `actas.consecutivo`. No es una mejora de
diseño: es que la clave vieja produce un choque el 1 de enero de 2027.

De regalo, y esto sí es un efecto secundario bueno: dos actas simultáneas de
empresas distintas bloquean filas distintas y dejan de esperarse entre sí.

### El contador arranca en 0, y eso rompió una CHECK que ya existía

`actas_consecutivo` tenía `CHECK (valor > 0)` desde la 5a. Con la primera acta
de cada serie numerada `0000`, esa constraint habría matado **el primer POST de
cada empresa** — un fallo que solo aparece una vez por serie y nunca más, o sea
el que nadie reproduce después. Pasa a `valor >= 0`.

Lo mismo obligó a reescribir dos casos del verificador de datos, que daban por
buena la numeración comparando contra el 1 y contra el conteo de actas: con la
serie empezando en cero, `valor` es el **último número dado** y no cuántas van.
Escritos como estaban habrían marcado en rojo todas las series correctas.

### `Sin clasificar` tuvo una serie, `SC`, y se retiró

**Sustituido por D42.** Lo puse yo con el argumento de que un empleado sin
empresa puede recibir un equipo y que bloquear la emisión sería inventar un
requisito. Johan lo vetó, y el argumento estaba al revés: `SC-0000` en la
cabecera de un documento legal no le dice nada a quien lo recibe y lo firma. Ver
D42.

### Cómo se comprobó

Doce POST simultáneos **por empresa**, lanzados intercalados para que las dos
series compitan de verdad. Con una empresa cada vez, un contador global pasaría
el test igual de bien.

Y falsificado por sus dos lados, que es lo que hace que el verde signifique
algo:

| Mecanismo sustituido | Qué pasó |
|---|---|
| `max(valor)+1` sin bloqueo | `RIWI-0016` duplicado → 409 contra el UNIQUE |
| Contador **global** con el prefijo pintado encima | «la serie tiene huecos o saltos» |

El segundo es el que prueba D40 y no solo la concurrencia: es correcto bajo
carga y aun así no es lo que se pidió.

### Dos tests míos que pasaban por accidente

Los dos aparecieron al correr la batería **por segunda vez** sobre la misma
base, y los dos son la misma trampa: escritos contra una base recién creada.

1. «Las dos series recorren los mismos números» solo se cumple si las dos parten
   del mismo sitio. La base de tests es compartida y acumula. Se sustituyó por
   la propiedad de verdad: **cada contador avanza exactamente doce desde su
   propia base**, que es lo que un contador compartido no puede fingir.
2. «La primera acta es la `0000`» se comprobaba buscando `RIWI-0000` en la
   tabla. Los contadores sobreviven a la limpieza de las suites —son monótonos
   a propósito— y las actas no, así que a partir de la segunda corrida no hay
   ninguna `0000` que encontrar. Ahora se prueba sobre una **serie virgen**: se
   borra el contador dentro de una transacción, se piden los dos primeros
   números y se deshace todo. El helper comprueba además que el ROLLBACK
   ocurrió, porque si no ocurriera reiniciaría la numeración del resto de
   suites.

---

## D41. La lista de chequeo, preguntada al emitir y dentro del hash

Migración `0015`. Columna `actas.chequeo` JSONB.

Cuatro items fijos —`Office 365 / Teams / Firma`, `BitLocker`, `Edge – Chrome`,
`Otros`— cada uno con instalado sí/no y observaciones. **Solo en las entregas.**

### Ninguno tiene valor por defecto, y eso llega hasta la validación

`instalado` es `boolean | null`, y el `null` significa «nadie contestó», que se
imprime como casilla en blanco y **no** es «no». En el formulario no hay nada
premarcado, y en el zod de la ruta `instalado` es `.nullable()` y no
`.optional()`: quien emite tiene que decir `true`, `false` o `null` para cada
item que mande. Dejarlo omitible con algo supuesto detrás sería reintroducir el
valor por defecto por la puerta de atrás.

El formulario se vacía al terminar cada acta. Heredar las respuestas de la
anterior sería el mismo defecto, con la agravante de venir de otra persona y
otro equipo.

### Entra en el PDF, así que entra en el hash

Es lo que avisó Johan al final del tramo, y tenía razón: `recalcularHash`
regenera el acta desde su instantánea, y **pasaba `chequeo: null`**. Sin la
columna, la regeneración habría pintado la sección 5 vacía, los bytes no habrían
coincidido y la comprobación habría dicho que el documento no cuadra.

Es el mismo modo de fallo que la empresa en la 0014, y el peor que puede tener
esa función: no revienta, **acusa**. Falsificado devolviendo el `chequeo: null`
a su sitio:

```
el acta legítima salió acusada: guardado 351d308f… vs recalculado ab58853d…
```

El caso contrario también está, y es el que impide que el primero sea trivial:
un `recalcularHash` que ignorase la sección 5 se verificaría consigo mismo
perfectamente. Se altera **solo** la columna `chequeo` en la base —no se emite
una segunda acta, que diferiría también en consecutivo y en equipo— y se
comprueba que el veredicto cambia, y que vuelve al restaurarla.

### La CHECK cubre las cuatro columnas, pero no con la misma regla

```sql
(pdf IS NULL) = (hash_sha256 IS NULL)
AND (pdf IS NULL) = (plantilla_version IS NULL)
AND (chequeo IS NOT NULL) = (pdf IS NOT NULL AND tipo = 'Entrega')
```

El chequeo no puede ir en el mismo «todas o ninguna»: la sección 5 solo existe
en las entregas, así que una devolución con PDF tiene que poder tenerlo a NULL.
La equivalencia con dos condiciones corta los tres errores a la vez — acta sin
documento con chequeo guardado, entrega con documento y sin él, y devolución que
se inventa una sección que su formato no tiene. Los tres están en
`verificar-esquema.sql`, con su lado positivo.

Al ponerla se rompió un caso que ya existía —«D15+D26: los tres juntos»— y el
verificador **salió con código 3**. Es la segunda vez que ese caso se rompe al
ampliar la instantánea (la 0010 le añadió `plantilla_version`), y es su función:
si mañana entra una quinta columna en los bytes del PDF, tiene que volver a
ponerse rojo.

### Los items no se copian al cliente

`src/types.ts` re-exporta `CHEQUEO_ITEMS` de `db/acta-formato.ts`, igual que
hace con `Operacion`. Una segunda lista escrita a mano se desincroniza en
silencio con `tsc` en verde — ya pasó con `Operacion` en la 5d— y aquí lo que
quedaría mal es un documento legal.

### La devolución sigue sin chequeo propio

Se deja fuera y anotado. Si un chequeo de devolución —borrado de datos,
recuperación de BitLocker, cierre de cuenta— tiene sentido, es una decisión de
BBL y no de quien programa.

---

## D42. Sin empresa no hay acta

Retira el prefijo `SC` que había puesto en D40 y lo sustituye por un bloqueo.

`Sin clasificar` **no es una empresa**: es la marca de que nadie ha dicho de
quién es esta persona. Un acta es un documento entre dos partes y una de ellas no
puede ser «se desconoce» — y el argumento con el que le di serie propia («sería
inventar un requisito que BBL no puso») miraba al sistema en vez de al papel.
Quien recibe un `SC-0000` y lo firma no sabe ante quién se está obligando.

### La regla la sostiene el tipo, no un `if`

```ts
export type EmpresaQueEmite = Exclude<EmpresaActa, 'Sin clasificar'>;
export const PREFIJO_CONSECUTIVO: Record<EmpresaQueEmite, string> = { … };
```

Con `Record<EmpresaActa, string>` y una comprobación suelta, cualquiera podía
numerar un acta sin empresa sin enterarse. Ahora **no compila**: al estrechar la
clave, el único camino hasta `siguienteConsecutivo` pasa por la guarda
`puedeEmitir`, que además estrecha el tipo en el sitio donde se usa. Es la misma
lección del catálogo de transiciones: si una distinción importa, tiene que ser un
campo del que salga el comportamiento, no una nota al lado.

Al aplicarlo, lo único que rompió en todo el proyecto fue **el helper de tests**
que pedía números para las tres empresas. Eso es la señal de que la regla está en
el sitio correcto.

### La guarda va antes de mover nada

En modo `ejecutar` el acta hace la operación. Una comprobación puesta junto al
consecutivo —donde nace el problema— habría dejado equipos movidos dentro de una
transacción que después revienta. Va justo después de cargar la persona, cuando
todavía no hay nada que deshacer, y el test lo comprueba **sobre la base**: el
equipo sigue `Disponible` y ningún contador se movió.

### 409, y con el nombre de la salida

```
409  <Nombre> no tiene empresa asignada, y el acta necesita saber de quién es:
     el logo del encabezado y el número de documento salen de ahí.
     Asígnale RIWI o BBL Labs en su ficha y vuelve a emitirla.
     { empleado_id, falta: 'empresa' }
```

409 y no 400: la petición está bien formada y lo que falla es el estado de la
ficha, que era correcto ayer y lo será cuando alguien la complete. Va con
`empleado_id` para que la pantalla abra **esa** ficha sin que quien emite la
busque a mano.

### En pantalla bloquea, y ahí está la diferencia con la cédula

| | Cédula ausente | Empresa ausente |
|---|---|---|
| El documento | sale con el hueco en blanco, como la muestra | no se puede ni empezar: no se sabe su logo ni su serie |
| El formulario | avisa y **deja emitir** | avisa y **deshabilita el botón** |
| Cómo se arregla | abriendo la ficha completa | un desplegable de dos opciones |

Dejar el botón activo sabiendo que la API responde 409 sería mentir en pantalla.
El desplegable **no trae nada preseleccionado**: elegir por alguien de quién es
un equipo es exactamente lo que no debe hacer el programa.

### Lo que queda vigilándolo

- `verificar-datos.sql`: el formato de consecutivo admite **dos** prefijos y no
  tres; más dos casos nuevos —actas con empresa `Sin clasificar` y contadores de
  esa serie—. El segundo se comprobó inyectando una fila y viendo salir el 3: sin
  eso su cero era **de vacío**, porque `actas_consecutivo` está vacía en
  desarrollo.
- `verificar-esquema.sql`: un caso que confirma que **la base sí admite** el
  valor que el código veta. La columna es el enum entero a propósito —la guarda
  vive donde puede explicar qué hacer— y sin este caso el de `verificar-datos`
  sería un verde imposible de romper.
- La base de tests arrastraba un contador `Sin clasificar` en 294 de cuando la
  serie sí emitía. Se retiró tras comprobar que ninguna acta lo referenciaba.

### Lo que NO cambió

El `0000` se queda. Johan lo va a mirar con el número delante antes de la
primera acta real, y hasta entonces no se toca.

---

## El aviso de cédula, y por qué la ficha se abre dentro del acta

La sección 3 pide número de documento y `cedula` casi no viene en los Excel. El
acta **se emite igual** con el hueco en blanco, como en la muestra aprobada:
negarse por un dato que quizá nadie tenga a mano convertiría una molestia en un
tapón.

Pero el formulario avisa, y el enlace abre la ficha **en la misma pantalla** en
vez de llevar a Colaboradores. Irse a otra vista perdería los equipos ya
seleccionados, que es exactamente lo que hace que alguien acabe emitiendo cuatro
actas en vez de una. Al guardar se recarga la lista, porque la instantánea se
copia al emitir: con el estado local sin la cédula, el PDF saldría con el hueco
igual.

---

## Las cuatro actas de ejemplo, abiertas en un visor

`data/origen/ejemplo-*.pdf`, generadas por `npx tsx db/actas-ejemplo.ts` con
datos inventados. **Vistas una a una**, que es el criterio de cierre del tramo:

| Archivo | Qué demuestra | Páginas |
|---|---|---|
| `ejemplo-entrega-bbl.pdf` | El caso de la muestra. Chequeo con BitLocker en No | 2 |
| `ejemplo-entrega-riwi.pdf` | Logo apaisado, cédula presente, y un equipo de BBL en la columna «Propietario» | 2 |
| `ejemplo-devolucion-bbl.pdf` | Siete secciones, aviso de borrador en rojo | 2 |
| `ejemplo-devolucion-riwi-12.pdf` | Doce equipos: la tabla crece y las firmas NO quedan huérfanas | 2 |

Lo que se comprobó mirando y no se puede comprobar sobre bytes: que los dos
logos salen con su proporción, que la transparencia se resuelve sobre blanco,
que la sección 4 crece y se rellena hasta cinco filas, que el hueco del número
de documento se ve como hueco, que las casillas sin contestar del chequeo salen
vacías y no en «Sí», y que las tres firmas caben en la misma página que la
sección de responsabilidades.

### Cómo se abrieron

El visor de la extensión no acepta `file://`, así que los PDF se sirvieron por
`http://localhost` con un servidor de nueve líneas y se miraron en Chrome. Queda
escrito porque la próxima vez que haya que mirar un PDF generado, esto ahorra el
rodeo.
