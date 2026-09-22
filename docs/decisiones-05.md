# Decisiones de la etapa 5e — la base se reconstruye desde dos archivos

Gana sobre `decisiones-04.md`, que gana sobre `decisiones-01.md`, que gana sobre
`plan-migracion-v1.md`. Lo que este documento no toca, sigue vigente: **el reset
no anula las decisiones**, y en particular las reglas de fila concreta de D7 y
las de matching de D8 se aplican igual a los dos archivos nuevos.

El historial actual no se conserva. `db:reset` y reimportación limpia.

---

## Lo que la exploración desmintió antes de escribir nada

Cuatro cosas del encargo no aguantaban contra los datos, y están corregidas
abajo donde tocan. Se listan juntas aquí porque el patrón se repite: **las tres
son columnas que no se miraron**, no lecturas equivocadas de las que sí.

| Se creía | Los datos dicen |
|---|---|
| RIWI trae `'TIPO EQUIPO'` y BBL `'TIPO EQUIPO '` | Los **dos** traen el espacio final (cp 32) |
| `46H9494` es un préstamo inconsistente | BBL pone `PRESTAMO A RIWI` en `USUARIO RESPONSABLE` |
| `PRESTAMO BBL` está en la columna de licencia | Está en **siete** columnas de la misma fila |
| `1565` y `BAQ-0023` no dicen a quién se prestaron | Sí: Marlon García y Veronica Martinez |

La normalización de cabeceras se queda, pero no por la asimetría —que no
existe— sino porque hay una cabecera sucia y porque una consulta que pregunta
por una columna inexistente debe **fallar ruidosamente**, no devolver 98 nulos
plausibles.

---

## D31. Una fila por máquina física: `empresa` y `prestado_a`

Dos campos nuevos en `equipos`:

```
empresa     NOT NULL DEFAULT 'Sin clasificar'   -- de quién es
prestado_a  NULL                                -- quién lo tiene, si no es el dueño
```

La vista de una empresa muestra `empresa = X OR prestado_a = X`.

Con dos filas por máquina, el mismo serial existiría en dos estados
contradictorios y devolver un préstamo obligaría a editar dos registros. Es lo
que el índice único parcial existe para impedir.

### `prestado_a` lleva enum propio, no el de `empresa`

La 0011 creó `pgEnum('empresa', ['RIWI','BBL Labs','Sin clasificar'])` y lo usa
`empleados.empresa`. Añadirle `ISF` dejaría que un empleado fuera
`empresa = 'ISF'` y contaminaría el conteo de «Sin clasificar» que D28 puso a la
vista — el mecanismo entero de D28 depende de que esas tres claves sean las
tres claves.

Enum aparte, `prestatario`, con `RIWI`, `BBL Labs` e `ISF`. Consecuencia
técnica a no olvidar: la comprobación `prestado_a ≠ empresa` compara dos enums
distintos y Postgres exige el cast a `text` explícito.

`ISF` no es un estado ni una sede: es una empresa que recibe préstamos.

### El CHECK se relaja, porque si no perdemos ocho personas

`equipos_asignado_implica_empleado` es hoy una equivalencia, así que un equipo
`Prestado` no podría tener `empleado_id`. Y **ocho filas de RIWI traen el nombre
de quien tiene el portátil en la mano**:

```
 f4[ISF|Alex Rincon ISF]      f5[ISF|Luisa Jimenez ISF]
 f56[PRESTAMO|PRESTAMOS]      f63[PRESTAMO|Marlon García]
 f65[PRESTAMO|Veronica Martinez]  f66[PRESTAMO|Veronica Martinez]
 f71[PRESTAMO|Daniel Gil]     f72[PRESTAMO|Angelo Gaviria]
```

Siete son personas. Importarlas con el CHECK como está las tira en el import, y
con `db:reset` no hay de dónde recuperarlas. Perder a quien tiene el equipo es
peor que un invariante más estrecho:

```sql
CHECK ( (estado = 'Asignado') = (empleado_id IS NOT NULL) OR estado::text = 'Prestado' )
```

`Prestado` es el **único** estado donde `empleado_id` es libre. Sigue
rechazando `Disponible` con responsable y `Asignado` sin responsable, que son
los dos errores que el CHECK original cazaba.

`verificar-esquema.sql` lo comprueba **por los dos lados**, con filas
sintéticas: que `Disponible` con responsable y `Asignado` sin responsable
siguen rechazándose, y que `Prestado` con y sin responsable se aceptan.

### `empresa` en empleados sale del archivo de origen

