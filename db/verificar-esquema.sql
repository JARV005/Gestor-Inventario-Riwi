-- Comprueba que los invariantes del ESQUEMA los impone la base de datos y no
-- la buena voluntad de quien escriba el INSERT. `npm run db:verificar-esquema`.
--
-- Trabaja solo con filas sintéticas que él mismo inserta, y termina en
-- ROLLBACK: no deja ni una fila. **Pasa en una BD recién migrada y vacía.**
-- Si un caso de aquí depende de qué haya cargado, está mal escrito — ya pasó
-- dos veces.
--
-- Lo que sí mira las filas reales está en `verificar-datos.sql`.
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
  v_etq1 uuid;
  v_usr  uuid;
  v_mov  uuid;
  v_upd1 timestamptz;
  v_upd2 timestamptz;
  v_abiertos_antes int;
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
  INSERT INTO equipos (categoria, estado, serial) VALUES ('Monitor', 'Disponible', NULL);
  INSERT INTO resultado VALUES ('serial: dos NULL conviven', 'aceptado', 'aceptado');

  -- 5. serial duplicado entre filas ya limpias: debe rebotar
  BEGIN
    INSERT INTO equipos (categoria, estado, serial) VALUES ('Monitor', 'Disponible', 'SN-DUP');
    INSERT INTO equipos (categoria, estado, serial) VALUES ('Monitor', 'Disponible', 'SN-DUP');
    INSERT INTO resultado VALUES ('serial: duplicado sin marcar', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('serial: duplicado sin marcar', 'rechazado', 'rechazado');
  END;

  -- 5a. El caso que hunde la etapa 2 si el índice está mal: un serial repetido
  -- tiene que poder entrar dos veces mientras las dos filas estén marcadas.
  -- Serial sintético y no 'GH14W64': el de verdad ya está cargado y atar el
  -- test a él lo haría depender de los datos.
  BEGIN
    INSERT INTO equipos (categoria, estado, serial, requiere_revision)
      VALUES ('Portátil', 'Disponible', 'SN-MARCADO', true) RETURNING id INTO v_dup1;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_dup1, 'SERIAL_DUPLICADO');
    INSERT INTO equipos (categoria, estado, serial, requiere_revision)
      VALUES ('Portátil', 'Disponible', 'SN-MARCADO', true) RETURNING id INTO v_dup2;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_dup2, 'SERIAL_DUPLICADO');
    INSERT INTO resultado VALUES ('(a) serial repetido x2 marcadas', 'aceptado', 'aceptado');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('(a) serial repetido x2 marcadas', 'aceptado', 'RECHAZADO');
  END;

  INSERT INTO resultado VALUES ('(a) ...y las dos quedan en la tabla', '2',
    (SELECT count(*)::text FROM equipos WHERE id IN (v_dup1, v_dup2)));

  -- 5b. Alguien resuelve la primera: retira sus motivos y baja la marca, que es
  -- la única forma coherente de cerrar un caso. Aún no hay conflicto de
  -- unicidad, porque la otra sigue fuera del índice.
  BEGIN
    DELETE FROM equipos_motivos_revision WHERE equipo_id = v_dup1;
    UPDATE equipos SET requiere_revision = false WHERE id = v_dup1;
    INSERT INTO resultado VALUES ('(b) limpiar la primera', 'aceptado', 'aceptado');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('(b) limpiar la primera', 'aceptado', 'RECHAZADO');
  END;

  -- 5c. Y cierra la segunda sin haber resuelto el duplicado. Aquí es donde la
  -- BD tiene que negarse: la limpieza no se puede cerrar en falso.
  BEGIN
    DELETE FROM equipos_motivos_revision WHERE equipo_id = v_dup2;
    UPDATE equipos SET requiere_revision = false WHERE id = v_dup2;
    INSERT INTO resultado VALUES ('(b) limpiar la segunda', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('(b) limpiar la segunda', 'rechazado', 'rechazado');
  END;

  -- 5d. `etiqueta` lleva el mismo índice parcial y se comporta igual.
  BEGIN
    INSERT INTO equipos (categoria, estado, etiqueta, requiere_revision)
      VALUES ('Portátil', 'Disponible', 'ZZZ-TEST-0301', true) RETURNING id INTO v_etq1;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_etq1, 'SIN_SERIAL');
    INSERT INTO equipos (categoria, estado, etiqueta, requiere_revision)
      VALUES ('Portátil', 'Disponible', 'ZZZ-TEST-0301', true) RETURNING id INTO v_eq2;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_eq2, 'SIN_SERIAL');
    INSERT INTO resultado VALUES ('etiqueta duplicada x2 marcadas', 'aceptado', 'aceptado');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('etiqueta duplicada x2 marcadas', 'aceptado', 'RECHAZADO');
  END;

  -- 6. Lo que la tabla puente impide y el text[] no podía.

  -- 6a. Un código fuera del catálogo. Con text[], la errata 'SIN_SERAIL'
  -- entraba y esa fila desaparecía de su bloque en la bandeja.
  BEGIN
    INSERT INTO equipos (categoria, estado, requiere_revision)
      VALUES ('Mouse', 'Disponible', true) RETURNING id INTO v_eq2;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_eq2, 'SIN_SERAIL');
    INSERT INTO resultado VALUES ('motivo inexistente', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('motivo inexistente', 'rechazado', 'rechazado');
  END;

  -- 6b. El mismo motivo dos veces en el mismo equipo: lo corta la PK compuesta,
  -- sin depender de ningún includes() del importador.
  BEGIN
    INSERT INTO equipos (categoria, estado, requiere_revision)
      VALUES ('Mouse', 'Disponible', true) RETURNING id INTO v_eq2;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo) VALUES (v_eq2, 'SIN_SERIAL');
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo) VALUES (v_eq2, 'SIN_SERIAL');
    INSERT INTO resultado VALUES ('motivo duplicado en un equipo', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('motivo duplicado en un equipo', 'rechazado', 'rechazado');
  END;

  -- 7. La equivalencia marca <=> motivos, que desde la 0006 impone un
  -- CONSTRAINT TRIGGER deferido.
  --
  -- SET CONSTRAINTS ALL IMMEDIATE es imprescindible: este fichero termina en
  -- ROLLBACK y nunca llega al COMMIT, así que sin forzarlo el trigger no
  -- dispararía y los cuatro casos pasarían en verde sin haber comprobado nada.
  -- Es exactamente el modo de fallo que una constraint deferida esconde.

  -- 7a. Marcada y sin motivos
  BEGIN
    INSERT INTO equipos (categoria, estado, requiere_revision)
      VALUES ('Mouse', 'Disponible', true);
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('marca sin motivos', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('marca sin motivos', 'rechazado', 'rechazado');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 7b. Con motivos y sin marca
  BEGIN
    INSERT INTO equipos (categoria, estado, requiere_revision)
      VALUES ('Mouse', 'Disponible', false) RETURNING id INTO v_eq2;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo) VALUES (v_eq2, 'SIN_SERIAL');
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('motivos sin marca', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('motivos sin marca', 'rechazado', 'rechazado');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 7c. Los dos casos válidos. Sin esto, un trigger escrito al revés pasaría
  -- igual de verde que uno correcto.
  BEGIN
    INSERT INTO equipos (categoria, estado, requiere_revision)
      VALUES ('Mouse', 'Disponible', true) RETURNING id INTO v_eq2;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo) VALUES (v_eq2, 'SIN_SERIAL');
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo) VALUES (v_eq2, 'SIN_UBICACION');
    INSERT INTO equipos (categoria, estado) VALUES ('Mouse', 'Disponible');
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('marca con motivos / limpia sin ellos', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('marca con motivos / limpia sin ellos', 'aceptado', 'RECHAZADO');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 7d. Retirar el último motivo dejando la marca puesta. Es la forma real de
  -- desincronizarlas, y la que se llevaría por delante la unicidad de serial.
  BEGIN
    INSERT INTO equipos (categoria, estado, requiere_revision)
      VALUES ('Mouse', 'Disponible', true) RETURNING id INTO v_eq2;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo) VALUES (v_eq2, 'SIN_SERIAL');
    DELETE FROM equipos_motivos_revision WHERE equipo_id = v_eq2;
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('quitar el último motivo dejando la marca', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('quitar el último motivo dejando la marca', 'rechazado', 'rechazado');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 8. El enum de condición acepta 'Usado' (migración 0002)
  BEGIN
    INSERT INTO equipos (categoria, estado, condicion) VALUES ('Diadema', 'Disponible', 'Usado');
    INSERT INTO resultado VALUES ('condicion Usado', 'aceptado', 'aceptado');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES ('condicion Usado', 'aceptado', 'RECHAZADO');
  END;

  -- 9. La aritmética de una corrida cabe en una fila, así que es un CHECK y no
  -- una comprobación que alguien tenga que acordarse de correr.
  BEGIN
    INSERT INTO importaciones
      (archivo, hash_sha256, usuario_app_id, filas_leidas, filas_insertadas, filas_rechazadas, filas_marcadas)
      VALUES ('x.xlsx', 'deadbeef', v_usr, 10, 8, 1, 0);
    INSERT INTO resultado VALUES ('importacion que no cuadra', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('importacion que no cuadra', 'rechazado', 'rechazado');
  END;

  BEGIN
    INSERT INTO importaciones
      (archivo, hash_sha256, usuario_app_id, filas_leidas, filas_insertadas, filas_rechazadas, filas_marcadas)
      VALUES ('x.xlsx', 'deadbeef', v_usr, 10, 8, 2, 9);
    INSERT INTO resultado VALUES ('mas marcadas que insertadas', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('mas marcadas que insertadas', 'rechazado', 'rechazado');
  END;

  -- 10. updated_at se mueve solo
  SELECT updated_at INTO v_upd1 FROM equipos WHERE id = v_eq;
  PERFORM pg_sleep(0.01);
  UPDATE equipos SET notas = 'tocado' WHERE id = v_eq;
  SELECT updated_at INTO v_upd2 FROM equipos WHERE id = v_eq;
  INSERT INTO resultado VALUES ('trigger updated_at', 'avanza',
    CASE WHEN v_upd2 > v_upd1 THEN 'avanza' ELSE 'NO AVANZA' END);

  -- Traslado abierto, para las pruebas de append-only.
  --
  -- Se cuenta cuántos había ANTES y se comprueba el delta. La versión anterior
  -- esperaba 0 en absoluto: verde solo mientras el inventario no tuviera ni un
  -- traslado, y roja el día que exista el primero legítimo. Un test que se
  -- pondrá rojo sin que nada esté mal enseña a ignorar los rojos.
  SELECT count(*) INTO v_abiertos_antes FROM movimientos
    WHERE tipo = 'Traslado' AND fecha_confirmacion IS NULL;

  INSERT INTO movimientos (equipo_id, tipo, usuario_app_id, sede_origen_id)
    VALUES (v_eq, 'Traslado', v_usr, v_sede) RETURNING id INTO v_mov;

  INSERT INTO resultado VALUES ('traslado abierto suma 1', 'si',
    CASE WHEN (SELECT count(*) FROM movimientos WHERE tipo = 'Traslado' AND fecha_confirmacion IS NULL)
              = v_abiertos_antes + 1 THEN 'si' ELSE 'NO' END);

  -- 11. append-only: DELETE prohibido
  BEGIN
    DELETE FROM movimientos WHERE id = v_mov;
    INSERT INTO resultado VALUES ('append-only: DELETE', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN restrict_violation THEN
    INSERT INTO resultado VALUES ('append-only: DELETE', 'rechazado', 'rechazado');
  END;

  -- 12. append-only: editar otro campo prohibido
  BEGIN
    UPDATE movimientos SET observaciones = 'reescribiendo el pasado' WHERE id = v_mov;
    INSERT INTO resultado VALUES ('append-only: UPDATE observaciones', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN restrict_violation THEN
    INSERT INTO resultado VALUES ('append-only: UPDATE observaciones', 'rechazado', 'rechazado');
  END;

  -- 13. append-only: confirmar el traslado sí se permite (D1)
  UPDATE movimientos SET fecha_confirmacion = now() WHERE id = v_mov;
  INSERT INTO resultado VALUES ('append-only: confirmar traslado', 'aceptado', 'aceptado');

  -- 14. append-only: reabrir un traslado ya confirmado, prohibido
  BEGIN
    UPDATE movimientos SET fecha_confirmacion = NULL WHERE id = v_mov;
    INSERT INTO resultado VALUES ('append-only: reabrir traslado', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN restrict_violation THEN
    INSERT INTO resultado VALUES ('append-only: reabrir traslado', 'rechazado', 'rechazado');
  END;

  -- 15. Confirmado, vuelven a quedar los que hubiera al empezar
  INSERT INTO resultado VALUES ('traslados abiertos tras confirmar', v_abiertos_antes::text,
    (SELECT count(*)::text FROM movimientos
      WHERE tipo = 'Traslado' AND fecha_confirmacion IS NULL));

  -- 16. FK restrictiva: no se puede borrar un empleado con equipo a cargo
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
