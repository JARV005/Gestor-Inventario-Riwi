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

## Lo que queda anotado, sin decisión todavía

**`Reservado` es un estado sin puerta de entrada.** `tipo_movimiento` no tiene
ningún valor que lo produzca, y de las cuatro mutaciones de la etapa 5 solo
`asignar` lo saca. Hay 1 equipo así, puesto por el importador. Pendiente de
decidir si se añade la mutación o se documenta como estado heredado.

**`auditoria.usuario_app_id` es `ON DELETE RESTRICT`.** En cuanto la etapa 5
audite toda escritura sobre `equipos`, ningún usuario que haya hecho algo podrá
borrarse nunca. Para un rastro de auditoría es lo correcto —dar de baja a
alguien es desactivar, no borrar— pero conviene que sea una decisión consciente
y no una sorpresa el día que alguien lo intente. Ya mordió al arnés de tests en
la 4b.
