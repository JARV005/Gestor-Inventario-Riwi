# Decisiones 02 — tras la exploración del Excel

> Complementa `plan-migracion-v1.md` §3 y `decisiones-01.md`. Donde haya
> contradicción, gana este documento.
>
> Todas las decisiones de aquí salen de una fase de exploración previa a
> escribir el importador. Los números citados están medidos sobre
> `inventario_muestra_johan.xlsx`, no estimados.

---

## Lo que el §3 daba por cierto y no lo era

| §3 decía | Los datos dicen |
|---|---|
| «17 equipos sin responsable **pero con estado Asignado**» | 17 sin responsable, sí, pero solo **1** en `Asignado`. Los otros 16 están en `Disponible`/`REVISION`, o sea coherentes |
| «3 equipos sin serial» | 3 vacías **+ 6 con `N/A`** = **9** sin serial utilizable |
| «`GARANTIA VENC.` vacía en 125 de 126» | El único valor presente es `"N/A"`. Son **126 de 126** |

Y lo que no vio: **15 equipos sin etiqueta utilizable** (`"No tiene"` ×9,
`N/A` ×5, 1 vacía), 2 ubicaciones fuera de las sedes, seriales repetidos
también entre periféricos, y que el archivo tiene **5 hojas y no 2**
(`TABLA` es una tabla dinámica obsoleta, `Calendario 2026` no es inventario,
`CRONOGRAMA MANTENIMIENTO` tiene cabeceras y 0 filas).

---

## D7. Decisiones sobre filas concretas

### (a) La fila 25 no se importa

Tiene `"No aplica"` en *todo*, incluidos `TIPO EQUIPO` y `ESTADO DEL EQUIPO`.
No describe ningún equipo. Importarla crearía un activo fantasma que nadie
podría cerrar.

Va al reporte con `resultado = RECHAZADA` y sus 6 motivos.

**Consecuencia:** entran **186** filas, no 187. Y por tanto 186 movimientos
`Alta`, no 187.

### (b) Los 5 `PC del cliente` no se marcan por sus huecos

El §3 ya mandaba `categoria = Portátil` + `propiedad = 'Cliente'`. Las 5 filas
traen `N/A` en serial, etiqueta, marca y modelo, lo cual es *esperable*: la
máquina no es de la empresa y TI no la inventaría. `propiedad = 'Cliente'` ya
explica los huecos.

Marcarlas serían 5 falsos positivos permanentes en la bandeja de limpieza:
nadie va a "resolverlos" nunca porque no hay nada que resolver.

**Consecuencia medida:** la hoja de equipos pasa de 60 a **55** filas marcadas,
y de 84 a 66 motivos (−15 por estos 5, −6 por la fila 25, +2 por el código
nuevo de D8).

### (c) `San Rafael` y `Remoto - Sabaneta` no se mapean

`Remoto - Sabaneta` → `Remoto` es tentador, pero es interpretación. Ambas
entran con `sede_id = NULL` y `UBICACION_FUERA_DE_SEDES`, y el reporte pregunta
si se crean sedes o se mapean. Es lo que manda la regla 3 de `CLAUDE.md`.

### (d) `condicion_equipo` gana `Usado`

Ver D9.

### (e) `SESION DE USUARIO` no alimenta `empleados.email_corporativo`

75 de sus valores son correos `@bblabs.io` y 33 no llevan `@`. Es la cuenta con
la que se inicia sesión en esa máquina, que no tiene por qué ser la persona
responsable. Se queda solo en `equipos.sesion_usuario`.

Nota técnica: 73 de esas celdas son de tipo Hyperlink (`mailto:`), no String.
Leerlas sin mirar el tipo devuelve el objeto, no el texto — es la razón real
por la que hace falta `exceljs` en este archivo, y no las fechas: **no hay ni
una celda de tipo Date en las dos hojas de datos**.

### (f) Las altas cubren también los periféricos

186 movimientos tipo `Alta`, todos atribuidos a `sistema@bbl.local` (D4).

### `GARANTIA VENC.` no se importa

Vacía en 126 de 126. El campo se queda en la BD para equipos nuevos, pero la
columna no se lee y **no genera marca de revisión**: una columna que nadie
llenó nunca no es deuda de datos, es un campo sin uso.

---

## D8. Reglas de matching de empleados

El §3 temía el caso `"Juan Perez"` / `"Juan Pérez"`. **No existe en este
archivo**, y tampoco el caso más difícil que la normalización no atraparía
(`"Santiago Marin"` vs `"Santiago Marín Gómez"`):

```
valores distintos (unión de las dos hojas): 114
tras normalizar:                            114
colisiones:                                   0
pares con 2+ tokens compartidos:              0
```

