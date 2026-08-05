-- Etapa 2. Dos cambios que exigieron los datos reales del Excel.
--
-- 1. `condicion_equipo` gana 'Usado'. La hoja de perifericos trae 48 filas
--    USADO y 13 NUEVO. Mapear USADO a 'Bueno' seria inventar una valoracion
--    que nadie hizo; dejarlo NULL tiraria un dato real.
--
-- 2. `motivos_revision` en plural. Las 126 filas producen 60 marcadas con 84
--    motivos entre todas: hay filas que fallan por varias razones a la vez y
--    un TEXT solo guarda una. El CHECK ata la marca a su explicacion.
--
-- El cambio va partido en dos migraciones (esta anade, la 0003 retira la
-- columna vieja) y no en una sola porque drizzle-kit necesita una consola
-- interactiva para preguntar si un DROP+ADD es un rename, y aqui no la hay.
-- Partirlo asi deja ademas un estado intermedio coherente: la 0002 solo anade.
ALTER TYPE "public"."condicion_equipo" ADD VALUE 'Usado' BEFORE 'Requiere reparación';--> statement-breakpoint
ALTER TABLE "equipos" ADD COLUMN "motivos_revision" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "equipos" ADD CONSTRAINT "equipos_revision_con_motivos" CHECK (requiere_revision = (cardinality(motivos_revision) > 0));
