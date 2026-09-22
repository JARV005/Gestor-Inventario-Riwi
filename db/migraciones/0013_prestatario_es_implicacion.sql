-- Etapa 5e — `prestado_a` pasa de equivalencia a implicación.
--
-- ---------------------------------------------------------------------------
-- Qué estaba mal
-- ---------------------------------------------------------------------------
--
-- La 0012 escribió esto:
--
--     (estado = 'Prestado') = (prestado_a IS NOT NULL)
--
-- una equivalencia, con el mismo argumento que la de `Asignado`: un equipo
-- prestado sin prestatario no dice a quién se prestó, y un prestatario sobre un
-- equipo disponible dice que alguien lo tiene mientras el inventario lo ofrece.
--
-- La segunda mitad es cierta. La primera **contradice una decisión ya tomada**:
-- D34 dice que la etiqueta `0798` entra con `estado = 'Prestado'`,
-- `prestado_a = NULL` y el motivo `PRESTATARIO_DESCONOCIDO`, porque el archivo
-- de origen dice que está prestado y no dice a quién. Es un dato incompleto,
-- no un dato incoherente.
--
-- Se descubrió al importar, no al escribir la CHECK: el caso del verificador
-- que la cubría comprobaba lo que yo había construido, no lo que estaba
-- decidido, así que salió verde. Es la diferencia entre probar el código y
-- probar la regla.
--
-- ---------------------------------------------------------------------------
-- Qué queda
-- ---------------------------------------------------------------------------
--
-- La implicación, que es la mitad verdadera:
--
--     prestado_a IS NOT NULL  ->  estado = 'Prestado'
--
-- Sigue rechazando lo que la base puede saber que está mal: un prestatario
-- sobre un equipo que no está prestado. Y sigue impidiendo lo que motivaba la
-- equivalencia — que `recuperar_prestamo` mueva el estado y deje el campo
-- puesto—, porque ese es justamente el caso que viola la implicación.
--
-- Lo que ya no hace es exigir un dato que el origen no tiene. Eso baja a
-- `verificar-datos.sql` grupo I, y en la forma que corresponde a un dato que
-- falta: **prestado sin prestatario Y SIN MARCAR**. Marcado es una tarea
-- pendiente; sin marcar es un error.

ALTER TABLE "equipos"
  DROP CONSTRAINT "equipos_prestado_implica_prestatario";--> statement-breakpoint

ALTER TABLE "equipos"
  ADD CONSTRAINT "equipos_prestatario_implica_prestado"
  CHECK (prestado_a IS NULL OR estado::text = 'Prestado');--> statement-breakpoint

COMMENT ON CONSTRAINT "equipos_prestatario_implica_prestado" ON "equipos" IS
  'Implicación, no equivalencia: un prestatario exige estado Prestado, pero un '
  'equipo prestado puede no saber a quién (D34). Ese hueco lo vigila '
  'verificar-datos grupo I, que solo lo cuenta como falla si además no está marcado.';
