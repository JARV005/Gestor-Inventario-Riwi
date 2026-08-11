-- Etapa 5a — el acta se puede emitir, y lo que dice queda congelado.
--
-- Tres cosas, y las tres son la misma preocupación: un acta es un documento
-- sobre algo que ya ocurrió, y tiene que seguir diciendo lo mismo dentro de un
-- año aunque la base haya cambiado debajo.
--
-- `actas` y `actas_equipos` están vacías en las dos bases (comprobado antes de
-- escribir esto: 0 filas), así que las columnas NOT NULL entran sin DEFAULT y
-- sin conversión.

-- ---------------------------------------------------------------------------
-- 1. La instantánea no era solo del equipo (D23)
-- ---------------------------------------------------------------------------
--
-- La 0008 congeló etiqueta, serial, marca y modelo. Falta todo lo demás que el
-- acta imprime, y falta la persona entera.
--
-- El cuerpo del acta (pendientes.md, etapa 5) dice: nombre, cargo y documento
-- del colaborador; equipo, serial, especificaciones y estado físico. De eso,
-- hoy solo cuatro campos están congelados. Los demás se leerían de `equipos` y
-- `empleados` al pintarlo, y entonces corregir el cargo de alguien en marzo
-- cambiaría el acta que firmó en enero — que es exactamente lo que la
-- instantánea existe para impedir, aplicado a media tabla.
--
-- Qué NO se congela y por qué: nada que el acta no imprima. La instantánea es
-- la copia de lo que el documento dice, no un duplicado de la fila.

ALTER TABLE "actas"
  ADD COLUMN "empleado_nombre" text NOT NULL,
  ADD COLUMN "empleado_cedula" text,
  ADD COLUMN "empleado_cargo"  text,
  ADD COLUMN "empleado_area"   text,
  ADD COLUMN "sede_nombre"     text,
  ADD COLUMN "generada_por_nombre" text NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN "actas"."empleado_nombre" IS
  'Instantánea: lo que el acta DICE, copiado al emitirla. No se lee de empleados: '
  'corregir un nombre no puede cambiar un acta ya emitida. La FK empleado_id sigue '
  'ahí para saber de quién es; esto es para saber qué se firmó.';--> statement-breakpoint

ALTER TABLE "actas_equipos"
  ADD COLUMN "categoria"         "categoria_equipo" NOT NULL,
  ADD COLUMN "condicion"         "condicion_equipo",
  ADD COLUMN "procesador"        text,
  ADD COLUMN "ram"               text,
  ADD COLUMN "disco"             text,
  ADD COLUMN "sistema_operativo" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. El acta va atada al movimiento que la origina (D24)
-- ---------------------------------------------------------------------------
--
-- Un acta se emite sobre una operación que ya ocurrió: una entrega es la
-- `Asignación`, una devolución es la `Devolución`. Sin la atadura, dentro de un
-- año hay actas que nadie sabe a qué entrega corresponden — y al revés,
-- movimientos de los que nadie sabe si se firmó papel.
--
-- Va en `actas_equipos` y no en `movimientos.acta_id`, que es la que había:
--
--   - Un acta cubre N equipos y cada equipo tiene SU movimiento. La fila por
--     equipo es donde vive ese par; en `movimientos` habría que recorrer la
--     tabla al revés para saber qué cubre un acta.
--   - `movimientos` es append-only y su trigger solo deja cambiar
--     `fecha_confirmacion`. Escribir `acta_id` después de insertar el
--     movimiento exigiría relajar el trigger por segunda vez. El acta se emite
--     DESPUÉS del movimiento, siempre, así que esa columna no se podía rellenar
--     sin tocar la regla que protege el historial.
--
-- Se borra `movimientos.acta_id` en vez de dejarla muerta: dos columnas para el
-- mismo vínculo, una de ellas imposible de escribir, es el montaje que acaba en
-- dos respuestas distintas a la misma pregunta. Nunca tuvo un valor (0 de 190
-- filas en desarrollo, comprobado).

