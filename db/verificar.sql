-- Comprueba que los invariantes del esquema los impone la base de datos y no
-- la buena voluntad de quien escriba el INSERT. `npm run db:verificar`.
--
-- Todo ocurre dentro de una transacción que termina en ROLLBACK: no deja ni una
-- fila. Se puede correr contra la BD de desarrollo con datos dentro.
--
-- Correrlo después de cada migración que toque restricciones o triggers.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE resultado(caso text, esperado text, obtenido text);

DO $$
DECLARE
  v_sede uuid;
  v_emp  uuid;
  v_eq   uuid;
  v_eq2  uuid;
  v_dup1 uuid;
  v_dup2 uuid;
  v_usr  uuid;
  v_mov  uuid;
  v_upd1 timestamptz;
  v_upd2 timestamptz;
BEGIN
  SELECT id INTO v_sede FROM sedes WHERE nombre = 'Medellín';
  SELECT id INTO v_usr  FROM usuarios_app WHERE email = 'sistema@bbl.local';

  INSERT INTO empleados (nombre, sede_id) VALUES ('Prueba Temporal', v_sede) RETURNING id INTO v_emp;

  -- 1. CHECK: 'Asignado' sin responsable debe rebotar
  BEGIN
    INSERT INTO equipos (categoria, estado) VALUES ('Portátil', 'Asignado');
    INSERT INTO resultado VALUES ('CHECK: Asignado sin empleado', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: Asignado sin empleado', 'rechazado', 'rechazado');
  END;

  -- 2. CHECK: responsable sobre un equipo 'Disponible' debe rebotar
  BEGIN
    INSERT INTO equipos (categoria, estado, empleado_id) VALUES ('Portátil', 'Disponible', v_emp);
    INSERT INTO resultado VALUES ('CHECK: Disponible con empleado', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: Disponible con empleado', 'rechazado', 'rechazado');
  END;

  -- 3. CHECK: la combinación válida debe pasar
  INSERT INTO equipos (categoria, estado, empleado_id, sede_id)
    VALUES ('Portátil', 'Asignado', v_emp, v_sede) RETURNING id INTO v_eq;
  INSERT INTO resultado VALUES ('CHECK: Asignado con empleado', 'aceptado', 'aceptado');

  -- 4. serial NULL repetido: varios vacíos conviven
  INSERT INTO equipos (categoria, estado, serial) VALUES ('Monitor', 'Disponible', NULL);
  INSERT INTO equipos (categoria, estado, serial) VALUES ('Monitor', 'Disponible', NULL)
    RETURNING id INTO v_eq2;
  INSERT INTO resultado VALUES ('serial: dos NULL conviven', 'aceptado', 'aceptado');

  -- 5. serial duplicado entre filas ya limpias: debe rebotar
  BEGIN
    INSERT INTO equipos (categoria, estado, serial) VALUES ('Monitor', 'Disponible', 'SN-DUP');
    INSERT INTO equipos (categoria, estado, serial) VALUES ('Monitor', 'Disponible', 'SN-DUP');
    INSERT INTO resultado VALUES ('serial: duplicado sin marcar', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('serial: duplicado sin marcar', 'rechazado', 'rechazado');
  END;

  -- 5a. El caso real que hunde la etapa 2 si el índice está mal: GH14W64 viene
  -- repetido en el Excel y las dos filas tienen que poder entrar marcadas.
  BEGIN
    INSERT INTO equipos (categoria, estado, serial, requiere_revision, motivo_revision)
      VALUES ('Portátil', 'Disponible', 'GH14W64', true, 'serial duplicado en el origen')
      RETURNING id INTO v_dup1;
    INSERT INTO equipos (categoria, estado, serial, requiere_revision, motivo_revision)
      VALUES ('Portátil', 'Disponible', 'GH14W64', true, 'serial duplicado en el origen')
      RETURNING id INTO v_dup2;
    INSERT INTO resultado VALUES ('(a) GH14W64 x2 marcadas', 'aceptado', 'aceptado');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('(a) GH14W64 x2 marcadas', 'aceptado', 'RECHAZADO');
  END;

  INSERT INTO resultado VALUES ('(a) ...y las dos quedan en la tabla', '2',
    (SELECT count(*)::text FROM equipos WHERE serial = 'GH14W64'));

  -- 5b. Alguien resuelve la primera y le baja la marca: aún no hay conflicto,
  -- porque la otra sigue fuera del índice.
  BEGIN
    UPDATE equipos SET requiere_revision = false WHERE id = v_dup1;
    INSERT INTO resultado VALUES ('(b) limpiar la primera', 'aceptado', 'aceptado');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('(b) limpiar la primera', 'aceptado', 'RECHAZADO');
  END;

  -- 5c. Y baja la marca de la segunda sin haber resuelto el duplicado. Aquí es
  -- donde la BD tiene que negarse: la limpieza no se puede cerrar en falso.
  BEGIN
    UPDATE equipos SET requiere_revision = false WHERE id = v_dup2;
    INSERT INTO resultado VALUES ('(b) limpiar la segunda', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('(b) limpiar la segunda', 'rechazado', 'rechazado');
  END;

  -- 5d. `etiqueta` lleva el mismo índice parcial y se comporta igual.
  BEGIN
    INSERT INTO equipos (categoria, estado, etiqueta, requiere_revision)
      VALUES ('Portátil', 'Disponible', 'BBL-0301', true);
    INSERT INTO equipos (categoria, estado, etiqueta, requiere_revision)
      VALUES ('Portátil', 'Disponible', 'BBL-0301', true);
    INSERT INTO resultado VALUES ('etiqueta BBL-0301 x2 marcadas', 'aceptado', 'aceptado');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('etiqueta BBL-0301 x2 marcadas', 'aceptado', 'RECHAZADO');
  END;

  -- 6. updated_at se mueve solo
  SELECT updated_at INTO v_upd1 FROM equipos WHERE id = v_eq;
  PERFORM pg_sleep(0.01);
  UPDATE equipos SET notas = 'tocado' WHERE id = v_eq;
  SELECT updated_at INTO v_upd2 FROM equipos WHERE id = v_eq;
  INSERT INTO resultado VALUES ('trigger updated_at', 'avanza',
    CASE WHEN v_upd2 > v_upd1 THEN 'avanza' ELSE 'NO AVANZA' END);

  -- Traslado abierto, para las pruebas de append-only
  INSERT INTO movimientos (equipo_id, tipo, usuario_app_id, sede_origen_id)
    VALUES (v_eq, 'Traslado', v_usr, v_sede) RETURNING id INTO v_mov;

  -- 7. append-only: DELETE prohibido
  BEGIN
    DELETE FROM movimientos WHERE id = v_mov;
    INSERT INTO resultado VALUES ('append-only: DELETE', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN restrict_violation THEN
    INSERT INTO resultado VALUES ('append-only: DELETE', 'rechazado', 'rechazado');
  END;

  -- 8. append-only: editar otro campo prohibido
  BEGIN
    UPDATE movimientos SET observaciones = 'reescribiendo el pasado' WHERE id = v_mov;
    INSERT INTO resultado VALUES ('append-only: UPDATE observaciones', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN restrict_violation THEN
    INSERT INTO resultado VALUES ('append-only: UPDATE observaciones', 'rechazado', 'rechazado');
  END;

  -- 9. append-only: confirmar el traslado sí se permite (D1)
  UPDATE movimientos SET fecha_confirmacion = now() WHERE id = v_mov;
  INSERT INTO resultado VALUES ('append-only: confirmar traslado', 'aceptado', 'aceptado');

  -- 10. append-only: reabrir un traslado ya confirmado, prohibido
  BEGIN
    UPDATE movimientos SET fecha_confirmacion = NULL WHERE id = v_mov;
    INSERT INTO resultado VALUES ('append-only: reabrir traslado', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN restrict_violation THEN
    INSERT INTO resultado VALUES ('append-only: reabrir traslado', 'rechazado', 'rechazado');
  END;

  -- 11. El índice parcial de traslados abiertos ya no lo cuenta
  INSERT INTO resultado VALUES ('traslados abiertos tras confirmar', '0',
    (SELECT count(*)::text FROM movimientos
      WHERE tipo = 'Traslado' AND fecha_confirmacion IS NULL));

  -- 12. FK restrictiva: no se puede borrar un empleado con equipo a cargo
  BEGIN
    DELETE FROM empleados WHERE id = v_emp;
    INSERT INTO resultado VALUES ('FK restrict: borrar empleado con equipo', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('FK restrict: borrar empleado con equipo', 'rechazado', 'rechazado');
  END;
END;
$$;

SELECT caso, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE '>>> FALLA' END AS veredicto
FROM resultado;

SELECT count(*) FILTER (WHERE esperado <> obtenido) AS fallas FROM resultado;

ROLLBACK;
