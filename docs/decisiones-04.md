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