ALTER TABLE "movimientos" DROP COLUMN "acta_id";--> statement-breakpoint

-- UNIQUE sobre (id, equipo_id) no añade unicidad —`id` ya es la PK— pero es lo
-- que permite la FK compuesta de abajo.
ALTER TABLE "movimientos"
  ADD CONSTRAINT "movimientos_id_equipo_uq" UNIQUE ("id", "equipo_id");--> statement-breakpoint

ALTER TABLE "actas_equipos"
  ADD COLUMN "movimiento_id" uuid NOT NULL;--> statement-breakpoint

-- FK COMPUESTA, y esto es el punto: `(movimiento_id, equipo_id)` juntos. Con
-- dos FK sueltas se podría atar el acta de un equipo al movimiento de OTRO, y
-- eso no lo vería nadie hasta que alguien leyera el acta. Así Postgres lo
-- rechaza en el INSERT.
ALTER TABLE "actas_equipos"
  ADD CONSTRAINT "actas_equipos_movimiento_del_mismo_equipo"
  FOREIGN KEY ("movimiento_id", "equipo_id")
  REFERENCES "movimientos"("id", "equipo_id") ON DELETE RESTRICT;--> statement-breakpoint

COMMENT ON CONSTRAINT "actas_equipos_movimiento_del_mismo_equipo" ON "actas_equipos" IS
  'Compuesta a propósito: ata el acta al movimiento DE ESE equipo. Con dos FK '
  'sueltas se podría firmar el acta de un portátil contra la asignación de otro.';--> statement-breakpoint

-- Un movimiento se firma una vez. Dos actas sobre la misma entrega son dos
-- papeles que dicen lo mismo con distinto número, y el día que discrepen no hay
-- forma de saber cuál vale.
CREATE UNIQUE INDEX "idx_actas_equipos_movimiento"
  ON "actas_equipos" USING btree ("movimiento_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. El consecutivo, sin huecos y sin repetidos (D25)
-- ---------------------------------------------------------------------------
--
-- Un contador por año en su tabla, y NO una SEQUENCE.
--
-- `nextval()` es inmune a los duplicados pero deja huecos: no participa en la
-- transacción, así que un acta que falle después de pedir el número se lleva
-- ese número a la tumba. Para un consecutivo de documentos, un hueco es una
-- pregunta que alguien tendrá que responder («¿dónde está el acta 47?») y la
-- respuesta «se perdió en un rollback» no sirve.
--
-- La fila del contador se actualiza DENTRO de la transacción del acta:
--
--   INSERT INTO actas_consecutivo (anio, valor) VALUES ($1, 1)
--   ON CONFLICT (anio) DO UPDATE SET valor = actas_consecutivo.valor + 1
--   RETURNING valor;
--
-- El UPDATE toma el bloqueo de fila hasta el COMMIT, así que dos peticiones
-- simultáneas se serializan: la segunda espera y recibe el siguiente número.
-- Si la transacción aborta, el incremento se deshace con ella y el número se
-- reutiliza. Ni repetidos ni huecos.
--
-- El precio es que emitir actas se serializa. Con tres personas en la
-- aplicación no se nota, y la alternativa es un número repetido en un documento
-- que se firma.
--
-- El UNIQUE de `actas.consecutivo` (0000) sigue siendo la última red: si esta
-- lógica se rompiera, el INSERT falla en vez de duplicar.

CREATE TABLE "actas_consecutivo" (
  "anio"  integer PRIMARY KEY,
  "valor" integer NOT NULL,
  CONSTRAINT "actas_consecutivo_positivo" CHECK ("valor" > 0)
);--> statement-breakpoint

COMMENT ON TABLE "actas_consecutivo" IS
  'Contador por año del consecutivo de actas. Tabla y no SEQUENCE a propósito: '
  'nextval no se deshace con la transacción y dejaría huecos en la numeración '
  'de un documento firmable. Ver 0009 y decisiones-04 D25.';