1. **La llave es el nombre normalizado** — minúsculas, sin tildes, espacios
   colapsados. Justificado por los números de arriba, no por conveniencia.
2. **Nada de fusión por similitud.** Ni tokens compartidos ni distancia de
   edición. No hace falta aquí, y fusionar dos personas distintas es un error
   que no se detecta después. Si un archivo futuro trae colisiones, van al
   reporte, no al merge automático.
3. **Los marcadores y `"Disponible"` no son nombres.** El equipo queda sin
   responsable y marcado con `RESPONSABLE_NO_PERSONA` (2 filas).
4. **La cédula se guarda cuando existe, pero no decide el vínculo.** Cubre 7 de
   187 filas y la hoja de equipos ni siquiera tiene esa columna, así que no
   puede ser llave. Sí es el identificador real de la persona y `empleados.cedula`
   es UNIQUE. Si dos nombres normalizados distintos compartieran cédula → reporte,
   no merge. Hoy: 0 casos.
5. **La sede del empleado sale de la del equipo.** Comprobado que ningún
   empleado aparece con dos ubicaciones distintas (0 de 113). Si en el futuro
   hay conflicto → `sede_id` NULL + reporte.

### Se crean 113 empleados: uno por cada nombre del archivo

Un empleado se crea por cada persona **nombrada** en el Excel, exista o no el
vínculo con un equipo. `empleados` no exige que la persona tenga equipos
asignados, y 113 en el Excel contra 113 en la BD es auditable de un vistazo.

3 de ellos entran sin equipo a su nombre: son los de las filas donde el vínculo
no se pudo crear (`RESPONSABLE_EN_ESTADO_NO_ASIGNADO`) más la fila 25
rechazada. Ver D10 punto 3 para la primera versión de esta decisión, que era la
contraria.

---

## D9. Dos cambios de esquema

### `condicion_equipo` gana `Usado`

La hoja de periféricos trae 48 `USADO` y 13 `NUEVO`. El enum del §2 era
`Nuevo | Excelente | Bueno | Requiere reparación`. Mapear `USADO` a `Bueno`
inventa una valoración que nadie hizo; dejarlo en NULL tira un dato real.

### `motivo_revision TEXT` → `motivos_revision TEXT[]`

Las 126 filas de equipos producen filas con **varias razones a la vez**: 11 con
2 motivos y 2 con 3. Un `TEXT` solo guarda una.

Y son códigos fijos, no frases, porque la bandeja se trabaja por bloques: "los
37 de licencia" es una tarde; 60 casos con explicaciones redactadas a mano no
se agrupan y no se terminan nunca. Los códigos viven en `db/motivos.ts`, cada
uno con descripción y recomendación.

Con un CHECK que ata la marca a su explicación, en las dos direcciones:

```sql
CHECK (requiere_revision = (cardinality(motivos_revision) > 0))
```

Una fila marcada sin motivos no la puede resolver nadie porque nadie sabe qué
tiene mal; unos motivos sin marca no aparecen en la bandeja. `cardinality()` y
no `array_length()`: este último devuelve NULL sobre un array vacío, lo que
dejaría el CHECK indefinido justo en el caso normal.

### Por qué salieron dos migraciones y no una

`0002` añade (`Usado`, la columna nueva, el CHECK) y `0003` retira
`motivo_revision`. En una sola, drizzle-kit necesita preguntar por consola si un
DROP+ADD es un rename, y aquí no hay TTY. Partirlo así deja además un estado
intermedio coherente: la `0002` es puramente aditiva.

No hubo migración de datos porque la tabla estaba vacía. Con filas dentro, el
DROP habría perdido información y habría hecho falta un UPDATE previo que
trasladara el texto al array.

---

## D10. Decisiones tomadas durante la implementación

Estas no estaban en el mensaje de aprobación. Constan aquí porque cambian el
resultado y no se deducen leyendo el código.

### `licencia_tipo`: `N/A` no va a NULL

La regla general del §3 es «`N/A` / `No aplica` en cualquier campo → NULL».
Para `licencia_tipo` **no se aplica**: el enum tiene el miembro `'No aplica'`
justamente para esto, y colapsarlo a NULL borra la diferencia entre «este
equipo no lleva licencia Windows» y «nadie rellenó la casilla». Los 2 vacíos
reales sí van a NULL.

Afecta a 10 filas (9 `N/A` + 1 `No aplica`).

### Código nuevo: `RESPONSABLE_EN_ESTADO_NO_ASIGNADO`

No estaba en la lista de códigos aprobada. Lo obligó el CHECK del §2: un
responsable sobre un equipo que no está `Asignado` viola el invariante.

3 filas lo traían — una `De baja`, una `No asignar` y la 25. No se descarta el
dato: el empleado se crea igual, el vínculo no, el conflicto de estado queda en
`equipos.notas` y la fila se marca para que alguien decida qué es cierto, el
estado o el responsable.