Los responsables de cada archivo son empleados de esa empresa. Eso deja el
`Sin clasificar` de D28 casi vacío: solo para altas manuales futuras.

---

## D32. Estado `Prestado` y sus dos operaciones

Valor nuevo en `estado_equipo`. Siguiendo D19, todo estado necesita puerta de
entrada con movimiento, así que van dos operaciones nuevas — la **novena y la
décima**:

```
prestar             Disponible → Prestado    (mov. Préstamo)
recuperar_prestamo  Prestado   → Disponible  (mov. Retorno de préstamo)
```

`prestar` exige `prestado_a`. `recuperar_prestamo` lo pone a NULL. Las dos en
`db/transiciones.ts` con `disparo: 'directa'`, y por tanto con ruta y botón, que
desde la 5d es el mismo hecho escrito una vez (D29, «El catálogo prometía un
botón que no existía»).

`ESTADOS_SIN_OPERACION` debe seguir **vacío** después de añadir `Prestado`, y ya
hay un caso que lo comprueba y se pone rojo si aparece un hueco.

---

## D33. Los seis equipos que están en los dos archivos

Seis seriales aparecen en ambos. No son duplicados por error.

### Quién manda en qué: el dueño y el prestatario mandan en cosas distintas

«Gana la fila de BBL» no aguanta, y los propios datos lo demuestran: en
`DGYD774` y `53XQP74`, BBL pone `USUARIO RESPONSABLE = "Disponible"` —un
marcador, no una persona— mientras RIWI sabe quién lo tiene. La fila que
ganaría es la que **no** sabe lo que hace falta saber.

> **El fichero del DUEÑO manda en propiedad, specs y etiqueta.**
> **El fichero del PRESTATARIO manda en quién lo tiene hoy.**

Es coherente con cómo funciona un préstamo: quien presta no sabe a quién se lo
dieron dentro de la otra empresa.

| Serial | Etiquetas | Resolución |
|---|---|---|
| `DGYD774` | `BBL-0018` en ambos | De BBL, prestado a RIWI. Lo tiene **Daniel Gil** (de la fila de RIWI) |
| `53XQP74` | `BBL-0053` en ambos | Igual. Lo tiene **Angelo Gaviria** |
| `46H9494` | `BBL-0077` en ambos | De BBL, prestado a RIWI. Lo tiene **Carlos Castaño Rodriguez** |
| `F5X8494` | `23` / `BBL-0063` | De BBL, prestado a RIWI. **Dos personas distintas** → `RESPONSABLE_EN_CONFLICTO` con los dos nombres |
| `PF616WAN` | `323` / `BBL-0323` | Sin marca explícita de préstamo. **Marcar** `PROPIEDAD_AMBIGUA` |
| `PF61G1VF` | `324` / `BBL-0324` | Igual |

### `46H9494` no es inconsistente: la marca estaba en la columna de la persona

```
 RIWI f99: etq="BBL-0077" estado="Asignado" lic="PRESTAMO BBL" resp="Carlos Castaño Rodriguez"
 BBL  f100: etq="BBL-0077" estado="Asignado" lic="RETAIL"      resp="PRESTAMO A RIWI"
```

Los dos ficheros dicen lo mismo. `PRESTAMO_INCONSISTENTE` no se crea: no hay
ningún caso.

### `PROPIEDAD_AMBIGUA` dice lo que se sabe, no «no se sabe nada»

En los seis, el `NOMBRE EQUIPO` **dentro del fichero de RIWI** es `BBL-*`
(`BBL-0023`, `BBL-00323`, `BBL-00324`), y `23`/`323`/`324` son el número de BBL
sin prefijo. Eso es evidencia, aunque un hostname no sea un título de
propiedad. El texto de la marca es «hostname `BBL-*` sin marca explícita de
préstamo», no «no se sabe de quién es»: quien abra la bandeja tiene que
encontrarse con lo que ya se sabe.

### Códigos nuevos

`PROPIEDAD_AMBIGUA`, `RESPONSABLE_EN_CONFLICTO`, `PRESTATARIO_DESCONOCIDO`,
`LICENCIA_NO_ES_LICENCIA`, `MARCADOR_EN_CAMPO_TECNICO`, `COLUMNAS_DESPLAZADAS`,
`BLOQUE_DUPLICADO`, `NOMBRE_EN_DOS_EMPRESAS`.

`PRESTAMO_INCONSISTENTE` **no se crea** (ver arriba).

---

## D34. `PRESTAMO` significaba dos direcciones, y ocupaba siete columnas

### Las dos direcciones

