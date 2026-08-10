-- Etapa 5. Tres cambios de esquema, todos de `docs/decisiones-04.md`.
--
-- 1. D13: `En tránsito` sale de `estado_equipo`. Deja de ser algo que alguien
--    pone a mano y pasa a derivarse de la existencia de un traslado abierto.
-- 2. D13: el índice de traslados abiertos pasa a UNIQUE. Derivar el estado no
--    sirve de nada si dos traslados abiertos del mismo equipo siguen siendo
--    posibles: la derivación diría «viajando» sin decir hacia dónde.
-- 3. D14 y D15: las actas dejan de guardar sus equipos en un array y su PDF en
--    una ruta de disco.
--
-- Y dos valores nuevos en `tipo_movimiento` para que `Reservado` deje de ser un
-- estado del que se puede salir pero al que no se puede entrar.

-- ---------------------------------------------------------------------------
-- 1. `En tránsito` fuera de estado_equipo
-- ---------------------------------------------------------------------------
--
-- Postgres no sabe quitar un valor de un enum: hay que crear el tipo nuevo,
-- mover la columna y tirar el viejo. El CHECK se cae antes porque referencia el
-- tipo, y se vuelve a poner idéntico después — no cambia, solo estorba.
--
-- El `USING ... ::text::estado_equipo` revienta si queda alguna fila con el
-- valor retirado, que es lo que queremos: mejor que la migración falle a que
-- convierta a un estado inventado. Aun así se comprueba antes, para que el
-- mensaje diga qué hacer en vez de «invalid input value for enum».

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM equipos WHERE estado = 'En tránsito';
  IF n > 0 THEN
    RAISE EXCEPTION
      'Hay % equipos en estado "En tránsito". D13 lo retira: cada uno necesita '
      'un movimiento Traslado abierto y su estado real (Disponible o Asignado) '
      'antes de migrar. Ver docs/decisiones-04.md.', n;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "equipos" DROP CONSTRAINT "equipos_asignado_implica_empleado";--> statement-breakpoint

ALTER TYPE "public"."estado_equipo" RENAME TO "estado_equipo_viejo";--> statement-breakpoint

CREATE TYPE "public"."estado_equipo" AS ENUM('Disponible', 'Asignado', 'En mantenimiento', 'Reservado', 'De baja');--> statement-breakpoint

ALTER TABLE "equipos"
  ALTER COLUMN "estado" TYPE "public"."estado_equipo"
  USING "estado"::text::"public"."estado_equipo";--> statement-breakpoint

DROP TYPE "public"."estado_equipo_viejo";--> statement-breakpoint

-- Idéntico al que había. `estado` responde de quién es el equipo; ya no
-- compite con «dónde está» por la misma columna.
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_asignado_implica_empleado"
  CHECK (("estado" = 'Asignado') = ("empleado_id" IS NOT NULL));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Un equipo no puede tener dos traslados abiertos
-- ---------------------------------------------------------------------------
--
-- Era un índice normal. Con `En tránsito` derivado del traslado abierto, dos
-- traslados abiertos a la vez no son un dato feo: son una contradicción sobre
-- dónde está el equipo. Lo impide Postgres en el INSERT, no un verificador que
-- corre cuando alguien se acuerda.

DROP INDEX "idx_movimientos_traslado_abierto";--> statement-breakpoint

CREATE UNIQUE INDEX "idx_movimientos_traslado_abierto"
  ON "movimientos" USING btree ("equipo_id")
  WHERE "tipo" = 'Traslado' AND "fecha_confirmacion" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `Reserva` y `Liberación` en tipo_movimiento
-- ---------------------------------------------------------------------------
--
-- `Reservado` existía en `estado_equipo` desde la 0000 y ningún movimiento
-- podía producirlo: se podía salir pero no entrar. El importador dejó uno así
-- y nadie más podía crear otro.
--
-- `Liberación` y no `Devolución`: devolver es lo que hace alguien que tenía el
-- equipo. Liberar una reserva no devuelve nada, porque nadie llegó a tenerlo.