En la BD quedan 2 y no 3, porque la tercera es la fila 25, que se rechaza.

### 3. Solo crear empleados vinculables — REVERTIDA

**La primera versión del importador creaba 110 empleados y no 113.** Los 3 que
faltaban solo aparecían como responsables de filas donde el vínculo no se podía
crear, así que se descartaban como personas y su nombre quedaba únicamente en
`equipos.notas`.

Se revirtió. El razonamiento que la tumbó:

- `equipos.notas` es texto libre que nadie consulta. Quien fuera a resolver esas
  filas tendría que releer el nombre a mano y confiar en no equivocarse al
  teclearlo.
- «110 empleados más otros tres en un campo de texto» no se audita. «113 en el
  Excel y 113 en la BD» sí.
- La tabla no exige que un empleado tenga equipos, así que no había ninguna
  razón técnica para no crearlos.

Queda escrita porque la decisión descartada explica por qué el importador
distingue `persona` de `responsable` en `Candidata`, que si no parecería
duplicación gratuita: `persona` es quien aparece nombrado, `responsable` es
quien puede quedar vinculado, y solo coinciden cuando el estado es `Asignado`.

### 4. Dos de esos tres «empleados» no son personas

Descubierto al reimportar, después de aprobar la reversión anterior. De las 3
filas sin equipo:

| Fila | Estado | `USUARIO RESPONSABLE` |
|---|---|---|
| `BBL-0061` | `Reservado` | `z No asignar` |
| serial `FNJ5D9TC7F` | `De baja` | `POLIZA DE SEGURO` |
| fila 25 (rechazada) | — | `Cristian Andres Correa Alvarez` |

La `z ` inicial de `z No asignar` es el truco de hoja de cálculo para que una
fila caiga al final al ordenar. `POLIZA DE SEGURO` sobre un equipo dado de baja
es a quién se le reclamó, no quién lo tiene. Solo el tercero es una persona.

Es decir: el archivo tiene **111 personas y 2 cadenas basura**, no 113 personas.

**Decisión: se quedan las 113.** El criterio de auditabilidad —que el recuento
del Excel y el de la BD coincidan— se mantuvo por encima de la limpieza de la
tabla.

> **Riesgo asumido, a tener presente en la etapa 5:** `POLIZA DE SEGURO` y
> `z No asignar` son filas de `empleados` indistinguibles de las reales para el
> esquema. Van a aparecer en el desplegable de «a quién se le entrega un
> equipo» y pueden acabar en un acta. Si eso molesta, se corrigen con un
> `UPDATE` de `activo = false` sobre esas dos filas, o se vuelven a marcar como
> no-persona en `db/importar.ts` y se reimporta.

Y un apunte sobre cómo se encontró, porque afecta a la confianza en el resto de
la exploración: **el informe previo dijo que el único valor no-persona era
`"Disponible"`, y era falso.** La heurística que lo buscaba descartaba valores
con dígitos, de una sola palabra, o que contuvieran palabras de cargo o lugar.
`POLIZA DE SEGURO` y `z No asignar` tienen tres palabras y no caían en ninguna
de esas redes. Aparecieron solos al mirar los tres empleados sin equipo — es
decir, los encontró un conteo raro, no la búsqueda que existía para eso.

### `bios_password_cifrado` tiene 115 filas, no 124

La columna tiene 2 celdas vacías sobre 126, de donde salía la expectativa de
124. Pero de las 124 restantes, **9 son marcadores** (`N/A` / `No aplica`), que
la regla del §3 convierte a NULL. Cifrar la cadena `"N/A"` guardaría un secreto
que no existe y obligaría a descifrarla para descubrir que no dice nada.

```
BIOS PASSWORD    vacías=2  marcadores=9   con dato real=115
SERIAL WINDOWS   vacías=2  marcadores=14  con dato real=110
```

2 + 9 + 115 = 126.

---

---

## D11. Tercera ronda de esquema: los motivos dejan de ser un array

Salió de auditar `db/verificar.sql` y encontrarle el mismo sesgo que a la
exploración de datos: sus 22 casos comprobaban **que las reglas estaban
puestas**, ninguno **que lo de dentro las cumpliera**. Si se hubieran borrado 40
equipos de la BD, seguía dando 22/22.

### `equipos_motivos_revision`, tabla puente

`motivos_revision text[]` no tenía integridad referencial: `ARRAY['SIN_SERAIL']`
con la errata entraba sin protestar y esa fila desaparecía de su bloque en la
bandeja sin que nadie se enterase. Todo el argumento de «códigos fijos y no
frases» se caía ahí.