- `BBL-0018`, `BBL-0053`, `BBL-0077` → licencia `PRESTAMO BBL`: equipo **de BBL
  prestado a RIWI**. Resuelto por D33. (`F5X8494` **no** está en este grupo: su
  licencia es `No aplica`.)
- `0798`, `1565`, `BAQ-0023` → licencia `OEM` normal: equipo **de RIWI prestado
  a alguien**. Pero solo uno de los tres es anónimo:

| Etiqueta | Responsable | Marca |
|---|---|---|
| `0798` | `PRESTAMOS` (marcador) | `PRESTATARIO_DESCONOCIDO` |
| `1565` | Marlon García | ninguna por esto — sesión `juliana.vargas` ≠ responsable, eso sí se marca |
| `BAQ-0023` | Veronica Martinez | ninguna por esto |

### `PRESTAMO BBL` está en siete columnas, no en una

```
 f71/f72/f99 -> SISTEMA OPERATIVO, SERIAL WINDOWS, TIPO DE LICENCIA,
                TAMAÑO, PROCESADOR, DISCO, RAM  = "PRESTAMO BBL"
```

El bloque técnico entero es un marcador. **Las siete a NULL + marcado**, no
solo la de licencia. Si el importador solo trata la columna de licencia,
escribe la cadena `"PRESTAMO BBL"` en `procesador`, `disco`, `ram` y `tamaño`
—y en `licencia_serial`, que va **cifrada**.

### Solo se cifra lo que tiene forma de clave

Es el hallazgo con más alcance de la exploración. Censo de `SERIAL WINDOWS`, la
columna que alimenta `licencia_serial`:

```
### BBL (126 filas)              ### RIWI (98 filas)
  39  clave 5x5                    62  clave 5x5
  37  OK                           24  N/A
  21  Licenciado                    5  Sin licencia
  11  N/A                           3  PRESTAMO BBL
  11  Sin licencia                  1  ...KKKX86  (último grupo de 6)
   3  (vacío)                       1  00355-6171-97087AA  (Product ID)
   2  Ya tenia licencia             1  SI
   1  D3ND-...  (primer grupo de 4) 1  (vacío)
   1  No aplica
```

**Solo 39 de 126 filas de BBL traen una clave de verdad.** Cifrar lo que venga
mete 87 secretos que no son secretos en una columna que por la regla 4 no
aparece en listados, logs ni exportaciones: comprobarlo obligaría a descifrar.
Es el peor sitio posible para esconder un marcador.

Regla: **forma de clave → se cifra. Cualquier otra cosa → NULL + motivo.**

Los dos malformados —grupo de 4, grupo de 6— van marcados **aparte**: son
claves con una errata, no marcadores, y tratarlos igual perdería un dato real.

Lo mismo en `BIOS PASSWORD`: 116 secretos de longitud 2, 1 de longitud 17, y
**7 marcadores** (`N/A` ×4, `No aplica` ×3) que no se cifran, más 2 vacíos.
Quedan 117 cifrados, suficientes para que la comprobación de arranque de la
clave siga funcionando. RIWI no tiene esa columna: sus 98 van con NULL.

---


### Lo que salió al escribir la migración

**Partir la migración en dos ficheros no sirve.** Postgres no deja usar un valor
de enum en la misma transacción en la que se añade, y el primer intento fue
0012 (tipos y columnas) + 0013 (las CHECK que nombran `'Prestado'`). Falla
igual: **el migrador de drizzle corre todas las pendientes en UNA transacción**,
así que en una base recién creada —que es exactamente lo que hace `db:reset` en
esta etapa— las dos caen dentro de la misma. Comprobado: dejó las 12 anteriores
aplicadas y ninguna de las nuevas.

Lo que sí vale es comparar como texto: `estado::text = 'Prestado'`. Entonces
'Prestado' es una cadena y no un valor de enum sin comprometer. El precio es que
Postgres ya no valida el literal —`'Prestadoo'` compilaría— y por eso los seis
casos del verificador prueban cada CHECK por sus dos lados: con la errata, el
caso «Prestado sin prestatario» pasaría a aceptar y saldría rojo.

**`prestado_a` no salía por la API.** `CAMPOS_PUBLICOS` en el repositorio de
equipos es una lista cerrada a propósito —para que los dos campos cifrados no se
escapen por un `select()` sin argumentos—, y eso tiene el precio simétrico: una
columna nueva no sale hasta que se añade a mano, y el síntoma no dice «falta en
la proyección», dice `undefined`. Lo cazó el test de `prestar`, que compara la
respuesta con lo que pidió en vez de darla por buena.

### Los casos que se pusieron rojos, y los que se escribieron

