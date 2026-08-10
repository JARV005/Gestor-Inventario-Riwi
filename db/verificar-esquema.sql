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
  v_eq_res uuid;
  v_acta   uuid;
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

  -- =========================================================================
  -- Etapa 5 (migración 0008). Ver docs/decisiones-04.md.
  -- =========================================================================

  -- 17. D13: 'En tránsito' ya no es un valor del enum.
  --     Es el lado que fija que el estado dejó de poder ponerse a mano. Si
  --     alguien lo reintroduce «porque hacía falta», este caso lo dice.
  BEGIN
    INSERT INTO equipos (categoria, estado) VALUES ('Portátil', 'En tránsito');
    INSERT INTO resultado VALUES ('D13: estado En tránsito retirado', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN invalid_text_representation THEN
    INSERT INTO resultado VALUES ('D13: estado En tránsito retirado', 'rechazado', 'rechazado');
  END;

  -- 18. Los dos valores nuevos de tipo_movimiento existen y se aceptan.
  --     El lado positivo del 17: retirar uno no puede haberse llevado otros.
  INSERT INTO equipos (categoria, estado, sede_id)
    VALUES ('Portátil', 'Reservado', v_sede) RETURNING id INTO v_eq_res;

  INSERT INTO movimientos (equipo_id, tipo, usuario_app_id)
    VALUES (v_eq_res, 'Reserva', v_usr);
  INSERT INTO movimientos (equipo_id, tipo, usuario_app_id)
    VALUES (v_eq_res, 'Liberación', v_usr);

  INSERT INTO resultado VALUES ('Reserva y Liberación se aceptan', '2',
    (SELECT count(*)::text FROM movimientos
      WHERE equipo_id = v_eq_res AND tipo IN ('Reserva', 'Liberación')));

  -- 19. D13: un equipo no puede tener DOS traslados abiertos.
  --     Sin esto, derivar «está viajando» de la existencia de un traslado
  --     abierto diría «viajando» sin poder decir hacia dónde.
  INSERT INTO movimientos (equipo_id, tipo, usuario_app_id, sede_destino_id)
    VALUES (v_eq_res, 'Traslado', v_usr, v_sede);

  BEGIN
    INSERT INTO movimientos (equipo_id, tipo, usuario_app_id, sede_destino_id)
      VALUES (v_eq_res, 'Traslado', v_usr, v_sede);
    INSERT INTO resultado VALUES ('D13: dos traslados abiertos', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('D13: dos traslados abiertos', 'rechazado', 'rechazado');
  END;

  -- 20. El otro lado del 19: cerrado el primero, el segundo entra.
  --     El índice es PARCIAL. Si alguien le quitara el WHERE, este caso
  --     fallaría y el 19 seguiría en verde — un equipo no podría trasladarse
  --     dos veces en su vida y nadie se enteraría hasta el segundo traslado.
  UPDATE movimientos SET fecha_confirmacion = now()
   WHERE equipo_id = v_eq_res AND tipo = 'Traslado' AND fecha_confirmacion IS NULL;

  BEGIN
    INSERT INTO movimientos (equipo_id, tipo, usuario_app_id, sede_destino_id)
      VALUES (v_eq_res, 'Traslado', v_usr, v_sede);
    INSERT INTO resultado VALUES ('D13: segundo traslado tras cerrar el primero', 'aceptado', 'aceptado');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('D13: segundo traslado tras cerrar el primero', 'aceptado', 'RECHAZADO');
  END;

  -- 21. D14: un acta no puede apuntar a un equipo que no existe.
  --     Es lo que el `uuid[]` del §2 no podía imponer.
  INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por)
    VALUES ('PRUEBA-0001', 'Entrega', v_emp, v_usr) RETURNING id INTO v_acta;

  BEGIN
    INSERT INTO actas_equipos (acta_id, equipo_id)
      VALUES (v_acta, '00000000-0000-0000-0000-000000000000');
    INSERT INTO resultado VALUES ('D14: acta hacia un equipo inexistente', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('D14: acta hacia un equipo inexistente', 'rechazado', 'rechazado');
  END;

  -- 22. D14: el mismo equipo no puede ir dos veces en la misma acta.
  INSERT INTO actas_equipos (acta_id, equipo_id, etiqueta, serial)
    VALUES (v_acta, v_eq_res, 'ETQ-INSTANTANEA', 'SN-INSTANTANEA');

  BEGIN
    INSERT INTO actas_equipos (acta_id, equipo_id) VALUES (v_acta, v_eq_res);
    INSERT INTO resultado VALUES ('D14: equipo repetido en un acta', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('D14: equipo repetido en un acta', 'rechazado', 'rechazado');
  END;

  -- 23. D14: la instantánea NO sigue al equipo.
  --     Es la mitad que el array del §2 sí protegía y una puente pelada
  --     perdería: corregir el serial del equipo no puede reescribir lo que
  --     dice un acta ya emitida.
  UPDATE equipos SET serial = 'SN-CORREGIDO-DESPUES' WHERE id = v_eq_res;

  INSERT INTO resultado VALUES ('D14: la instantánea del acta no cambia', 'SN-INSTANTANEA',
    (SELECT serial FROM actas_equipos WHERE acta_id = v_acta AND equipo_id = v_eq_res));

  -- 24. D14: un equipo referenciado por un acta no se puede borrar.
  BEGIN
    DELETE FROM equipos WHERE id = v_eq_res;
    INSERT INTO resultado VALUES ('D14: borrar equipo con acta', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('D14: borrar equipo con acta', 'rechazado', 'rechazado');
  END;

  -- 25. D15: o están el PDF y su hash, o no está ninguno.
  --     Un PDF sin hash no se puede verificar; un hash sin PDF no verifica
  --     nada. Los dos lados, porque el CHECK es una equivalencia.
  BEGIN
    UPDATE actas SET pdf = '\x255044462d'::bytea WHERE id = v_acta;
    INSERT INTO resultado VALUES ('D15: PDF sin hash', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D15: PDF sin hash', 'rechazado', 'rechazado');
  END;

  BEGIN
    UPDATE actas SET hash_sha256 = 'abc123' WHERE id = v_acta;
    INSERT INTO resultado VALUES ('D15: hash sin PDF', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D15: hash sin PDF', 'rechazado', 'rechazado');
  END;

  BEGIN
    UPDATE actas SET pdf = '\x255044462d'::bytea, hash_sha256 = 'abc123' WHERE id = v_acta;
    INSERT INTO resultado VALUES ('D15: PDF con su hash', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D15: PDF con su hash', 'aceptado', 'RECHAZADO');
  END;

  -- 26. D18: un usuario con rastro en auditoría no se puede borrar.
  --     El RESTRICT es deliberado: un rastro que se borra borrando al usuario
  --     no es un rastro. Dar de baja a alguien es activo = false.
  INSERT INTO auditoria (tabla, registro_id, accion, usuario_app_id)
    VALUES ('equipos', v_eq_res, 'prueba_esquema', v_usr);

  BEGIN
    DELETE FROM usuarios_app WHERE id = v_usr;
    INSERT INTO resultado VALUES ('D18: borrar usuario con auditoría', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('D18: borrar usuario con auditoría', 'rechazado', 'rechazado');
  END;
END;
$$;

SELECT caso, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE '>>> FALLA' END AS veredicto
FROM resultado;

SELECT count(*) FILTER (WHERE esperado <> obtenido) AS fallas FROM resultado;

ROLLBACK;
