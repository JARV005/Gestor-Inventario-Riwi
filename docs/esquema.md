# Esquema de la base de datos — notas de la etapa 1

> Complementa `plan-migracion-v1.md` §2 y `decisiones-01.md`. Aquí solo está lo
> que la implementación decidió y esos dos documentos no fijaban, o fijaban de
> otra manera. El esquema vivo es `db/esquema.ts`.

La fuente de verdad es el TypeScript: `drizzle-kit generate` deriva el SQL de
`db/esquema.ts` por diff. Lo que drizzle-kit no modela — funciones y triggers —
se escribe a mano en `db/migraciones/0001_reglas.sql`, que no toca al hacer diff.

---

## Los cuatro desvíos del §2

### 1. `sedes.nombre` es UNIQUE

El §2 no lo pedía. Sin él la semilla no puede ser idempotente: `npm run seed`
se apoya en `ON CONFLICT (nombre) DO NOTHING`, y sin la restricción cada corrida
añadiría cinco sedes más. Una sede se identifica por su nombre de todos modos.

### 2. `empleados.sede_id` admite NULL

El §2 lo listaba como `sede_id FK`, sin marca de NULL, junto a otros campos que
sí la llevaban — o sea, NOT NULL por omisión.

Con NOT NULL, un empleado del Excel sin sede legible no se puede importar sin
asignarle una sede inventada. Eso choca de frente con la regla 3 de `CLAUDE.md`,
y `empleados` no tiene `requiere_revision` donde aparcar el caso. Entre inventar
un dato y admitir un hueco, gana el hueco: es visible y se puede corregir.

### 3. `serial` y `etiqueta`: índice único **parcial**, no UNIQUE

Este es el desvío que más importa, y el §2 inducía al error: decía
`serial UNIQUE NULL -- ver §3, hay duplicados y vacíos en origen`.

Un UNIQUE simple resuelve solo la mitad. Los vacíos entran, porque en Postgres
dos NULL no colisionan. Los duplicados **no**: el Excel trae el serial `GH14W64`
repetido, el §3 manda meter esas filas marcadas con `requiere_revision` en vez
de deduplicarlas a ojo, y con UNIQUE la segunda no entra ni marcada. El
importador de la etapa 2 se detiene en la primera fila conflictiva.

Lo que hay en su lugar:

```sql
CREATE UNIQUE INDEX equipos_serial_uk ON equipos (serial)
  WHERE serial IS NOT NULL AND requiere_revision = false;
CREATE UNIQUE INDEX equipos_etiqueta_uk ON equipos (etiqueta)
  WHERE etiqueta IS NOT NULL AND requiere_revision = false;
```

El predicado hace dos cosas distintas:

- `IS NOT NULL` deja convivir los vacíos. Es redundante para la corrección
  —los NULL ya no colisionan— y está por tamaño del índice y por decir la
  intención en voz alta.
- `requiere_revision = false` es lo que hace importable el Excel. Las filas
  dudosas quedan **fuera** del índice mientras están marcadas.

El efecto interesante llega después: cuando alguien resuelve un duplicado y baja
la marca, esa fila entra al índice y la unicidad se comprueba **en ese momento**.
Si el conflicto seguía ahí, la BD rechaza el cambio. La limpieza de la etapa 2
no se puede cerrar en falso.

`db/verificar.sql` cubre las dos direcciones: dos filas con `GH14W64` marcadas
entran; desmarcar la segunda sin resolver el duplicado rebota.

### 4. `movimientos` es append-only, con una excepción exacta

El §2 dice «nunca se edita ni se borra». D1 introduce
`fecha_confirmacion`: confirmar un traslado la rellena **sobre la fila que ya
existe**. Leídos literalmente, se contradicen.

Se concilian leyendo la regla por lo que protege: el hecho histórico, no la fila
como objeto. Un movimiento registra que algo pasó; eso es inmutable. Que un
traslado en curso se cerró es un hecho posterior sobre el mismo envío, no una
corrección del anterior. El trigger `movimientos_append_only()` lo impone así:

| Operación | Resultado |
|---|---|
| `DELETE` | Prohibido, sin excepciones |
| `UPDATE` de cualquier campo salvo `fecha_confirmacion` | Prohibido |
| `UPDATE` de `fecha_confirmacion` de NULL a un valor | Permitido |
| `UPDATE` de `fecha_confirmacion` ya rellena | Prohibido — reabrir un traslado cerrado es reescribir el pasado |

La comparación no enumera columnas: contrasta `to_jsonb(NEW)` contra
`to_jsonb(OLD)` restando los dos campos que sí pueden cambiar. Así una columna
que se añada mañana queda protegida por omisión, y no por acordarse de añadirla
a una lista.

Si una etapa posterior necesita mutar algo más, se cambia con una migración
nueva y a la vista.

---

## Otras decisiones de implementación

### El CHECK del invariante es una equivalencia

El §2 pedía `estado = 'Asignado'` ⟺ `empleado_id IS NOT NULL`, y así quedó:

```sql
CHECK ((estado = 'Asignado') = (empleado_id IS NOT NULL))
```

Cierra las dos formas de mentir sobre el estado, no solo una: ni un equipo
`Asignado` sin responsable, ni un responsable colgando de un equipo
`Disponible`. Ninguno de los dos lados puede ser NULL, así que la igualdad
siempre da `true` o `false` y nunca `NULL` — que es el caso en que un CHECK
pasa por defecto.

### `updated_at` lo mueve un trigger, no la aplicación

Hacerlo desde el código falla en cuanto algo escribe sin pasar por él: el
importador de la etapa 2, un `UPDATE` manual de soporte, una restauración.

Usa `clock_timestamp()` y no `now()`. `now()` es `transaction_timestamp()`,
congelado al abrir la transacción: con él, una fila insertada y luego modificada
dentro de la misma transacción —el caso normal en las mutaciones del §4, que
tocan `equipos` y `movimientos` juntas— conservaría el `updated_at` del INSERT.
Se detectó porque la prueba del trigger fallaba en `db/verificar.sql`.

### Orden de los triggers sobre `movimientos`

Los dos son `BEFORE UPDATE`. A igualdad de momento, Postgres los dispara en
orden alfabético de nombre, así que `trg_movimientos_append_only` corre antes que
`trg_movimientos_updated_at`. Por eso la comparación de append-only ignora
`updated_at`: en ese punto `NEW` aún trae el valor viejo.

### Ordenamiento en español, en el `initdb`

La BD se crea con `--locale-provider=icu --icu-locale=es-CO`. Con eso la `ñ` cae
entre `n` y `o` y los acentos no rompen el orden alfabético, en toda la base y
sin que ninguna columna tenga que declararlo. Se fija al crear el volumen;
cambiarlo después exige recrearlo.

Comprobado: `ánade | arbol | nutria | ñandu | oso | Zapata`.

### Claves foráneas en RESTRICT

Ninguna en CASCADE. Borrar un empleado o una sede con equipos o historial
detrás debe fallar, no propagarse en silencio. Las bajas son `activo = false`.

### `bytea` vía `customType`

drizzle-orm 0.45 no expone `bytea` en `pg-core`. Los dos campos cifrados
(`licencia_serial_cifrado`, `bios_password_cifrado`) lo necesitan: en `text`
habría que codificar en base64 y confiar en que cada lectura se acuerde de
decodificar.

### Campos de hardware como texto

`ram`, `disco`, `procesador` y `tamano_pantalla` son `text`. El origen trae
`"16 GB"`, `"512GB SSD"`, `"14\""`. Convertirlos a número exige interpretar, y
la etapa 1 no interpreta.

---

## Qué queda pendiente y de qué etapa es

| Pendiente | Etapa |
|---|---|
| El invariante «`En tránsito` ⟺ traslado abierto» (D1) cruza dos tablas: no cabe en un CHECK. Lo tiene que imponer la transacción | 5 |
| Escrituras en `auditoria`: la tabla existe, nadie la llena todavía | 3 y 7 |
| Cifrado AES-256-GCM de los dos campos `bytea`: las columnas están, la clave y las funciones no | 7 |
| `usuarios_app.password_hash` con bcrypt cost 12 | 3 |