- `verificar-esquema.sql` gana **seis casos**: `Prestado` sin empleado y con
  empleado (los dos deben pasar), `Prestado` sin prestatario y prestatario sin
  `Prestado` (los dos deben rebotar), y prestarse a la propia empresa frente a
  prestarse a la otra. Los cuatro sentidos, porque una excepción mal escrita
  —un paréntesis de más en el `OR estado = 'Prestado'`— volvería la CHECK
  siempre cierta y los dos casos originales seguirían pasando por casualidad.
- `movimientos.test.ts` gana una suite de préstamos con las dos operaciones y
  sus rechazos: prestar sin decir a quién da 400 —no el mensaje de la CHECK, que
  no dice qué dato falta—, prestar algo asignado da 409, recuperar algo que no
  está prestado da 409, y recuperar borra `prestado_a` además de mover el
  estado.
- El caso de la 5d que compara catálogo y rutas **corre con las dos nuevas
  dentro** y sigue en verde: diez operaciones, ocho `directa` con ruta y dos
  `parte` sin ella.

---

## Normalizaciones

### Estados

RIWI (63 Asignado, 14 De baja, 10 STOCK, 6 PRESTAMO, 2 ISF, 1 ASIGNADO, 2 vacío):

| Origen | Destino |
|---|---|
| `STOCK` | `Disponible` |
| `ASIGNADO` | `Asignado` |
| `PRESTAMO` | `Prestado` (ver D34) |
| `ISF` | `Prestado` + `prestado_a = 'ISF'` |
| vacío | marcar `ESTADO_NO_APLICA` |

BBL trae los suyos, que el encargo no cubría (109 Asignado, 12 Disponible, 1 De
baja, y estos cuatro sueltos):

| Origen | Destino | Fila |
|---|---|---|
| `ASIGNADO` | `Asignado` | f84 `BBL-0004` |
| `Disponible - Revisión` | `Disponible` + `requiere_revision` | f73 `BBL-0051` |
| `No asignar` | `Reservado` | f98 `BBL-0061` |
| `No aplica` | la fila no se importa (ver abajo) | f25 |

### Tipo de equipo

RIWI (92 Portátil, 3 Portatil, 2 Escritorio, 1 Desktop): `Portatil`→`Portátil`;
`Escritorio` y `Desktop`→`Desktop`.

BBL: 122 Portátil, **3 `PC del cliente`**, 1 `No aplica`. Los tres del cliente
van `categoria = 'Portátil'` + `propiedad = 'Cliente'` y **sin marcar** (D7 b):
sus `N/A` en serial, etiqueta, marca y modelo los explica que la máquina no sea
de la empresa. Marcarlos serían tres falsos positivos permanentes en la bandeja.

### Ubicaciones

RIWI: `Medellín` 45, `Barranquilla` 28, `Bogotá` 1, `Boyacá` 1, `ISF` 2, 21
vacías. BBL: `Medellín` 82, `Barranquilla` 32, `Cartagena` 9, `Bogotá` 1,
`San Rafael` 1, `Remoto - Sabaneta` 1.

- `Boyacá` → **sede nueva**.
- `San Rafael` → `sede_id = NULL` + `UBICACION_FUERA_DE_SEDES` (D7 c). No
  adivinar.
- `Remoto - Sabaneta` → **sí se mapea a `Remoto`**, marcado igual. Cambia
  respecto a la etapa 2, y el motivo es que ahora existe la regla de dirección
  obligatoria para Remoto (D30): mapearlo hace que el aviso de dirección salte
  sobre esa persona, que es justo lo que hace falta. Dejarlo suelto lo
  escondería.
- `ISF` como ubicación **no es sede**: es consecuencia del préstamo,
  `sede_id = NULL`.

### Las dos filas desplazadas

`BAQ-00022` (f97) y `BAQ-00023` (f98) llevan todo corrido **cuatro** posiciones
desde `TIPO DE LICENCIA`, no tres:

```
TIPO DE LICENCIA="14 Pulgadas"                      <- es el tamaño
TAMAÑO="12th Gen Intel(R) Core(TM) i5-1235U"        <- es el procesador
PROCESADOR="SSD 480"                                <- es el disco
DISCO="16 GB"                                       <- es la RAM
RAM=""                                              <- vacía al final
```

No se recolocan automáticamente: importar lo que se pueda y marcar
`COLUMNAS_DESPLAZADAS`. El `SERIAL WINDOWS` de las dos sí es una clave 5×5
legítima, lo que confirma que el corrimiento empieza exactamente en
`TIPO DE LICENCIA`.

