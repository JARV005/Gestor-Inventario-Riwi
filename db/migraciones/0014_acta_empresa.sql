-- Etapa 5f — la empresa entra en la instantánea del acta (D36, D39).
--
-- ---------------------------------------------------------------------------
-- Por qué esto no es opcional
-- ---------------------------------------------------------------------------
--
-- El formato aprobado imprime la empresa en dos sitios: el LOGO del encabezado
-- (de quién es el acta) y la columna «Propietario» de la sección 4 (de quién es
-- cada equipo, fila a fila). No son el mismo dato — un acta de RIWI puede
-- entregar un portátil de BBL que RIWI tiene prestado.
--
-- Y las dos entran en los bytes del PDF, así que entran en el hash.
--
-- `recalcularHash` regenera el acta desde su instantánea para comprobar que el
-- PDF guardado no se ha tocado. Si la instantánea no trae la empresa, la
-- regeneración usa otro logo o deja la columna vacía, los bytes salen distintos
-- y la comprobación diría **que el documento no cuadra**. Es el peor modo de
-- fallo posible para esa función: no revienta, acusa. Alguien miraría un acta
-- legítima y concluiría que la habían manipulado.
--
-- La instantánea de la 5a (D14, D23) se congeló sin estas columnas porque el
-- formato de entonces no imprimía la empresa. Ahora la imprime.
--
-- `actas` está VACÍA tras la reimportación de la 5e —comprobado antes de
-- escribir esto: 0 actas, 0 líneas, 0 contadores— así que el DEFAULT no está
-- rellenando nada real.

ALTER TABLE "actas"
  ADD COLUMN "empresa" "empresa" NOT NULL DEFAULT 'Sin clasificar';--> statement-breakpoint

COMMENT ON COLUMN "actas"."empresa" IS
  'De quién es el acta. Decide el logo del encabezado y forma parte del hash. '
  'Sale del empleado, no de los equipos: el documento va dirigido a alguien de '
  'una empresa y sus equipos pueden ser de otra.';--> statement-breakpoint

ALTER TABLE "actas_equipos"
  ADD COLUMN "empresa" "empresa" NOT NULL DEFAULT 'Sin clasificar';--> statement-breakpoint

COMMENT ON COLUMN "actas_equipos"."empresa" IS
  'Columna «Propietario» de la sección 4, congelada con el resto de la '
  'instantánea (D14): si mañana el equipo cambia de dueño, el acta sigue '
  'diciendo lo que decía el día que se firmó.';