Ahora hay catálogo (`motivos_revision`) y puente con PK compuesta. La PK hace
imposible el motivo duplicado sin depender del `includes()` del importador.

Catálogo y no CHECK con lista literal porque los códigos crecen —esta misma
etapa añadió uno no previsto— y con CHECK cada uno costaría una migración.
Se siembra desde `db/motivos.ts` en `npm run seed`.

### La equivalencia marca ⟺ motivos pasa a CONSTRAINT TRIGGER deferido

Esta es la parte fácil de perder del cambio. El CHECK de la 0002 era posible
porque ambos lados vivían en la misma fila; al cruzar dos tablas, Postgres no lo
admite.

No podía degradarse a una comprobación de `verificar-datos.sql`, y el motivo no
es la bandeja: **`requiere_revision` es el predicado de los índices únicos
parciales de `serial` y `etiqueta`**. Desincronizarla no pierde una entrada en
una lista de pendientes, deja pasar en silencio un serial duplicado. Una
constraint de la que depende otra constraint no se protege con un test que corre
cuando alguien se acuerda.

Deferido porque el importador inserta el equipo antes que sus motivos: entre
las dos sentencias, una fila marcada sin motivos es un estado legítimo e
inevitable, y un trigger inmediato reventaría la carga normal.

Consecuencia para los tests, que casi se cuela: un fichero que acaba en ROLLBACK
nunca llega al COMMIT, así que los triggers deferidos **no dispararían** y sus
casos pasarían en verde sin comprobar nada. `verificar-esquema.sql` los fuerza
con `SET CONSTRAINTS ALL IMMEDIATE` dentro de cada bloque.

### `importaciones` y `equipos.importacion_id`

La reconciliación «187 leídas = 186 insertadas + 1 rechazada» la observa el
importador y se evaporaba al terminar. Sin la tabla, dentro de tres meses nadie
puede responder cuántas filas tenía el archivo sin reabrir el Excel.

`hash_sha256` delata que se reimportó una versión distinta del archivo con el
mismo nombre. La aritmética sí cabe en una fila, así que va como CHECK.

La comprobación completa la hace el importador antes del commit, porque la BD no
observa el Excel: contrasta lo que dijo que iba a hacer contra lo que la BD acabó
teniendo, y si no cuadra lanza y deshace la transacción entera.

### `equipos.empleado_mencionado_id`

«Esta fila menciona a esta persona pero el equipo no está asignado a ella».
Sustituye a dejar el nombre suelto en `notas`, que obligaba a quien resolviera la
fila a releerlo y teclearlo sin equivocarse. Ahora que los 113 empleados existen,
había una FK disponible y no usarla era la peor opción.

### El verificador se parte en dos

| Fichero | Qué comprueba | ¿Pasa en BD vacía? |
|---|---|---|
| `db/verificar-esquema.sql` | Que las reglas están puestas. Filas sintéticas, ROLLBACK | **Sí**, y es su prueba de que no depende de los datos |
| `db/verificar-datos.sql` | Que las 186 filas cargadas son coherentes. Solo lee | **No** |

27 casos el primero, 32 comprobaciones el segundo.

Y se corrigió un caso que iba a envenenar la etapa 5: «traslados abiertos» era
un `count(*) = 0` absoluto, verde solo mientras el inventario no tuviera ni un
traslado. Ahora mide el delta contra los que hubiera al empezar. Un test que se
pondrá rojo sin que nada esté mal enseña a ignorar los rojos.

---

## Resultado de la carga

| | |
|---|---|
| Filas leídas | 187 (126 equipos + 61 periféricos) |
| Importadas | 186 |
| Rechazadas | 1 (la fila 25) |
| Marcadas `requiere_revision` | 83, con 98 motivos |
| Empleados creados | 113 (3 sin equipo a su nombre) |
| Movimientos `Alta` | 186, todos de `sistema@bbl.local` |
| Motivos en la tabla puente | 98 |
| Filas del reporte | 104 (incluye los 6 motivos de la rechazada) |

Desglose por motivo, medido sobre la BD:

```
 LICENCIA_OK                        37     ESTADO_REVISION                     2
 SIN_SERIAL                         23     RESPONSABLE_EN_ESTADO_NO_ASIGNADO   2
 SIN_ETIQUETA                        9     RESPONSABLE_NO_PERSONA              2
 SERIAL_REPETIDO_PERIFERICO          8     SERIAL_DUPLICADO                    2
 SIN_UBICACION                       7     UBICACION_FUERA_DE_SEDES            2
 ASIGNADO_SIN_RESPONSABLE            4
```

**Que 83 de 186 filas estén marcadas es el resultado correcto.** El entregable
de esta etapa es el reporte, no la carga: un importador que hubiera metido las
187 sin rechazar ninguna habría escondido la deuda de datos en vez de hacerla
visible.