Y `BAQ-00023` comparte el serial `6KP4H64` con `BAQ-0023` (f65), que está
completa: casi con seguridad la misma máquina metida dos veces. Las dos entran
marcadas, ninguna se fusiona.

### Etiquetas

RIWI usa formato numérico (`0468`, `1705`), más `BAQ-XXXXX` y las `BBL-XXXX` de
los préstamos. **No se unifican**: la etiqueta es lo que está pegado
físicamente al equipo.

Tras deduplicar los seis, no queda ninguna colisión de etiqueta entre ficheros
—las únicas tres compartidas son `BBL-0018`, `BBL-0053` y `BBL-0077`, y son la
misma máquina—. Dentro de RIWI sí: `BAQ-00117` está en **dos máquinas
distintas** (f89 `C9GLQ74`, f91 `5CNWL84`). Las dos marcadas.

En BBL, `No tiene` ×9 y `N/A` ×3 son marcadores en la columna de etiqueta, no
etiquetas: van a NULL + `SIN_ETIQUETA`.

### Duplicados y huecos que el encargo no listaba

- BBL: `GH14W64` en f73 (`BBL-0051`) y f112 (`BBL-0031`), mismo modelo.
- BBL: **4 filas sin serial** (f28, f32, f124, f127), tres de ellas equipos
  reales asignados a personas.
- RIWI: 1 fila sin serial y sin etiqueta (f70), que sí es un portátil real
  —Lenovo V14 G5 IRL, `STOCK`, Barranquilla—.
- BBL f110: `Asignado` **sin** `USUARIO RESPONSABLE`, con
  `SESION DE USUARIO = andreina.arevalo@bblabs.io`. El nombre está ahí pero
  deducirlo sería inventar (D7 e): `ASIGNADO_SIN_RESPONSABLE`.

### La fila 25 de BBL no se importa, pero su persona sí

Todo `No aplica` salvo la persona y la ubicación. No describe ningún equipo, así
que no entra (D7 a). **Pero Cristian Andres Correa Alvarez sí se crea como
empleado**, que es la corrección que se hizo después en la etapa 2: un empleado
se crea por cada persona nombrada, exista o no el vínculo con un equipo.

---

## Periféricos

**El solapamiento entre las dos hojas es 0.** Esa era la pregunta abierta.

Lo que sí hay es un bloque repetido dentro de RIWI: **las filas 24–33 copian las
filas 4–14**. Mismo tipo, marca, modelo, serial, responsable y ubicación; la
única diferencia es que la primera copia trae `CEDULA USUARIO = "N/A"` y la
segunda la trae vacía.

> Se importa **una** vez, la copia más completa, marcada `BLOQUE_DUPLICADO`, y
> al reporte con las dos filas de origen.

Mismo serial, mismo responsable y misma ubicación es la misma máquina, y D31
dice una fila por máquina física. Diez periféricos fantasma contables como
disponibles es peor que perder una copia.

`C2022CM23B030649` se contradice entre copias —`Asignado`/Witer Noreña/Medellín
en f14, `STOCK` sin responsable ni ubicación en f33—: se marca además por eso.

En BBL: 20 de 61 filas sin serial, y tres seriales repetidos. `JNZMR0117` está
en **cuatro ratones asignados a cuatro personas distintas**, y `2521AY90L3A9`
está a la vez en un MOUSE y en unas DIADEMAS. Todos marcados con
`SERIAL_REPETIDO_PERIFERICO`; no se fusiona nada.

Tipos: BBL solo trae `DIADEMAS`, `MOUSE` y `TECLADO`. RIWI añade `Monitor`,
`Adaptador tipo C`, `Cámara` y `HDD Externo` — los tres últimos a `Otro`.
`DISPONIBILIDAD`: `STOCK` (RIWI) y `Disponible` (BBL) al mismo destino.

---

## Empleados

71 nombres únicos en RIWI y **109** en BBL, no 113 — y no es efecto de
normalizar: sin normalizar también son 109. Contando periféricos, 75 y 117.

Reglas de matching de D8 sin cambios: nombre normalizado, sin fusión por
similitud.

**Seis nombres aparecen en los dos archivos**, y no se fusionan: al reporte con
`NOMBRE_EN_DOS_EMPRESAS`, porque un mismo nombre en dos empresas puede ser una
persona o dos.

```
MARIA ALEJANDRA LLANO (1/1)   VERONICA MARTINEZ (2/3)   NADINE CASTILLO (3/1)
ANGELO GAVIRIA (1/1)          MOISES CANTILLO (1/2)     JORGE AREIZA (1/1)
```

