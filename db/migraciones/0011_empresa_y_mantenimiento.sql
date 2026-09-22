-- Etapa 5d — la empresa de cada colaborador, y el mantenimiento con sus dos
-- operaciones.

-- ---------------------------------------------------------------------------
-- 1. `empresa` en empleados (D28)
-- ---------------------------------------------------------------------------
--
-- Los 113 cargados quedan en 'Sin clasificar', que **es un valor legítimo y no
-- un hueco**: nadie ha dicho todavía de quién es cada persona, y poner 'RIWI'
-- por defecto sería inventarlo para 113 filas de golpe.
--
-- El DEFAULT hace lo mismo con los que entren mañana. Lo que evita que se
-- queden así para siempre no está aquí: es que el conteo se vea en la interfaz,
-- como la bandeja de revisión. Un valor más en un desplegable no lo mira nadie
-- —es lo que dejó 37 equipos en «licencia OK» hasta que la bandeja los puso
-- delante.

CREATE TYPE "public"."empresa" AS ENUM ('RIWI', 'BBL Labs', 'Sin clasificar');--> statement-breakpoint

ALTER TABLE "empleados"
  ADD COLUMN "empresa" "empresa" NOT NULL DEFAULT 'Sin clasificar';--> statement-breakpoint

COMMENT ON COLUMN "empleados"."empresa" IS
  'RIWI o BBL Labs. «Sin clasificar» es el valor de partida de los 113 cargados '
  'del Excel: nadie lo ha revisado todavía. No es un hueco de datos, es una '
  'tarea pendiente, y por eso se cuenta en la interfaz.';--> statement-breakpoint

CREATE INDEX "idx_empleados_empresa" ON "empleados" USING btree ("empresa");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Un parte cerrado sin retorno (D29)
-- ---------------------------------------------------------------------------
--
-- El enum tenía cuatro estados y ninguno para «fue al taller y no tiene
-- arreglo». Sin este valor, dar de baja un equipo irreparable obliga a cerrar
-- el parte como 'Devuelto' —que lo devolvería a 'Disponible'— y darlo de baja
-- después: un portátil muerto figuraría como disponible, aunque fuera un
-- minuto, y el inventario se puede leer en ese minuto.

ALTER TYPE "public"."estado_mantenimiento"
  ADD VALUE IF NOT EXISTS 'Baja tras revisión';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Un solo parte abierto por equipo
-- ---------------------------------------------------------------------------
--
-- La misma forma que `idx_movimientos_traslado_abierto` (D13) y por el mismo
-- motivo: desde que abrir un parte manda el equipo a 'En mantenimiento', dos
-- partes abiertos serían dos respuestas a «por qué está en el taller», y al
-- cerrar uno el equipo volvería con el otro todavía abierto.
--
-- El predicado enumera los estados ABIERTOS y no `<> 'Devuelto'`: así no
-- menciona el valor que se acaba de añadir, que Postgres no deja usar en la
-- misma transacción en que se crea.

CREATE UNIQUE INDEX "idx_mantenimientos_abierto"
  ON "mantenimientos" USING btree ("equipo_id")
  WHERE "estado" IN ('Pendiente', 'En taller', 'Completado');--> statement-breakpoint

COMMENT ON INDEX "idx_mantenimientos_abierto" IS
  'Un equipo no puede tener dos partes abiertos a la vez. Ver 0011 y D29.';
