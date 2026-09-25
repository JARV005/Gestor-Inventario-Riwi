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
  v_acta2  uuid;
  v_mov_acta uuid;
  v_eq_otro  uuid;
  v_mov_otro uuid;
  v_eq_resp  uuid;
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

  -- 3b. La relajación de D31, por sus dos lados.
  --
  -- La 0012 abrió una excepción a la equivalencia para 'Prestado', y una
  -- excepción mal escrita se lleva por delante la regla entera: un
  -- `OR estado = 'Prestado'` con un paréntesis de más volvería la CHECK
  -- siempre cierta y los casos 1 y 2 seguirían pasando por casualidad. Por eso
  -- estos cuatro casos van juntos: los dos que deben pasar Y los dos que no.
  BEGIN
    INSERT INTO equipos (categoria, estado, prestado_a)
      VALUES ('Portátil', 'Prestado', 'ISF');
    INSERT INTO resultado VALUES ('CHECK: Prestado sin empleado', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: Prestado sin empleado', 'aceptado', 'RECHAZADO');
  END;

  -- El caso que motivó la relajación: el equipo está prestado y aun así se
  -- sabe quién lo tiene en la mano. Ocho filas del Excel de RIWI son así.
  BEGIN
    INSERT INTO equipos (categoria, estado, empleado_id, prestado_a)
      VALUES ('Portátil', 'Prestado', v_emp, 'ISF');
    INSERT INTO resultado VALUES ('CHECK: Prestado CON empleado', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: Prestado CON empleado', 'aceptado', 'RECHAZADO');
  END;

  -- 3c. `prestado_a` exige 'Prestado', pero NO al revés (0013).
  --
  -- Este caso decía 'rechazado' y estaba mal, y salió verde igualmente porque
  -- comprobaba la CHECK que yo había escrito en vez de la regla que estaba
  -- decidida. Lo destapó el importador: D34 manda que la etiqueta 0798 entre
  -- 'Prestado' con prestatario NULL y marcada, porque el archivo dice que está
  -- prestado y no dice a quién. Un dato que falta no es un dato incoherente, y
  -- una CHECK no puede exigir lo que el origen no tiene.
  BEGIN
    INSERT INTO equipos (categoria, estado) VALUES ('Portátil', 'Prestado');
    INSERT INTO resultado VALUES ('CHECK: Prestado sin prestatario', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: Prestado sin prestatario', 'aceptado', 'RECHAZADO');
  END;

  BEGIN
    INSERT INTO equipos (categoria, estado, prestado_a)
      VALUES ('Portátil', 'Disponible', 'ISF');
    INSERT INTO resultado VALUES ('CHECK: prestatario sin Prestado', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: prestatario sin Prestado', 'rechazado', 'rechazado');
  END;

  -- 3d. Nadie se presta a sí mismo.
  BEGIN
    INSERT INTO equipos (categoria, estado, empresa, prestado_a)
      VALUES ('Portátil', 'Prestado', 'BBL Labs', 'BBL Labs');
    INSERT INTO resultado VALUES ('CHECK: prestado a su propia empresa', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: prestado a su propia empresa', 'rechazado', 'rechazado');
  END;

  -- Y el mismo par de empresas cruzado sí vale: si esto rebotara, la CHECK de
  -- arriba estaría comparando mal y rechazaría préstamos legítimos.
  BEGIN
    INSERT INTO equipos (categoria, estado, empresa, prestado_a)
      VALUES ('Portátil', 'Prestado', 'BBL Labs', 'RIWI');
    INSERT INTO resultado VALUES ('CHECK: prestado a la otra empresa', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('CHECK: prestado a la otra empresa', 'aceptado', 'RECHAZADO');
  END;

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
  INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                     empleado_nombre, generada_por_nombre)
    VALUES ('PRUEBA-0001', 'Entrega', v_emp, v_usr,
            'Nombre Congelado', 'Autor Congelado') RETURNING id INTO v_acta;

  -- El movimiento que el acta documentará (D24). Sobre v_eq_res, que es el
  -- equipo que usan los casos de abajo.
  INSERT INTO movimientos (equipo_id, tipo, usuario_app_id, empleado_destino_id)
    VALUES (v_eq_res, 'Asignación', v_usr, v_emp) RETURNING id INTO v_mov_acta;

  BEGIN
    INSERT INTO actas_equipos (acta_id, equipo_id, movimiento_id, categoria)
      VALUES (v_acta, '00000000-0000-0000-0000-000000000000', v_mov_acta, 'Portátil');
    INSERT INTO resultado VALUES ('D14: acta hacia un equipo inexistente', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('D14: acta hacia un equipo inexistente', 'rechazado', 'rechazado');
  END;

  -- 22. D14: el mismo equipo no puede ir dos veces en la misma acta.
  INSERT INTO actas_equipos (acta_id, equipo_id, movimiento_id, categoria, etiqueta, serial)
    VALUES (v_acta, v_eq_res, v_mov_acta, 'Portátil', 'ETQ-INSTANTANEA', 'SN-INSTANTANEA');

  BEGIN
    INSERT INTO actas_equipos (acta_id, equipo_id, movimiento_id, categoria)
      VALUES (v_acta, v_eq_res, v_mov_acta, 'Portátil');
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

  -- 25. D15 + D26: el PDF, su hash y su plantilla van los tres o ninguno.
  --     Un PDF sin hash no se puede verificar; un hash sin PDF no verifica
  --     nada; y un PDF cuya plantilla no se sabe no se puede regenerar para
  --     comprobarlo. Cada lado por separado, porque el CHECK es una doble
  --     equivalencia y basta con que una de las dos se caiga.
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

  -- El lado que la 0010 añadió, y que rompió este caso al cerrarse la etapa: el
  -- par pdf+hash ya no basta.
  BEGIN
    UPDATE actas SET pdf = '\x255044462d'::bytea, hash_sha256 = 'abc123' WHERE id = v_acta;
    INSERT INTO resultado VALUES ('D26: PDF y hash sin plantilla', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D26: PDF y hash sin plantilla', 'rechazado', 'rechazado');
  END;

  BEGIN
    UPDATE actas SET plantilla_version = '1-borrador' WHERE id = v_acta;
    INSERT INTO resultado VALUES ('D26: plantilla sin PDF', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D26: plantilla sin PDF', 'rechazado', 'rechazado');
  END;

  -- El lado positivo de la CHECK, que la 0015 volvió a mover: ya no son tres
  -- columnas sino CUATRO. `v_acta` es una entrega, así que necesita su chequeo.
  --
  -- Este caso se ha roto dos veces por lo mismo —la 0010 le añadió
  -- `plantilla_version` y la 0015 le añade `chequeo`— y las dos veces fue al
  -- ampliar la instantánea del documento. Es su función: si mañana entra una
  -- quinta columna en los bytes del PDF, este caso tiene que volver a ponerse
  -- rojo, porque una instantánea incompleta es la que hace que
  -- `recalcularHash` acuse a un acta legítima.
  BEGIN
    UPDATE actas SET pdf = '\x255044462d'::bytea, hash_sha256 = 'abc123',
                     plantilla_version = '1-borrador',
                     chequeo = '[{"item": "BitLocker", "instalado": null, "observaciones": null}]'::jsonb
     WHERE id = v_acta;
    INSERT INTO resultado VALUES ('D15+D26+D41: las cuatro juntas', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D15+D26+D41: las cuatro juntas', 'aceptado', 'RECHAZADO');
  END;

  -- 27. D24: un acta no puede colgar del movimiento de OTRO equipo.
  --     Es la FK compuesta (movimiento_id, equipo_id) de la 0009. Con dos FK
  --     sueltas las dos apuntarían a filas que existen y nadie vería que el
  --     acta de un portátil cuelga de la asignación de otro.
  INSERT INTO equipos (categoria, estado, sede_id)
    VALUES ('Monitor', 'Disponible', v_sede) RETURNING id INTO v_eq_otro;
  INSERT INTO movimientos (equipo_id, tipo, usuario_app_id)
    VALUES (v_eq_otro, 'Alta', v_usr) RETURNING id INTO v_mov_otro;

  INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                     empleado_nombre, generada_por_nombre)
    VALUES ('PRUEBA-0002', 'Entrega', v_emp, v_usr, 'N', 'A') RETURNING id INTO v_acta2;

  BEGIN
    -- El equipo es v_eq_res y el movimiento es de v_eq_otro: cruzados.
    INSERT INTO actas_equipos (acta_id, equipo_id, movimiento_id, categoria)
      VALUES (v_acta2, v_eq_res, v_mov_otro, 'Portátil');
    INSERT INTO resultado VALUES ('D24: acta contra el movimiento de otro equipo', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('D24: acta contra el movimiento de otro equipo', 'rechazado', 'rechazado');
  END;

  -- Y el mismo par, bien puesto, tiene que pasar: si no, el caso de arriba
  -- estaría en verde porque la FK rechaza todo.
  BEGIN
    INSERT INTO actas_equipos (acta_id, equipo_id, movimiento_id, categoria)
      VALUES (v_acta2, v_eq_otro, v_mov_otro, 'Monitor');
    INSERT INTO resultado VALUES ('D24: acta contra el movimiento de SU equipo', 'aceptado', 'aceptado');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO resultado VALUES ('D24: acta contra el movimiento de SU equipo', 'aceptado', 'RECHAZADO');
  END;

  -- 28. D24: un movimiento se firma UNA vez. Dos actas sobre la misma entrega
  --     son dos papeles con distinto número, y el día que discrepen no hay
  --     forma de saber cuál vale.
  BEGIN
    INSERT INTO actas_equipos (acta_id, equipo_id, movimiento_id, categoria)
      VALUES (v_acta, v_eq_otro, v_mov_otro, 'Monitor');
    INSERT INTO resultado VALUES ('D24: dos actas sobre el mismo movimiento', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('D24: dos actas sobre el mismo movimiento', 'rechazado', 'rechazado');
  END;

  -- 29. D23: la instantánea de la PERSONA tampoco sigue a la ficha.
  --     La 0008 congeló el equipo y dejó la persona leyéndose por FK: si en
  --     marzo se corrige un nombre, el acta de enero cambiaba.
  UPDATE empleados SET nombre = 'Nombre Corregido Despues' WHERE id = v_emp;

  INSERT INTO resultado VALUES ('D23: la instantánea de la persona no cambia', 'Nombre Congelado',
    (SELECT empleado_nombre FROM actas WHERE id = v_acta));

  -- 30. D23: un acta sin instantánea de la persona no se puede insertar.
  --     El NOT NULL es lo que impide que alguien añada un camino de creación
  --     que se olvide de copiarla y deje el acta apuntando solo por FK.
  BEGIN
    INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por, generada_por_nombre)
      VALUES ('PRUEBA-0003', 'Entrega', v_emp, v_usr, 'A');
    INSERT INTO resultado VALUES ('D23: acta sin nombre congelado', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN not_null_violation THEN
    INSERT INTO resultado VALUES ('D23: acta sin nombre congelado', 'rechazado', 'rechazado');
  END;

  -- 31. D25: el consecutivo no se repite. Es la última red por debajo del
  --     contador: si la lógica de la aplicación se rompiera, el INSERT falla
  --     en vez de emitir dos actas con el mismo número.
  BEGIN
    INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                       empleado_nombre, generada_por_nombre)
      VALUES ('PRUEBA-0001', 'Entrega', v_emp, v_usr, 'N', 'A');
    INSERT INTO resultado VALUES ('D25: consecutivo repetido', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('D25: consecutivo repetido', 'rechazado', 'rechazado');
  END;

  -- ==========================================================================
  -- Etapa 8 - D44. Los equipos que no se asignan a nadie.
  -- ==========================================================================
  --
  -- La regla vive en la CHECK y no en la interfaz, asi que es AQUI donde se
  -- comprueba: excluirlos del selector deja la puerta abierta a que alguien
  -- llame al endpoint a mano.
  --
  -- `v_eq_res` llega aqui en estado Reservado; cada caso lo deja como lo
  -- necesita y todo se deshace con el ROLLBACK del final.

  -- 40. Un equipo no asignable no puede quedar a nombre de nadie.
  UPDATE equipos SET estado = 'Disponible', empleado_id = NULL, prestado_a = NULL,
                     asignable = false
   WHERE id = v_eq_res;

  BEGIN
    UPDATE equipos SET empleado_id = v_emp, estado = 'Asignado' WHERE id = v_eq_res;
    INSERT INTO resultado VALUES ('D44: asignar infraestructura', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D44: asignar infraestructura', 'rechazado', 'rechazado');
  END;

  -- 41. Ni reservarla.
  BEGIN
    UPDATE equipos SET estado = 'Reservado' WHERE id = v_eq_res;
    INSERT INTO resultado VALUES ('D44: reservar infraestructura', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D44: reservar infraestructura', 'rechazado', 'rechazado');
  END;

  -- 42. Ni prestarla.
  BEGIN
    UPDATE equipos SET estado = 'Prestado', prestado_a = 'BBL Labs' WHERE id = v_eq_res;
    INSERT INTO resultado VALUES ('D44: prestar infraestructura', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D44: prestar infraestructura', 'rechazado', 'rechazado');
  END;

  -- 43. EL OTRO LADO, que impide que la regla sea «prohibirlo todo»:
  --     mantenimiento y baja SI aplican. Un switch se averia.
  BEGIN
    UPDATE equipos SET estado = 'En mantenimiento' WHERE id = v_eq_res;
    INSERT INTO resultado VALUES ('D44: infraestructura al taller', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D44: infraestructura al taller', 'aceptado', 'RECHAZADO');
  END;

  BEGIN
    UPDATE equipos SET estado = 'De baja' WHERE id = v_eq_res;
    INSERT INTO resultado VALUES ('D44: dar de baja infraestructura', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D44: dar de baja infraestructura', 'aceptado', 'RECHAZADO');
  END;

  -- 44. Y un equipo normal sigue asignandose. Sin esto, una CHECK que rechazara
  --     TODO pasaria los tres casos negativos de arriba.
  BEGIN
    UPDATE equipos SET asignable = true, estado = 'Disponible', empleado_id = NULL
     WHERE id = v_eq_res;
    UPDATE equipos SET empleado_id = v_emp, estado = 'Asignado' WHERE id = v_eq_res;
    INSERT INTO resultado VALUES ('D44: asignar un equipo normal', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D44: asignar un equipo normal', 'aceptado', 'RECHAZADO');
  END;

  -- Se deja como estaba para los casos de abajo.
  UPDATE equipos SET estado = 'Reservado', empleado_id = NULL WHERE id = v_eq_res;

  -- ==========================================================================
  -- 0018. Un equipo con responsable no puede llevar un motivo que diga que no
  --       se sabe quién lo tiene.
  -- ==========================================================================
  --
  -- El caso que lo motivó: el 0468 quedó Asignado, con responsable, y con
  -- ASIGNADO_SIN_RESPONSABLE y RESPONSABLE_NO_PERSONA puestos. Lo hizo la
  -- interfaz, no el importador, y verificar-datos.sql salía en rojo por ello.
  --
  -- Los tres casos usan un motivo SINTÉTICO y no uno del catálogo real. Así se
  -- comprueba el mecanismo —que el trigger lee la columna
  -- `implica_sin_responsable`— y no lo que la siembra puso en cada código, que
  -- es asunto de verificar-datos.sql. Un caso escrito sobre los cuatro códigos
  -- reales pasaría igual con un trigger que llevara la lista dentro.
  --
  -- SET CONSTRAINTS ALL IMMEDIATE otra vez: los triggers de la 0018 son
  -- deferidos —tienen que serlo, porque `mutar` pone el responsable y retira los
  -- motivos en dos sentencias— y este fichero termina en ROLLBACK. Sin forzarlo,
  -- los tres casos pasarían en verde sin comprobar nada.
  INSERT INTO motivos_revision (codigo, descripcion, implica_sin_responsable)
    VALUES ('ZZ_PRUEBA_SIN_RESP', 'sintetico del verificador', true),
           ('ZZ_PRUEBA_NORMAL',  'sintetico del verificador', false);

  -- 45. Con responsable y con un motivo que dice que no se sabe quién: no.
  BEGIN
    INSERT INTO equipos (categoria, estado, empleado_id, requiere_revision)
      VALUES ('Mouse', 'Asignado', v_emp, true) RETURNING id INTO v_eq_resp;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_eq_resp, 'ZZ_PRUEBA_SIN_RESP');
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('0018: responsable + motivo sin-responsable', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('0018: responsable + motivo sin-responsable', 'rechazado', 'rechazado');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 46. EL OTRO LADO. El mismo motivo, sin responsable: tiene que entrar.
  --
  --     Es el estado en que el importador deja a 224 equipos, y si esto se
  --     rechazara la importación entera dejaría de funcionar. Sin este caso, un
  --     trigger que prohibiera el motivo siempre pasaría el 45 igual de verde.
  BEGIN
    INSERT INTO equipos (categoria, estado, empleado_id, requiere_revision)
      VALUES ('Mouse', 'Disponible', NULL, true) RETURNING id INTO v_eq_resp;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_eq_resp, 'ZZ_PRUEBA_SIN_RESP');
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('0018: motivo sin-responsable y sin responsable', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('0018: motivo sin-responsable y sin responsable', 'aceptado', 'RECHAZADO');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 47. Y que de verdad lee la columna: un motivo que NO afirma nada sobre el
  --     responsable convive con un responsable sin problema.
  --
  --     Es el caso del 0758, que quedó asignado con SECRETO_NO_ES_SECRETO. Ese
  --     motivo habla de una clave, no de quién tiene el equipo, y retirarlo al
  --     asignar habría perdido que falta una contraseña BIOS.
  BEGIN
    INSERT INTO equipos (categoria, estado, empleado_id, requiere_revision)
      VALUES ('Mouse', 'Asignado', v_emp, true) RETURNING id INTO v_eq_resp;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_eq_resp, 'ZZ_PRUEBA_NORMAL');
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('0018: responsable + motivo de otra cosa', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('0018: responsable + motivo de otra cosa', 'aceptado', 'RECHAZADO');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 49. PRESTADO con tenedor anotado y el motivo puesto: tiene que entrar.
  --
  --     `empleado_id` significa dos cosas: el responsable cuando el equipo está
  --     `Asignado`, y quién lo tiene físicamente cuando está `Prestado`. Lo dice
  --     la CHECK `equipos_asignado_implica_empleado`, que exime a `Prestado` de
  --     la equivalencia a propósito.
  --
  --     La 0018 no lo distinguía y rechazaba esto: un equipo marcado
  --     RESPONSABLE_EN_CONFLICTO, prestado, al que alguien anota quién lo tiene.
  --     Anotarlo no decide de quién es el equipo, así que el motivo sigue
  --     abierto con razón. Lo cogió un test que ya existía al pasar de 200 a
  --     409; este caso es para que no vuelva a pasar desapercibido aquí.
  BEGIN
    INSERT INTO equipos (categoria, estado, prestado_a, empleado_id, requiere_revision)
      VALUES ('Mouse', 'Prestado', 'ISF', v_emp, true) RETURNING id INTO v_eq_resp;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_eq_resp, 'ZZ_PRUEBA_SIN_RESP');
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('0020: prestado con tenedor y motivo abierto', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('0020: prestado con tenedor y motivo abierto', 'aceptado', 'RECHAZADO');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- 48. Y el orden que usa `mutar`: poner el responsable ANTES de retirar el
  --     motivo, las dos cosas en la misma transacción.
  --
  --     Este es el caso por el que los triggers tienen que ser DEFERIDOS. Con
  --     uno inmediato, el UPDATE de `equipos` reventaría y la asignación de
  --     cualquiera de los 224 equipos marcados sería imposible: el arreglo del
  --     0468 habría cambiado un rojo del verificador por un 500 en la interfaz.
  BEGIN
    INSERT INTO equipos (categoria, estado, empleado_id, requiere_revision)
      VALUES ('Mouse', 'Disponible', NULL, true) RETURNING id INTO v_eq_resp;
    INSERT INTO equipos_motivos_revision (equipo_id, motivo_codigo)
      VALUES (v_eq_resp, 'ZZ_PRUEBA_SIN_RESP');
    -- Lo que hace mutar, en su orden.
    UPDATE equipos SET estado = 'Asignado', empleado_id = v_emp WHERE id = v_eq_resp;
    DELETE FROM equipos_motivos_revision
      WHERE equipo_id = v_eq_resp AND motivo_codigo = 'ZZ_PRUEBA_SIN_RESP';
    UPDATE equipos SET requiere_revision = false WHERE id = v_eq_resp;
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO resultado VALUES ('0018: asignar y retirar en una transaccion', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('0018: asignar y retirar en una transaccion', 'aceptado', 'RECHAZADO');
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- ==========================================================================
  -- 5f-2 · D40 y D41. Los dos cambios de la 0015, por sus dos lados.
  -- ==========================================================================

  -- 33. D41: una ENTREGA con documento tiene que llevar su lista de chequeo.
  --     La sección 5 se imprime en el PDF, así que forma parte de los bytes y
  --     del hash. Un acta con documento y sin chequeo guardado es un acta que
  --     `recalcularHash` no puede regenerar: la pintaría vacía, los bytes no
  --     cuadrarían y acusaría de manipulada un acta legítima.
  BEGIN
    INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                       empleado_nombre, generada_por_nombre,
                       pdf, hash_sha256, plantilla_version)
      VALUES ('PRUEBA-D41-A', 'Entrega', v_emp, v_usr, 'N', 'A',
              '\x25504446'::bytea, 'h', '1');
    INSERT INTO resultado VALUES ('D41: entrega con PDF y sin chequeo', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D41: entrega con PDF y sin chequeo', 'rechazado', 'rechazado');
  END;

  -- 34. D41: y el otro lado — con el chequeo puesto, entra.
  --     Sin este caso, una CHECK que rechazara TODAS las entregas pasaría el
  --     anterior perfectamente.
  BEGIN
    INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                       empleado_nombre, generada_por_nombre,
                       pdf, hash_sha256, plantilla_version, chequeo)
      VALUES ('PRUEBA-D41-B', 'Entrega', v_emp, v_usr, 'N', 'A',
              '\x25504446'::bytea, 'h', '1',
              '[{"item": "BitLocker", "instalado": false, "observaciones": null}]'::jsonb);
    INSERT INTO resultado VALUES ('D41: entrega con PDF y con chequeo', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D41: entrega con PDF y con chequeo', 'aceptado', 'RECHAZADO');
  END;

  -- 35. D41: una DEVOLUCIÓN no puede llevar chequeo.
  --     Su formato no tiene sección 5 (D37). Guardárselo haría que la
  --     instantánea dijera algo que el documento no imprime, y entonces el
  --     hash dejaría de significar «esto es lo que se firmó».
  BEGIN
    INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                       empleado_nombre, generada_por_nombre,
                       pdf, hash_sha256, plantilla_version, chequeo)
      VALUES ('PRUEBA-D41-C', 'Devolución', v_emp, v_usr, 'N', 'A',
              '\x25504446'::bytea, 'h', '1-borrador',
              '[{"item": "BitLocker", "instalado": true, "observaciones": null}]'::jsonb);
    INSERT INTO resultado VALUES ('D41: devolución con chequeo', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D41: devolución con chequeo', 'rechazado', 'rechazado');
  END;

  -- 36. D41: un acta SIN documento tampoco puede llevar chequeo.
  --     El chequeo es parte de la instantánea del documento; sin documento no
  --     hay nada de lo que sea instantánea.
  BEGIN
    INSERT INTO actas (consecutivo, tipo, empleado_id, generada_por,
                       empleado_nombre, generada_por_nombre, chequeo)
      VALUES ('PRUEBA-D41-D', 'Entrega', v_emp, v_usr, 'N', 'A',
              '[{"item": "BitLocker", "instalado": true, "observaciones": null}]'::jsonb);
    INSERT INTO resultado VALUES ('D41: chequeo sin PDF', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D41: chequeo sin PDF', 'rechazado', 'rechazado');
  END;

  -- Los casos del contador trabajan sobre una tabla VACÍA, y la vacían ellos.
  --
  -- Estaban escritos dando por hecho que no había filas, y se rompieron en
  -- cuanto alguien emitió la primera acta real: `INSERT ... ('RIWI', 0)`
  -- chocaba contra la clave primaria y el verificador salía con error por un
  -- motivo que no tenía nada que ver con lo que comprueba.
  --
  -- Es el mismo defecto que un caso que NECESITA datos dentro, por el otro
  -- lado: este necesitaba que no los hubiera. Un caso de `verificar-esquema`
  -- tiene que dar el mismo resultado en una base vacía y en una con trescientas
  -- actas. Todo esto va dentro de la transacción que termina en ROLLBACK, así
  -- que la numeración real no se toca.
  DELETE FROM actas_consecutivo;

  -- 37. D40: el contador arranca en CERO, y la CHECK tiene que dejarlo.
  --     Era `valor > 0` hasta la 0015. Con la primera acta de cada serie
  --     numerada `0000`, esa constraint mataba el primer POST de cada empresa
  --     — un fallo que solo aparece la primera vez y nunca más.
  BEGIN
    INSERT INTO actas_consecutivo (empresa, valor) VALUES ('RIWI', 0);
    INSERT INTO resultado VALUES ('D40: contador en cero', 'aceptado', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D40: contador en cero', 'aceptado', 'RECHAZADO');
  END;

  -- 38. D40: y no puede bajar de ahí. Un consecutivo negativo no es un número
  --     de documento.
  BEGIN
    INSERT INTO actas_consecutivo (empresa, valor) VALUES ('BBL Labs', -1);
    INSERT INTO resultado VALUES ('D40: contador negativo', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES ('D40: contador negativo', 'rechazado', 'rechazado');
  END;

  -- 39b. D42: `Sin clasificar` no emite, así que su contador no debería
  --      existir. La base NO lo impide —la columna es el enum entero— y eso es
  --      deliberado: la guarda vive en el repositorio y en el tipo, donde puede
  --      explicar qué hacer. Lo que se comprueba aquí es que el enum SÍ admite
  --      el valor, para que el caso de `verificar-datos` que lo busca no sea un
  --      verde imposible de romper.
  BEGIN
    INSERT INTO actas_consecutivo (empresa, valor) VALUES ('Sin clasificar', 0);
    INSERT INTO resultado VALUES ('D42: la base admite el valor que el codigo veta',
      'aceptado', 'aceptado');
    DELETE FROM actas_consecutivo WHERE empresa = 'Sin clasificar';
  EXCEPTION WHEN others THEN
    INSERT INTO resultado VALUES ('D42: la base admite el valor que el codigo veta',
      'aceptado', 'RECHAZADO');
  END;

  -- 39. D40: cada empresa tiene SU serie, y solo una.
  --     La clave primaria es la empresa: dos filas para la misma empresa serían
  --     dos contadores compitiendo por la misma numeración, que es exactamente
  --     lo que produce dos actas con el mismo número.
  INSERT INTO actas_consecutivo (empresa, valor) VALUES ('BBL Labs', 7);
  INSERT INTO resultado VALUES ('D40: dos series conviven',
    '2', (SELECT count(*)::text FROM actas_consecutivo));

  BEGIN
    INSERT INTO actas_consecutivo (empresa, valor) VALUES ('RIWI', 3);
    INSERT INTO resultado VALUES ('D40: serie duplicada', 'rechazado', 'ACEPTADO');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES ('D40: serie duplicada', 'rechazado', 'rechazado');
  END;

  -- 32. D24: un movimiento firmado por un acta no se puede borrar.
  --     `movimientos` ya es append-only por trigger; esto comprueba la otra
  --     mitad, que la FK del acta también lo sujeta.
  BEGIN
    DELETE FROM movimientos WHERE id = v_mov_otro;
    INSERT INTO resultado VALUES ('D24: borrar un movimiento con acta', 'rechazado', 'ACEPTADO');
  EXCEPTION
    WHEN foreign_key_violation THEN
      INSERT INTO resultado VALUES ('D24: borrar un movimiento con acta', 'rechazado', 'rechazado');
    WHEN restrict_violation THEN
      -- El trigger append-only muerde antes que la FK. Cualquiera de los dos
      -- vale: lo que se comprueba es que no se pueda.
      INSERT INTO resultado VALUES ('D24: borrar un movimiento con acta', 'rechazado', 'rechazado');
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

-- ---------------------------------------------------------------------------
-- Y que el proceso FALLE si hay alguna. Ver la nota gemela en
-- `verificar-datos.sql`: `ON_ERROR_STOP` no reacciona a una fila que diga que
-- algo está mal, solo a un error de SQL. Este fichero imprimía «fallas: 1» y
-- salía con código 0 — lo descubrí al cerrar la etapa 5, cuando la migración
-- 0010 rompió el caso 25 y `npm run db:verificar` siguió en verde.
--
-- Va antes del ROLLBACK: la excepción aborta la transacción, que es justo lo
-- que este fichero hace igualmente al terminar.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM resultado WHERE esperado <> obtenido;
  IF n > 0 THEN
    RAISE EXCEPTION 'verificar-esquema: % caso(s) en rojo. Ver la tabla de arriba.', n;
  END IF;
END $$;

ROLLBACK;
