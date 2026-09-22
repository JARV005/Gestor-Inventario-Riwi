-- Etapa 5e — préstamos entre empresas (D31, D32).
--
-- ---------------------------------------------------------------------------
-- Por qué las CHECK dicen `estado::text = 'Prestado'` y no `estado =
-- 'Prestado'`
-- ---------------------------------------------------------------------------
--
-- Postgres no deja **usar** un valor de enum en la misma transacción en la que
-- se añade: `unsafe use of new value "Prestado" of enum type estado_equipo`.
-- La 0011 lo esquivó no mencionando 'Baja tras revisión'; aquí no se puede
-- esquivar, porque la CHECK relajada tiene que nombrar 'Prestado'.
--
-- El primer intento fue partirlo en dos ficheros. **No funciona**: el migrador
-- de drizzle corre TODAS las migraciones pendientes en una sola transacción,
-- así que en una base recién creada —que es exactamente lo que hace `db:reset`
-- en esta etapa— las dos caen dentro de la misma y el error es idéntico.
-- Comprobado: con los dos ficheros, `npm run migrate` dejó las 12 anteriores
-- aplicadas y ninguna de las nuevas.
--
-- Comparar como texto sí vale, porque entonces 'Prestado' es una cadena y no
-- un valor de enum sin comprometer. Lo que se pierde es que Postgres valide el
-- literal: `estado::text = 'Prestadoo'` compilaría. Eso lo cubre
-- `verificar-esquema.sql`, que prueba cada una de estas CHECK por sus dos
-- lados y se pondría rojo con la errata.

-- ---------------------------------------------------------------------------
-- 1. `prestatario`: enum PROPIO, no el de `empresa` (D31)
-- ---------------------------------------------------------------------------
--
-- La tentación es reutilizar `empresa` y añadirle 'ISF'. No se hace, y el
-- motivo no es de estilo: `empleados.empresa` usa ese enum, y su conteo de
-- «Sin clasificar» es el mecanismo entero de D28. En cuanto el enum admita
-- 'ISF', un empleado puede quedar con `empresa = 'ISF'` y ese conteo deja de
-- ser «las tres claves, siempre».
--
-- ISF no es una sede ni un estado: es una empresa que recibe equipos prestados
-- y que no tiene empleados en este sistema.

CREATE TYPE "public"."prestatario" AS ENUM ('RIWI', 'BBL Labs', 'ISF');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `Prestado` en `estado_equipo` (D32)
-- ---------------------------------------------------------------------------
--
-- El sexto estado. Entra con sus dos operaciones —`prestar` y
-- `recuperar_prestamo`— y su movimiento, como manda D19: un estado sin puerta
-- de entrada es el hueco que ya apareció dos veces (`Reservado` en la 0000,
-- `En mantenimiento` hasta la 5d).

ALTER TYPE "public"."estado_equipo"
  ADD VALUE IF NOT EXISTS 'Prestado';--> statement-breakpoint

-- Sus dos movimientos. Sin ellos, `prestar` no tendría qué escribir en
-- `movimientos` y el estado entraría por la puerta que D19 cerró.

ALTER TYPE "public"."tipo_movimiento"
  ADD VALUE IF NOT EXISTS 'Préstamo';--> statement-breakpoint

ALTER TYPE "public"."tipo_movimiento"
  ADD VALUE IF NOT EXISTS 'Retorno de préstamo';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `empresa` y `prestado_a` en equipos (D31)
-- ---------------------------------------------------------------------------
--
-- Una fila por máquina física. Con dos filas —una en el inventario de cada
-- empresa— el mismo serial existiría en dos estados contradictorios y devolver
-- un préstamo obligaría a editar dos registros; es justo lo que el índice único
-- parcial de `serial` existe para impedir.
--
-- `empresa` es de quién es. `prestado_a` es quién lo tiene, NULL si no está
-- prestado. La vista de una empresa muestra `empresa = X OR prestado_a = X`.

ALTER TABLE "equipos"
  ADD COLUMN "empresa" "empresa" NOT NULL DEFAULT 'Sin clasificar';--> statement-breakpoint

ALTER TABLE "equipos"
  ADD COLUMN "prestado_a" "prestatario";--> statement-breakpoint

COMMENT ON COLUMN "equipos"."empresa" IS
  'De quién es el equipo. «Sin clasificar» es el valor de partida; tras la '
  'reimportación de la 5e debería quedar casi vacío, porque la empresa se '
  'deduce del archivo de origen.';--> statement-breakpoint