Dos de ellos —Angelo Gaviria y Nadine Castillo— salen justo en las filas de
préstamo, así que la ambigüedad de persona y la de propiedad se cruzan en las
mismas máquinas.

Marcadores que no son nombres, y que van a `RESPONSABLE_NO_PERSONA`:
`Recepcion` ×3 y `Recepción` ×1 (si la normalización no quita tildes son dos
personas distintas: las quita), `PRESTAMOS`, `Disponible` ×2,
`PRESTAMO A RIWI`, `POLIZA DE SEGURO`, `z No asignar`.

`Alex Rincon ISF` y `Luisa Jimenez ISF` **sí son nombres**, con el sufijo de la
empresa pegado. Se recorta el sufijo y se conserva la persona; el hecho que el
sufijo transmitía ya lo lleva `prestado_a = 'ISF'`.

---

## Verificación

### Números esperados

```
Equipos:     217   (126 + 98 − 6 solapados − 1 de la fila 25)
Periféricos:  88   (61 + 37 − 10 del bloque duplicado)
```

Si no cuadra, **la reconciliación aborta antes del commit**.

En la documentación no se escribe «98 periféricos»: 98 eran filas, y las filas
no son aparatos. Es la misma distinción que hace que 217 tampoco sea «217
máquinas distintas» —dentro quedan duplicados marcados que nadie ha resuelto
todavía— y decirlo mal convertiría un pendiente en un hecho.

Dos filas en `importaciones`, una por archivo, cada una con su hash.

### Grupo I de `verificar-datos.sql` — **entra con la reimportación, no antes**

- `prestado_a IS NOT NULL ⟺ estado = 'Prestado'`
- `prestado_a::text ≠ empresa::text`
- ningún serial repetido entre empresas sin marca

Los dos primeros ya los impone una CHECK desde la 0012, así que aquí son la
comprobación de que lo cargado las cumple, no de que existan.

**Escribirlos antes de reimportar habría dado tres verdes de vacío**: hoy no hay
ni un equipo prestado, así que las tres consultas devuelven cero filas
infractoras sin haber mirado nada. Es el modo de fallo que este proyecto ya
conoce, y por eso van atados a la carga:

> **La reimportación no se cierra sin el grupo I.**

Y van con **su línea de contexto**, como el resto del verificador: el número de
equipos prestados y el reparto por prestatario, impresos al lado del veredicto.
Sin ese número, un verde del grupo I es indistinguible de un verde de vacío — y
la diferencia entre «ninguno los incumple» y «no hay ninguno» es justo la que
hace inútil a un verificador.

### Y lo de siempre

`ESTADOS_SIN_OPERACION` vacío tras añadir `Prestado`. Los dos verificadores en
verde **y con exit code 0**. `npm test` con exit 0, no con «48/48».

---

## Interfaz

No está terminado cuando tiene endpoint. Es lo que acaba de costar la 5d.

- **Filtro por empresa en Inventario**, con los conteos arriba y de un clic,
  igual que el de Empleados (D28). Las tres claves siempre, más `ISF` mientras
  tenga algo prestado — `ISF` no es una de nuestras empresas y un chip «ISF 0»
  permanente sería una categoría inventada.
- **El préstamo se ve sin abrir la ficha**: bajo el estado, `BBL Labs → RIWI`.
  «Prestado» a secas obliga a entrar para saber lo único que importa de un
  préstamo.
- **Un equipo prestado sale en las DOS listas**, la del dueño y la de quien lo
  tiene: `empresa = X OR prestado_a = X`. Es lo que D31 compró al meter cada
  máquina en una sola fila, y hasta ahora no se veía en ninguna parte.
- Las dos operaciones nuevas con su botón, desde el catálogo del servidor.

### Los tres números que no suman, y por qué está bien

Los chips dan 123 + 186 + 0 sobre 305 filas. Un equipo prestado se cuenta en las
dos empresas porque **está** en las dos listas. El conteo usa exactamente el
mismo `OR prestado_a` que el filtro, a propósito: un chip cuyo número no cuadre
con lo que sale al pulsarlo es una cifra decorativa. Y la vista lo dice en una
línea, para que nadie lo lea como un error de cuentas.

### La bandeja se vacía

Hasta aquí los motivos se veían y no se podían cerrar: las 177 filas marcadas
solo salían con un `DELETE` a mano contra la base, que es justo lo que cerrar el
`PATCH` de estado (D19) pretendía impedir. Un listado de problemas sin forma de
resolverlos es una lista de reproches, y a los dos meses nadie la abre.

