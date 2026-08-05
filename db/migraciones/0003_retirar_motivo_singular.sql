-- Retira `motivo_revision` (singular, TEXT), sustituida por `motivos_revision`
-- en la 0002. Va aparte por el motivo explicado alli.
--
-- No hay migracion de datos porque la tabla esta vacia: la importacion de la
-- etapa 2 aun no ha corrido. Si hubiera filas, este DROP perderia informacion
-- y haria falta un UPDATE que trasladara el texto al array antes de soltarlo.
ALTER TABLE "equipos" DROP COLUMN "motivo_revision";
