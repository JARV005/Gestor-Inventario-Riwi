# Importación del Excel

Cómo se corre el importador y cómo se rehace. Las decisiones sobre *qué* hace
y por qué están en `decisiones-02.md`; el esquema, en `esquema.md`.

## Antes de correrlo

Hace falta `ENCRYPTION_KEY` en `.env`. Sin ella el importador falla al primer
equipo con clave BIOS, y falla antes de escribir nada.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> Si esa clave se pierde, los valores ya cifrados en la BD son irrecuperables.
> Si cambia, lo cifrado con la anterior deja de descifrarse: rotarla exige
> recifrar la tabla, y hoy no hay script para eso.

El archivo de origen va en `data/origen/`, que está en `.gitignore` y no debe
salir de ahí: contiene contraseñas en texto plano.

## Correrlo

```bash
npm run db:up        # Postgres en contenedor
npm run migrate      # esquema
npm run seed         # sedes y usuario de sistema
npm run import       # data/origen/inventario_muestra_johan.xlsx
```

Con otro archivo:

```bash
npm run import -- data/origen/otro.xlsx
```

El usuario de sistema tiene que existir antes: `movimientos.usuario_app_id` es
NOT NULL y el importador atribuye a él las 186 altas (D4). Si falta, aborta con
ese mensaje.

## Rehacerlo

**El importador no es incremental.** Si `equipos` ya tiene filas, se niega a
correr y dice qué hacer:

```bash
npm run db:reset && npm run migrate && npm run seed && npm run import
```

Dos razones, y ninguna es pereza:

1. **No hay llave natural fiable para reconciliar.** 15 filas del origen no
   tienen etiqueta utilizable y 9 no tienen serial. Sin una llave, "actualizar
   lo que ya está" significa adivinar qué fila del Excel corresponde a qué fila
   de la BD, y equivocarse ahí mezcla dos equipos sin dejar rastro.
2. **`movimientos` es append-only.** Sus filas no se pueden borrar ni siquiera
   para rehacer la carga (ver `esquema.md`). Un importador que reescribiera el
   inventario dejaría el historial contando una importación que ya no
   corresponde a nada.

`db:reset` borra el volumen entero. En esta etapa eso solo cuesta la semilla,
que se regenera. Cuando haya movimientos hechos por personas, dejará de ser
aceptable y el importador tendrá que crecer — pero eso es un problema de
cuando exista, no de ahora.

## Todo o nada

La carga entera ocurre dentro de una transacción: empleados, equipos y
movimientos entran juntos o no entra ninguno. Si algo falla a mitad, la BD
queda exactamente como estaba. Medio inventario dentro es peor que ninguno,
porque no se sabe dónde se cortó.

El reporte, en cambio, se escribe **después** de que la transacción confirme.
Si la carga falla no hay reporte, y es lo correcto: un reporte de una carga que
no ocurrió induce a pensar que sí.

## El reporte de rechazos

`data/origen/reporte-rechazos.csv` — gitignorado como el resto de esa carpeta.

Está **agrupado por motivo, no por fila**: una fila con 3 motivos aparece 3
veces, una en cada bloque. Es deliberado. La bandeja se ataca por bloques —
"los 37 de licencia" es una tarde de trabajo con una sola cabeza puesta; los
mismos 37 repartidos entre otros 60 casos distintos no se terminan nunca.

| Columna | Qué es |
|---|---|
| `motivo` | Código de `db/motivos.ts` |
| `filas_con_este_motivo` | Tamaño del bloque, repetido en cada fila para poder ordenar |
| `descripcion` / `recomendacion` | Qué pasó y qué hacer. Salen del código, no se redactan a mano |
| `resultado` | `IMPORTADA_CON_MARCA` o `RECHAZADA` |
| `hoja`, `fila_excel` | Dónde mirar en el archivo original |
| `etiqueta`, `serial`, `ubicacion_origen` | Para localizar el equipo físicamente |
| `otros_motivos_de_la_misma_fila` | Para no "resolver" una fila que sigue teniendo otros problemas |

Lleva BOM UTF-8: sin él, Excel en Windows destroza las tildes.

`BIOS PASSWORD` y `SERIAL WINDOWS` **no aparecen y no aparecerán**. Se leen y se
cifran, pero no se imprimen, no se registran y no salen en ninguna exportación.
Esa restricción es permanente, no de la fase de exploración.

## Cerrar un caso de la bandeja

Bajar `requiere_revision` **no basta**: hay que vaciar también
`motivos_revision`. El CHECK `equipos_revision_con_motivos` rechaza cualquier
fila donde la marca y los motivos no digan lo mismo.

```sql
UPDATE equipos
   SET requiere_revision = false, motivos_revision = ARRAY[]::text[]
 WHERE id = '...';
```

Para cerrar solo uno de varios motivos, quitar ese elemento del array y dejar
`requiere_revision = true` mientras queden otros.

Ojo con `SERIAL_DUPLICADO` y `SIN_ETIQUETA`: al desmarcar, la fila entra en los
índices únicos parciales y la BD comprueba la unicidad **en ese momento**. Si
el duplicado seguía sin resolver, el UPDATE falla. Es intencionado: la limpieza
no se puede cerrar en falso.

## Los códigos de motivo

Fuente: `db/motivos.ts`. Añadir uno obliga a escribir su descripción y su
recomendación, que son las dos columnas que lee quien limpia.

| Código | Qué significa |
|---|---|
| `LICENCIA_OK` | `TIPO DE LICENCIA` venía como `"OK"`, que no es un tipo |
| `SIN_SERIAL` | Serial vacío o con un marcador |
| `SERIAL_DUPLICADO` | El serial se repite en la hoja de equipos |
| `SERIAL_REPETIDO_PERIFERICO` | Se repite entre periféricos; suele ser una referencia de modelo |
| `SIN_ETIQUETA` | Etiqueta vacía o `"No tiene"` |
| `SIN_MARCA` | Marca ausente o marcada como no aplicable |
| `SIN_UBICACION` | `UBICACIÓN` vacía |
| `UBICACION_FUERA_DE_SEDES` | La ubicación no corresponde a ninguna sede registrada |
| `ESTADO_REVISION` | El estado de origen indicaba revisión pendiente |
| `ESTADO_NO_APLICA` | `ESTADO DEL EQUIPO` era un marcador |
| `SIN_TIPO` | `TIPO EQUIPO` era un marcador |
| `ASIGNADO_SIN_RESPONSABLE` | Estado `Asignado` sin responsable; entró como `Disponible` |
| `RESPONSABLE_NO_PERSONA` | El responsable era un marcador |
| `RESPONSABLE_EN_ESTADO_NO_ASIGNADO` | Traía responsable con estado distinto de `Asignado`; el nombre quedó en `notas` |

## Verificar después de importar

```bash
npm run db:verificar
```

22 casos, y ninguna etapa se cierra sin que salgan todos en verde. Cubre los
índices únicos parciales, el invariante de estado, el de marca-y-motivos, y las
reglas de append-only.