`DELETE /api/equipos/:id/motivos/:codigo` cierra uno, y **cerrar el último baja
la marca** en la misma transacción: son el mismo hecho desde la 0006. Eso
reactiva los índices únicos parciales sobre esa fila, así que si el duplicado
que la marcó sigue ahí, Postgres rechaza el cierre — la limpieza no se puede
cerrar en falso, y el caso está probado por sus dos lados.

Dos motivos traen además la herramienta con la que se arreglan, porque cerrarlos
sin arreglar el dato sería taparlos:

| Motivo | Cómo se resuelve |
|---|---|
| `PROPIEDAD_AMBIGUA` (2) | `PATCH` de `empresa`. La propiedad no sale de ninguna operación —no hay movimiento «cambio de dueño»— así que es un campo editable y no un 409 |
| `RESPONSABLE_EN_CONFLICTO` (1) | `POST /api/equipos/:id/tenedor`, con los dos nombres a la vista en las notas |

### `tenedor`: la grieta que D19 no cubría

`Prestado` es el único estado donde `empleado_id` es libre (0012), y **ninguna
de las diez operaciones lo escribe**: `prestar` mueve el estado y deja el
tenedor a NULL. Sin una vía para fijarlo, el conflicto de `F5X8494` sería
visible y no resoluble — dos nombres en una nota y ninguna forma de elegir.

Va en ruta propia y no como campo del `PATCH`: `empleado_id` sigue en
`POR_SU_ENDPOINT`, donde D19 lo puso. Y no abre lo que D19 cerró, porque no
cambia el estado: el equipo sigue prestado a la misma empresa, y fuera de
`Prestado` responde 409 diciendo que la operación es `asignar`.

---

## Resultado de la carga

`npm run db:reset && npm run migrate && npm run seed && npm run import`, contra
los dos archivos. Reconcilia contra los números esperados **dentro** de la
transacción: si no cuadran, no hay COMMIT.

```
equipos          217   (esperados 217)
periféricos       88   (esperados 88)
                 ---
filas en BD      305,  de las cuales 128 limpias y 177 marcadas
rechazadas         1   (BBL fila 25, «No aplica» en todo — D7 a)
absorbidas        16   (10 del bloque repetido de RIWI + 6 del cruce entre archivos)
empleados        179
prestados          9   ISF=2  RIWI=4  y 3 sin prestatario conocido
corridas           2,  una por archivo, cada una con su hash
```

Los seis seriales compartidos quedaron así, que es exactamente D33:

```
 46H9494  BBL-0077  BBL Labs  Prestado    RIWI   Carlos Castaño Rodriguez
 53XQP74  BBL-0053  BBL Labs  Prestado    RIWI   Angelo Gaviria
 DGYD774  BBL-0018  BBL Labs  Prestado    RIWI   Daniel Gil
 F5X8494  BBL-0063  BBL Labs  Prestado    RIWI   —  (RESPONSABLE_EN_CONFLICTO)
 PF616WAN BBL-0323  BBL Labs  Asignado    —      Nadine Castillo  (PROPIEDAD_AMBIGUA)
 PF61G1VF BBL-0324  BBL Labs  Disponible  —      —                (PROPIEDAD_AMBIGUA)
```

### El bloque de motivos, por tamaño

```
114 SECRETO_NO_ES_SECRETO      8 SERIAL_DUPLICADO           2 CLAVE_WINDOWS_MALFORMADA
 37 LICENCIA_OK                8 SERIAL_REPETIDO_PERIFERICO 2 PROPIEDAD_AMBIGUA
 27 SIN_SERIAL                 6 ASIGNADO_SIN_RESPONSABLE   2 COLUMNAS_DESPLAZADAS
 21 SIN_UBICACION              6 RESPONSABLE_NO_PERSONA     2 UBICACION_FUERA_DE_SEDES
 19 NOMBRE_EN_DOS_EMPRESAS     5 LICENCIA_NO_ES_LICENCIA    2 ESTADO_NO_APLICA
 11 SIN_ETIQUETA               4 ETIQUETA_DUPLICADA         1 COPIAS_QUE_NO_CONCUERDAN
 10 BLOQUE_DUPLICADO           3 MARCADOR_EN_CAMPO_TECNICO  1 ESTADO_REVISION
                               3 PRESTATARIO_DESCONOCIDO    1 SESION_NO_CONCUERDA
                                                            1 RESPONSABLE_EN_CONFLICTO
```

**114 de un solo motivo, y es el que más importa**: 114 celdas de una columna
cifrada que traían un marcador. Cifradas, habrían sido 114 secretos invisibles
que solo se podían auditar descifrándolos uno a uno. De verdad se cifraron 101
claves de Windows y 117 contraseñas de BIOS.

