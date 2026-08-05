-- Retira `equipos.motivos_revision text[]` y el CHECK de cardinalidad que la
-- 0002 le habia puesto. Sustituidos por la tabla puente de la 0004.
--
-- La equivalencia marca <=> motivos NO desaparece: se muda a un CONSTRAINT
-- TRIGGER deferido en la 0006, porque al cruzar dos tablas ya no cabe en un
-- CHECK. Es la parte facil de perder de este cambio.
--
-- Sin migracion de datos: se reimporta desde cero. Con filas dentro habria
-- hecho falta volcar el array a la tabla puente antes del DROP.
ALTER TABLE "equipos" DROP CONSTRAINT "equipos_revision_con_motivos";--> statement-breakpoint
CREATE INDEX "idx_equipos_importacion" ON "equipos" USING btree ("importacion_id");--> statement-breakpoint
ALTER TABLE "equipos" DROP COLUMN "motivos_revision";