COMMENT ON COLUMN "equipos"."prestado_a" IS
  'Quién lo tiene, si no es su dueño. NULL cuando no está prestado, y una CHECK '
  'de esta misma migración lo ata a estado = ''Prestado'': son el mismo hecho.';--> statement-breakpoint

CREATE INDEX "idx_equipos_empresa" ON "equipos" USING btree ("empresa");--> statement-breakpoint

-- Parcial: los prestados son la minoría y es la columna por la que pregunta la
-- vista de una empresa. Sin el WHERE, el índice cubriría 217 filas para
-- responder por ocho.
CREATE INDEX "idx_equipos_prestado_a" ON "equipos" USING btree ("prestado_a")
  WHERE "prestado_a" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. La equivalencia de estado y responsable se relaja, y solo para 'Prestado'
-- ---------------------------------------------------------------------------
--
-- Estaba así desde la 0000:
--
--     (estado = 'Asignado') = (empleado_id IS NOT NULL)
--
-- Una equivalencia, deliberadamente: un equipo 'Asignado' sin responsable y un
-- responsable sobre un equipo 'Disponible' son el mismo error por sus dos
-- lados. Eso se mantiene.
--
-- Lo que no cabía es un equipo prestado CON responsable, y los datos lo exigen:
-- ocho filas del archivo de RIWI traen el nombre de quien tiene el portátil en
-- la mano —Daniel Gil, Angelo Gaviria, Carlos Castaño, Veronica Martinez,
-- Marlon García y los dos de ISF—. Con la equivalencia estricta, importarlas
-- obliga a tirar el nombre, y con `db:reset` no hay de dónde recuperarlo.
-- Perder a quien tiene el equipo es peor que un invariante más estrecho.
--
-- 'Prestado' es el ÚNICO estado donde `empleado_id` queda libre.
--
-- Las columnas van sin calificar: Postgres no admite "equipos"."estado" dentro
-- de un CHECK. Mismo motivo que en la 0000.

ALTER TABLE "equipos"
  DROP CONSTRAINT "equipos_asignado_implica_empleado";--> statement-breakpoint

ALTER TABLE "equipos"
  ADD CONSTRAINT "equipos_asignado_implica_empleado"
  CHECK (
    (estado = 'Asignado') = (empleado_id IS NOT NULL)
    OR estado::text = 'Prestado'
  );--> statement-breakpoint

COMMENT ON CONSTRAINT "equipos_asignado_implica_empleado" ON "equipos" IS
  'Equivalencia entre estado Asignado y tener responsable, con Prestado como '
  'única excepción (D31): un equipo prestado sigue en las manos de alguien y '
  'ese nombre no se tira en el import.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. `prestado_a` y 'Prestado' son el mismo hecho
-- ---------------------------------------------------------------------------
--
-- Equivalencia, no implicación, y por el mismo argumento que la de arriba: un
-- equipo 'Prestado' sin prestatario no dice a quién se le prestó, y un
-- prestatario sobre un equipo 'Disponible' dice que alguien lo tiene mientras
-- el inventario lo ofrece. Los dos son el mismo error por un lado y por otro.
--
-- Es lo que impide que `recuperar_prestamo` deje el campo puesto: si mueve el
-- estado y se olvida de `prestado_a`, la base lo rechaza en el UPDATE, no en
-- una revisión posterior.

ALTER TABLE "equipos"
  ADD CONSTRAINT "equipos_prestado_implica_prestatario"
  CHECK ((estado::text = 'Prestado') = (prestado_a IS NOT NULL));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Nadie se presta a sí mismo
-- ---------------------------------------------------------------------------
--
-- Un equipo de BBL «prestado a BBL» no es un préstamo: es una fila mal puesta
-- que además haría aparecer el equipo dos veces en la vista de su empresa,
-- porque el filtro es `empresa = X OR prestado_a = X`.
--
-- El cast a text es obligatorio aquí por otra razón: `empresa` y `prestatario`
-- son enums DISTINTOS —a propósito, ver arriba— y Postgres no compara dos
-- tipos enum sin él. `IS DISTINCT FROM` y no `<>` para que un `prestado_a`
-- NULL no vuelva la expresión NULL, que una CHECK acepta como si nada.

ALTER TABLE "equipos"
  ADD CONSTRAINT "equipos_prestado_a_no_es_su_empresa"
  CHECK (prestado_a IS NULL OR prestado_a::text IS DISTINCT FROM empresa::text);
