-- Equivalencia entre `equipos.requiere_revision` y la existencia de filas en
-- `equipos_motivos_revision`.
--
-- POR QUÉ UN TRIGGER Y NO UN CHECK
-- La 0002 lo tenía como CHECK, que era posible mientras los motivos vivían en
-- un `text[]` de la misma fila. Al pasarlos a tabla puente, la equivalencia
-- cruza dos tablas y Postgres no admite CHECK sobre otra tabla.
--
-- Y no puede degradarse a una comprobación en `verificar-datos.sql`, porque
-- `requiere_revision` no es solo la bandera de la bandeja: es el predicado de
-- los índices únicos parciales `equipos_serial_uk` y `equipos_etiqueta_uk`.
-- Desincronizarla no pierde una entrada en una lista de pendientes; deja pasar
-- en silencio un serial duplicado. Una constraint de la que depende otra
-- constraint no se protege con un test que corre cuando alguien se acuerda.
--
-- POR QUÉ DEFERIDO
-- El importador inserta el equipo y después sus motivos: entre las dos
-- sentencias, una fila marcada sin motivos es un estado legítimo e inevitable.
-- Un trigger inmediato reventaría a mitad de transacción en la carga normal.
-- DEFERRABLE INITIALLY DEFERRED mueve la comprobación al COMMIT, que es cuando
-- la transacción afirma estar completa.
--
-- Consecuencia para los tests: un fichero que termina en ROLLBACK nunca llega
-- al COMMIT, así que estos triggers no dispararían y los casos pasarían en
-- verde sin comprobar nada. `verificar-esquema.sql` los fuerza con
-- SET CONSTRAINTS ALL IMMEDIATE dentro de cada bloque.

CREATE OR REPLACE FUNCTION exigir_marca_coherente(p_equipo uuid) RETURNS void AS $$
DECLARE
  v_marca  boolean;
  v_tiene  boolean;
BEGIN
  SELECT requiere_revision INTO v_marca FROM equipos WHERE id = p_equipo;
  -- El equipo pudo borrarse en la misma transacción; entonces no hay nada que
  -- exigir y sus motivos se fueron por el ON DELETE CASCADE.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM equipos_motivos_revision WHERE equipo_id = p_equipo)
    INTO v_tiene;

  IF v_marca <> v_tiene THEN
    RAISE EXCEPTION
      'equipo %: requiere_revision=% pero motivos=%. La marca y sus motivos son el mismo hecho.',
      p_equipo, v_marca, v_tiene
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Dos funciones de trigger y no una con TG_TABLE_NAME: NEW tiene estructura
-- distinta en cada tabla y resolver el campo en tiempo de ejecución es
-- exactamente el tipo de fragilidad que este fichero existe para evitar.
CREATE OR REPLACE FUNCTION marca_coherente_desde_equipos() RETURNS trigger AS $$
BEGIN
  PERFORM exigir_marca_coherente(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION marca_coherente_desde_motivos() RETURNS trigger AS $$
BEGIN
  PERFORM exigir_marca_coherente(COALESCE(NEW.equipo_id, OLD.equipo_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Solo cuando requiere_revision cambia: sin el WHEN, cada UPDATE de cualquier
-- columna de equipos encolaría una comprobación diferida inútil, y la
-- importación hace 186.
CREATE CONSTRAINT TRIGGER trg_equipos_marca_coherente
  AFTER INSERT OR UPDATE OF requiere_revision ON equipos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION marca_coherente_desde_equipos();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_motivos_marca_coherente
  AFTER INSERT OR DELETE ON equipos_motivos_revision
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION marca_coherente_desde_motivos();
--> statement-breakpoint

-- updated_at para las dos tablas nuevas que lo llevan. La tabla puente no:
-- una fila suya no se edita, se crea o se borra.
CREATE TRIGGER trg_motivos_revision_updated_at BEFORE UPDATE ON motivos_revision
  FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
--> statement-breakpoint

CREATE TRIGGER trg_importaciones_updated_at BEFORE UPDATE ON importaciones
  FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
