-- Un equipo con responsable no puede llevar un motivo que diga que no se sabe
-- quién lo tiene.
--
-- ===========================================================================
-- QUÉ FILA EXISTÍA Y NO DEBERÍA
-- ===========================================================================
--
-- El equipo 0468 quedó `Asignado`, con responsable, y con
-- `ASIGNADO_SIN_RESPONSABLE` y `RESPONSABLE_NO_PERSONA` puestos. Lo hizo la
-- propia aplicación: `movimientos` lo atribuye a una `Asignación` desde la
-- interfaz, no al importador. Asignar ponía el responsable y no tocaba los
-- motivos, así que la fila afirmaba dos cosas incompatibles a la vez y
-- `verificar-datos.sql` salía en rojo por ella.
--
-- El arreglo en el repositorio (`retirarMotivosResueltos`) es la mitad. Esta es
-- la otra: **la base rechaza la combinación venga de donde venga**. Un `if` en
-- `asignar` protege a `asignar`; esto protege también al próximo endpoint, al
-- importador y a un UPDATE a mano.
--
-- ===========================================================================
-- POR QUÉ NO HAY UNA LISTA DE CÓDIGOS EN ESTE FICHERO
-- ===========================================================================
--
-- La condición se lee de `motivos_revision.implica_sin_responsable`, que la
-- siembra escribe desde el campo del mismo nombre en `db/motivos.ts`. Escribir
-- aquí `IN ('ASIGNADO_SIN_RESPONSABLE', …)` sería una segunda lista: el día que
-- se añada un motivo, el repositorio lo retiraría y el trigger no lo
-- protegería, o al revés. Es el mismo error que tuvo `Operacion` copiado a mano
-- en `src/types.ts`.
--
-- ===========================================================================
-- POR QUÉ DEFERIDO
-- ===========================================================================
--
-- `mutar` hace el UPDATE de `equipos` primero —que es donde se pone el
-- responsable— y retira los motivos después. Entre las dos sentencias la fila
-- es incoherente, y es un estado legítimo e inevitable dentro de la
-- transacción. Un trigger inmediato reventaría en la asignación normal.
--
-- Consecuencia para los tests, la misma que la 0006: un fichero que termina en
-- ROLLBACK no llega al COMMIT, así que estos triggers no dispararían y los
-- casos pasarían en verde sin comprobar nada. `verificar-esquema.sql` los
-- fuerza con SET CONSTRAINTS ALL IMMEDIATE dentro de cada bloque.

ALTER TABLE motivos_revision
  ADD COLUMN implica_sin_responsable boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Los cuatro que hay hoy. Va aquí y no solo en la siembra porque una base ya
-- creada no vuelve a sembrarse por sí sola, y sin esto el trigger no protegería
-- nada en las bases existentes hasta que alguien corriera `npm run seed`.
--
-- Cada uno lo afirma en su propia descripción, y `verificar-datos.sql` ya
-- comprobaba `empleado_id IS NOT NULL` como falla en los tres primeros.
UPDATE motivos_revision SET implica_sin_responsable = true
WHERE codigo IN (
  -- «Estado "Asignado" sin responsable»
  'ASIGNADO_SIN_RESPONSABLE',
  -- «USUARIO RESPONSABLE contenía un marcador en vez de un nombre»
  'RESPONSABLE_NO_PERSONA',
  -- «La fila traía responsable pero un estado que no es "Asignado"». El vínculo
  -- no se creó: el nombre está en notas, no en la FK.
  'RESPONSABLE_EN_ESTADO_NO_ASIGNADO',
  -- «Los dos archivos nombran a personas DISTINTAS. No se eligió ninguna»
  'RESPONSABLE_EN_CONFLICTO'
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION exigir_responsable_vs_motivos(p_equipo uuid) RETURNS void AS $$
DECLARE
  v_empleado uuid;
  v_codigos  text;
BEGIN
  SELECT empleado_id INTO v_empleado FROM equipos WHERE id = p_equipo;
  -- El equipo pudo borrarse en la misma transacción; sus motivos se fueron con
  -- él por el ON DELETE CASCADE y no hay nada que exigir.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Sin responsable no hay contradicción posible: el motivo puede estar abierto
  -- tranquilamente, que es el estado en que el importador deja a 224 equipos.
  IF v_empleado IS NULL THEN
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
      'equipo %: tiene responsable y sigue marcado con %. Un motivo que dice que no se sabe quién lo tiene no puede convivir con un responsable: la operación que lo asignó debe retirarlo.',
      p_equipo, v_codigos
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Dos funciones de trigger y no una con TG_TABLE_NAME, por lo mismo que la
-- 0006: NEW tiene estructura distinta en cada tabla.
CREATE OR REPLACE FUNCTION responsable_vs_motivos_desde_equipos() RETURNS trigger AS $$
BEGIN
  PERFORM exigir_responsable_vs_motivos(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION responsable_vs_motivos_desde_motivos() RETURNS trigger AS $$
BEGIN
  PERFORM exigir_responsable_vs_motivos(NEW.equipo_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- `UPDATE OF empleado_id` y no de cualquier columna: sin el WHEN, cada UPDATE
-- de `equipos` encolaría una comprobación diferida inútil, y la importación
-- hace cientos.
CREATE CONSTRAINT TRIGGER trg_equipos_responsable_vs_motivos
  AFTER INSERT OR UPDATE OF empleado_id ON equipos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION responsable_vs_motivos_desde_equipos();
--> statement-breakpoint

-- Solo INSERT: borrar un motivo nunca crea esta contradicción, la resuelve.
CREATE CONSTRAINT TRIGGER trg_motivos_responsable_vs_motivos
  AFTER INSERT ON equipos_motivos_revision
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION responsable_vs_motivos_desde_motivos();
