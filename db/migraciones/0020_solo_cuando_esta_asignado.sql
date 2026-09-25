-- Acota la regla de la 0018 al estado `Asignado`.
--
-- ===========================================================================
-- QUÉ ROMPIÓ LA 0018
-- ===========================================================================
--
-- `equipos.empleado_id` significa DOS cosas según el estado, y la CHECK
-- `equipos_asignado_implica_empleado` lo dice sin ambigüedad:
--
--   CHECK (((estado = 'Asignado') = (empleado_id IS NOT NULL))
--          OR estado = 'Prestado')
--
-- La equivalencia vale para todos los estados menos `Prestado`, que queda
-- exento a propósito: ahí `empleado_id` no es el responsable, es **quién tiene
-- el equipo físicamente mientras está prestado**, y lo escribe `fijarTenedor`.
--
-- La 0018 miraba solo `empleado_id IS NOT NULL`, así que trataba las dos cosas
-- como la misma y rechazaba algo legítimo: un equipo marcado
-- `RESPONSABLE_EN_CONFLICTO` —los dos archivos nombran a personas distintas y no
-- se eligió ninguna—, prestado a ISF, al que alguien le anota quién lo tiene.
-- Anotar quién lo tiene durante un préstamo no decide de quién es, así que el
-- motivo sigue abierto con razón y no hay ninguna contradicción.
--
-- Lo descubrió un test que ya existía —«fijar quien tiene un equipo prestado, y
-- solo si esta prestado»— al pasar de 200 a 409. No lo encontró una revisión del
-- código nuevo: lo encontró el código viejo dejando de funcionar.
--
-- El caso del 0468 sigue cogido: estaba `Asignado`.

CREATE OR REPLACE FUNCTION exigir_responsable_vs_motivos(p_equipo uuid) RETURNS void AS $$
DECLARE
  v_estado   text;
  v_empleado uuid;
  v_codigos  text;
BEGIN
  SELECT estado::text, empleado_id INTO v_estado, v_empleado
    FROM equipos WHERE id = p_equipo;
  -- El equipo pudo borrarse en la misma transacción; sus motivos se fueron con
  -- él por el ON DELETE CASCADE y no hay nada que exigir.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Solo cuando `empleado_id` significa «el responsable», que es exactamente
  -- cuando el estado es `Asignado`. En `Prestado` significa «quién lo tiene» y
  -- no contradice a ningún motivo; en los demás estados la CHECK lo obliga a
  -- estar vacío, así que no hay nada que comprobar.
  IF v_estado <> 'Asignado' OR v_empleado IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(emr.motivo_codigo, ', ' ORDER BY emr.motivo_codigo)
    INTO v_codigos
  FROM equipos_motivos_revision emr
  JOIN motivos_revision mr ON mr.codigo = emr.motivo_codigo
  WHERE emr.equipo_id = p_equipo
    AND mr.implica_sin_responsable;

  IF v_codigos IS NOT NULL THEN
    RAISE EXCEPTION
      'equipo %: esta Asignado a alguien y sigue marcado con %. Un motivo que dice que no se sabe quien lo tiene no puede convivir con un responsable: la operacion que lo asigno debe retirarlo.',
      p_equipo, v_codigos
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- El trigger de `equipos` tenía `UPDATE OF empleado_id`. Ahora la condición
-- también depende de `estado`, así que un cambio de estado que deje el
-- responsable puesto —no existe hoy, porque la CHECK lo impide, pero la
-- condición del trigger no debería depender de eso— tiene que despertarla.
DROP TRIGGER IF EXISTS trg_equipos_responsable_vs_motivos ON equipos;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_equipos_responsable_vs_motivos
  AFTER INSERT OR UPDATE OF empleado_id, estado ON equipos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION responsable_vs_motivos_desde_equipos();
--> statement-breakpoint

-- Y se vuelve a afirmar, con la condición acotada, que no queda ninguna fila
-- contradicha. La 0019 ya limpió con la condición ancha; esto es por si la
-- diferencia dejó algo, y para que la garantía siga escrita en el último sitio
-- que tocó la regla.
DO $$
DECLARE
  v_quedan integer;
BEGIN
  SELECT count(*) INTO v_quedan
  FROM equipos e
  JOIN equipos_motivos_revision emr ON emr.equipo_id = e.id
  JOIN motivos_revision mr ON mr.codigo = emr.motivo_codigo
  WHERE e.estado = 'Asignado' AND e.empleado_id IS NOT NULL AND mr.implica_sin_responsable;

  IF v_quedan > 0 THEN
    RAISE EXCEPTION
      '0020: quedan % equipos Asignados con un motivo que dice que no se sabe quien los tiene.',
      v_quedan
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