ALTER TYPE "public"."tipo_movimiento" ADD VALUE IF NOT EXISTS 'Reserva';--> statement-breakpoint
ALTER TYPE "public"."tipo_movimiento" ADD VALUE IF NOT EXISTS 'Liberación';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Actas: tabla puente con instantánea, y el PDF dentro de la base
-- ---------------------------------------------------------------------------
--
-- D14. El array `equipos_ids` congelaba el documento pero no tenía FK, así que
-- «toda acta apunta a equipos que existen» no se podía imponer ni comprobar.
-- Una puente a secas tendría FK y perdería lo que el array protegía: si mañana
-- se corrige un serial, el acta ya firmada mostraría otro.
--
-- Las columnas de instantánea son lo que el acta DICE, copiado al generarla.
-- La FK garantiza que el equipo existe; la instantánea, que el documento no
-- cambia. `actas` está vacía, así que no hay nada que convertir.

CREATE TABLE "actas_equipos" (
  "acta_id"   uuid NOT NULL REFERENCES "actas"("id")   ON DELETE RESTRICT,
  "equipo_id" uuid NOT NULL REFERENCES "equipos"("id") ON DELETE RESTRICT,
  "etiqueta"  text,
  "serial"    text,
  "marca"     text,
  "modelo"    text,
  CONSTRAINT "actas_equipos_pk" PRIMARY KEY ("acta_id", "equipo_id")
);--> statement-breakpoint

CREATE INDEX "idx_actas_equipos_equipo" ON "actas_equipos" USING btree ("equipo_id");--> statement-breakpoint

ALTER TABLE "actas" DROP COLUMN "equipos_ids";--> statement-breakpoint

-- D15. El PDF vive en la fila y no en disco. El §5 exige probar la
-- restauración de un backup, y un fichero suelto es una segunda cosa que
-- restaurar en paso con lo que lo referencia: un pg_dump verde sobre una base
-- cuyos PDF quedaron en otro disco es una restauración a medias que no lo
-- parece.
--
-- Nullable las dos: el acta se crea con sus equipos y su consecutivo, y el PDF
-- se genera después dentro de la misma transacción. Un NOT NULL obligaría a
-- tener los bytes antes de tener el id, y el id va impreso en el documento.
-- Que las dos estén puestas a la vez lo impone el CHECK de abajo.

ALTER TABLE "actas" DROP COLUMN "pdf_path";--> statement-breakpoint
ALTER TABLE "actas" ADD COLUMN "pdf" bytea;--> statement-breakpoint

-- O están el documento y su hash, o no está ninguno de los dos. Un PDF sin
-- hash no se puede verificar; un hash sin PDF no verifica nada.
ALTER TABLE "actas" ADD CONSTRAINT "actas_pdf_con_hash"
  CHECK (("pdf" IS NULL) = ("hash_sha256" IS NULL));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. El RESTRICT de auditoría es deliberado
-- ---------------------------------------------------------------------------
--
-- Sin esto, dentro de un año alguien recibe un error de FK al intentar borrar
-- un usuario y lo «arregla» cambiando el RESTRICT por CASCADE, que es
-- exactamente lo que no debe pasar. El comentario vive en la base, así que
-- aparece en un `\d+ auditoria` sin tener que encontrar el documento.

COMMENT ON CONSTRAINT "auditoria_usuario_app_id_usuarios_app_id_fk" ON "auditoria" IS
  'RESTRICT deliberado (decisiones-04.md D18): un rastro que se borra borrando al usuario no es un rastro. Dar de baja a alguien es activo = false, que corta sus sesiones en el acto. Los usuarios no se borran nunca.';--> statement-breakpoint

COMMENT ON CONSTRAINT "movimientos_usuario_app_id_usuarios_app_id_fk" ON "movimientos" IS
  'RESTRICT deliberado (decisiones-04.md D18): el autor de un movimiento no puede desaparecer del historial. Dar de baja a alguien es activo = false.';
