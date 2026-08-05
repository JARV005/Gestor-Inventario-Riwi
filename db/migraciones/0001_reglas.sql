-- Reglas que drizzle-kit no modela y que por tanto se escriben a mano.
-- No las toca al hacer diff del esquema: solo compara tablas, columnas, índices
-- y restricciones. Funciones y triggers quedan fuera de su alcance.

-- ---------------------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------------------
-- El §2 pide created_at/updated_at en todas las tablas. Poner al día el segundo
-- desde la aplicación falla en cuanto algo escribe sin pasar por ella: el
-- importador de la etapa 2, un UPDATE manual de soporte, una restauración.
-- El trigger lo hace cierto siempre.

-- clock_timestamp() y no now(): now() es transaction_timestamp(), congelado al
-- abrir la transacción. Con él, una fila insertada y luego modificada dentro de
-- la misma transacción — el caso normal en las mutaciones del §4, que tocan
-- `equipos` y `movimientos` juntas — conservaría el updated_at del INSERT.
CREATE OR REPLACE FUNCTION tocar_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'usuarios_app', 'sedes', 'empleados', 'equipos',
    'movimientos', 'mantenimientos', 'actas', 'auditoria'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION tocar_updated_at()', t
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. movimientos es append-only
-- ---------------------------------------------------------------------------
-- El §2 dice "nunca se edita ni se borra". Pero D1 introduce una excepción real:
-- confirmar un traslado rellena `fecha_confirmacion` sobre la fila existente.
-- Son compatibles si se lee la regla por lo que protege — el hecho histórico,
-- no la fila entera. Así que:
--
--   - DELETE: prohibido, sin excepciones.
--   - UPDATE: solo puede cambiar `fecha_confirmacion`, y solo de NULL a un
--     valor. Cerrar un traslado ocurre una vez; reabrirlo sería reescribir el
--     pasado, que es justo lo que la tabla existe para impedir.
--
-- Si una etapa posterior necesita mutar algo más, se cambia con una migración
-- nueva, a la vista, y no con un UPDATE silencioso.

CREATE OR REPLACE FUNCTION movimientos_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'movimientos es append-only: no se puede borrar el movimiento %', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.fecha_confirmacion IS NOT NULL
     AND NEW.fecha_confirmacion IS DISTINCT FROM OLD.fecha_confirmacion THEN
    RAISE EXCEPTION
      'el movimiento % ya fue confirmado; su fecha_confirmacion no se reabre', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Todo lo demás debe quedar como estaba. Se comparan las filas completas
  -- neutralizando los dos campos que sí pueden cambiar, en vez de enumerar
  -- columna por columna: así una columna añadida en el futuro queda protegida
  -- por omisión y no por acordarse de incluirla aquí.
  IF to_jsonb(NEW) - 'fecha_confirmacion' - 'updated_at'
     IS DISTINCT FROM
     to_jsonb(OLD) - 'fecha_confirmacion' - 'updated_at' THEN
    RAISE EXCEPTION
      'movimientos es append-only: en % solo puede cambiar fecha_confirmacion', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- El trigger de updated_at se creó antes (BEFORE UPDATE, mismo evento). Con
-- igual momento, Postgres los dispara en orden alfabético de nombre:
-- trg_movimientos_append_only corre antes que trg_movimientos_updated_at. Por
-- eso la comparación de arriba ignora updated_at: en ese punto NEW aún trae el
-- valor viejo si nadie lo tocó, pero un UPDATE que lo fije a mano no debe poder
-- colarse como cambio legítimo.
CREATE TRIGGER trg_movimientos_append_only
  BEFORE UPDATE OR DELETE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION movimientos_append_only();