### Lo que la carga corrigió de este mismo documento

- **La CHECK `prestado_a` era una equivalencia y no podía serlo.** D34 manda que
  `0798` entre `Prestado` con prestatario NULL, y la 0012 lo prohibía. Migración
  0013: pasa a implicación. El caso del verificador que la cubría salió verde
  porque probaba la CHECK escrita, no la regla decidida — probar el código no es
  probar la regla.
- **El cruce solo miraba una de las dos señales.** `46H9494` cayó en
  `PROPIEDAD_AMBIGUA` aunque BBL escribe `PRESTAMO A RIWI` en la casilla de la
  persona: la marca del DUEÑO. Con las dos señales, los préstamos pasan de 8 a 9
  y `PROPIEDAD_AMBIGUA` de 3 a 2, que son los dos que de verdad no se sabe.
- **Tres invariantes del verificador eran ciertos por accidente.** Que el código
  de ubicación implicara sede vacía, que un equipo sin sede solo pudiera
  explicarlo con una marca, y que `ESTADO_NO_APLICA` solo apareciera en filas
  rechazadas. Los tres se cumplían en el archivo de la etapa 2 y ninguno era la
  regla que decían ser. Reescritos, no relajados: `SIN_UBICACION` con sede sigue
  siendo un error, un préstamo cuenta como explicación de no tener sede, y lo
  que rechaza una fila es traer los dos códigos a la vez.
- **La cédula compartida no existía.** La primera versión del detector de
  bloques absorbía filas de más en BBL y, al fusionar «la copia más completa»,
  arrastraba la cédula de una persona a la ficha de otra; la carga reventó por
  UNIQUE. El choque era del detector, no del Excel. La guarda de D8 regla 4 se
  quedó escrita igual —cero casos reales, como en la etapa 2— porque el día que
  haya uno tiene que salir por el reporte y no por un error del driver.

---

## D35. Reasignar es compuesta, y la composición vive en la tabla

Cierra el último defecto marcado como BUG en `pendientes.md`. El botón existía
desde el prototipo y abría el asistente de onboarding, que solo lista equipos
disponibles: el equipo desde el que se pulsaba no aparecía en su propio
desplegable. Al reescribir la vista el botón se retiró, y la capacidad se quedó
sin hacer — quedaron un `handleReasignar` y una prop que ya no usaba nadie.

**Reasignar es `devolver` + `asignar`, y escribe DOS movimientos.** No un
movimiento nuevo llamado «Reasignación»: quien tenía el equipo lo devolvió y
otra persona lo recibió, y son dos hechos. Un atajo que escribiera uno solo
dejaría la pregunta que justifica el proyecto —«¿quién tenía el BBL-0301 en
marzo?»— con media respuesta.

### La composición es un campo, no un `if` en el endpoint

`compuesta: ['devolver', 'asignar']` va en `TRANSICIONES`, al lado de `desde`,
`hacia` y `disparo`. Es la misma lección que costó el botón que daba 404: si la
composición viviera en el código del endpoint, la tabla diría una cosa y el
endpoint haría otra, y nada las obligaría a coincidir. Así, `mutar` ejecuta la
cadena **porque lo dice la tabla**, y el catálogo la publica para que la
interfaz sepa que son dos.

`movimiento` sigue siendo uno solo —el de la segunda mitad— porque el campo es
uno. Es una media verdad inevitable, y `compuesta` está justo al lado para que
quien lea la fila vea que se escriben dos.

Cada mitad pasa por todo lo de `mutar`: su comprobación de transición, su
`FOR UPDATE`, su movimiento y su fila de auditoría. Y por la transacción de
fuera —drizzle convierte la anidada en un savepoint—, así que **si la segunda
mitad falla, la primera se deshace**: el equipo no se queda devuelto a medias
mientras quien pulsó cree que no pasó nada. Hay un caso que lo prueba con un
empleado inexistente.

### Lo que el atajo no se salta

- **La pregunta.** «El equipo ya volvió de X» es una casilla que hay que marcar
  antes de que el desplegable se active. Devolver es un hecho físico, y sin
  ella el historial afirmaría una entrega que quizá no ocurrió. Es lo que el
  propio pendiente pedía: «la pregunta que hoy nadie hace».
- **Una persona distinta.** Reasignar a quien ya lo tiene da 400 y no escribe
  nada; el desplegable ni siquiera lo ofrece. Serían dos movimientos que no
  cuentan nada.

Con ella son **once operaciones**, y `ESTADOS_SIN_OPERACION` sigue vacío:
reasignar no añade estados, va de `Asignado` a `Asignado`.
