-- Comprueba que LO QUE HAY DENTRO es coherente. `npm run db:verificar-datos`.
--
-- Complementa `verificar-esquema.sql`, que solo comprueba que las reglas están
-- puestas. Ese pasa en una BD vacía; **este aborta**, porque sin corpus no hay
-- nada que comprobar y salir en verde sería mentir.
--
-- Existe porque el verificador de esquema tenía un sesgo: 22 casos sobre filas
-- sintéticas y ninguno sobre las 186 cargadas. Si se borrasen 40 equipos de la
-- BD, aquel seguía dando 22/22.
--
-- Estos son los que detectarían un error de lógica del importador, que es lo
-- que ninguna constraint puede ver: una constraint sabe que un motivo existe,
-- no que diga la verdad sobre la fila que describe.
--
-- Solo lee. No inserta nada, así que no necesita ROLLBACK.

\set ON_ERROR_STOP on

-- Lo primero: negarse si no hay corpus.
--
-- Las comprobaciones de abajo cuentan filas que incumplen, así que sobre una
-- BD vacía todas dan cero y el fichero saldría verde sin haber mirado nada. Y
-- `npm run db:reset` deja la BD exactamente así, de modo que correr esto justo
-- después es el camino natural, no un descuido raro.
--
-- Un test de datos sobre cero datos no está en verde: está inaplicable, y las
-- dos cosas tienen que distinguirse a simple vista.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM equipos;
  IF n = 0 THEN
    RAISE EXCEPTION
      'Inventario vacío: este fichero no es aplicable. Sus comprobaciones cuentan filas que incumplen, y sin filas todas darían cero.'
      USING HINT = 'Cargar el inventario con npm run import, o correr npm run db:verificar-esquema, que sí aplica en vacío.';
  END IF;
END $$;

CREATE TEMP TABLE hallazgo(grupo text, caso text, filas bigint);

-- Cada comprobación cuenta las filas que la INCUMPLEN. Cero es aprobar.
-- Escrito así a propósito: un SELECT que devuelve las filas malas se puede
-- ejecutar a mano para verlas, y no hay forma de que pase en verde por no
-- haber mirado nada.

-- ===========================================================================
-- A. Cada código dice la verdad sobre la fila que describe
-- ===========================================================================

INSERT INTO hallazgo
SELECT 'A', 'LICENCIA_OK con licencia_tipo puesta', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'LICENCIA_OK' AND e.licencia_tipo IS NOT NULL;

INSERT INTO hallazgo
SELECT 'A', 'SIN_SERIAL con serial', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'SIN_SERIAL' AND e.serial IS NOT NULL;

INSERT INTO hallazgo
SELECT 'A', 'SIN_ETIQUETA con etiqueta', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'SIN_ETIQUETA' AND e.etiqueta IS NOT NULL;

INSERT INTO hallazgo
SELECT 'A', 'SIN_MARCA con marca', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'SIN_MARCA' AND e.marca IS NOT NULL;

INSERT INTO hallazgo
SELECT 'A', 'motivo de ubicacion con sede asignada', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo IN ('SIN_UBICACION', 'UBICACION_FUERA_DE_SEDES')
  AND e.sede_id IS NOT NULL;

INSERT INTO hallazgo
SELECT 'A', 'ESTADO_REVISION sin quedar Disponible', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'ESTADO_REVISION' AND e.estado <> 'Disponible';

INSERT INTO hallazgo
SELECT 'A', 'ASIGNADO_SIN_RESPONSABLE que no quedo Disponible y libre', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'ASIGNADO_SIN_RESPONSABLE'
  AND (e.estado <> 'Disponible' OR e.empleado_id IS NOT NULL);

-- El valor no era una persona, así que no hay a quién apuntar: la FK tiene que
-- estar vacía y el rastro del texto crudo vive en notas.
INSERT INTO hallazgo
SELECT 'A', 'RESPONSABLE_NO_PERSONA con mencion o sin nota', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'RESPONSABLE_NO_PERSONA'
  AND (e.empleado_mencionado_id IS NOT NULL OR e.notas IS NULL OR e.empleado_id IS NOT NULL);

-- Aquí sí era una persona: desde la 0004 su identidad va por FK y no por el
-- nombre suelto en un campo de texto.
INSERT INTO hallazgo
SELECT 'A', 'RESPONSABLE_EN_ESTADO_NO_ASIGNADO sin mencion por FK', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'RESPONSABLE_EN_ESTADO_NO_ASIGNADO'
  AND (e.empleado_mencionado_id IS NULL OR e.estado = 'Asignado' OR e.empleado_id IS NOT NULL);

INSERT INTO hallazgo
SELECT 'A', 'SERIAL_DUPLICADO que no esta repetido', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'SERIAL_DUPLICADO'
  AND (e.serial IS NULL
       OR (SELECT count(*) FROM equipos o WHERE o.serial = e.serial) < 2);

INSERT INTO hallazgo
SELECT 'A', 'SERIAL_REPETIDO_PERIFERICO en equipo de computo o sin repetir', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'SERIAL_REPETIDO_PERIFERICO'
  AND (e.categoria IN ('Portátil', 'Desktop')
       OR e.serial IS NULL
       OR (SELECT count(*) FROM equipos o WHERE o.serial = e.serial) < 2);

-- ===========================================================================
-- B. Las recíprocas. Estas codifican las decisiones (a) y (b) de la etapa 2:
--    si alguien las deshace sin querer, se ponen rojas.
-- ===========================================================================

INSERT INTO hallazgo
SELECT 'B', 'sin serial, no es del cliente y no esta marcado', count(*)
FROM equipos e
WHERE e.serial IS NULL AND e.propiedad <> 'Cliente'
  AND NOT EXISTS (SELECT 1 FROM equipos_motivos_revision m
                   WHERE m.equipo_id = e.id AND m.motivo_codigo = 'SIN_SERIAL');

-- La hoja de periféricos no tiene columna de etiqueta, así que su ausencia
-- ahí no es un hueco de datos y no se marca.
INSERT INTO hallazgo
SELECT 'B', 'sin etiqueta, de computo, no del cliente y no marcado', count(*)
FROM equipos e
WHERE e.etiqueta IS NULL AND e.propiedad <> 'Cliente'
  AND e.categoria IN ('Portátil', 'Desktop')
  AND NOT EXISTS (SELECT 1 FROM equipos_motivos_revision m
                   WHERE m.equipo_id = e.id AND m.motivo_codigo = 'SIN_ETIQUETA');

INSERT INTO hallazgo
SELECT 'B', 'sin marca, no del cliente y no marcado', count(*)
FROM equipos e
WHERE e.marca IS NULL AND e.propiedad <> 'Cliente'
  AND NOT EXISTS (SELECT 1 FROM equipos_motivos_revision m
                   WHERE m.equipo_id = e.id AND m.motivo_codigo = 'SIN_MARCA');

-- Todo equipo sin sede tiene que decir por qué.
INSERT INTO hallazgo
SELECT 'B', 'sin sede y sin explicar por que', count(*)
FROM equipos e
WHERE e.sede_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM equipos_motivos_revision m
                   WHERE m.equipo_id = e.id
                     AND m.motivo_codigo IN ('SIN_UBICACION', 'UBICACION_FUERA_DE_SEDES'));

-- El índice parcial garantiza que como mucho una de las filas de un serial
-- repetido esté sin marcar. Que TODAS lo estén no lo garantiza nadie.
INSERT INTO hallazgo
SELECT 'B', 'serial repetido con alguna fila sin marcar', count(*)
FROM equipos e
WHERE e.serial IS NOT NULL
  AND (SELECT count(*) FROM equipos o WHERE o.serial = e.serial) > 1
  AND NOT e.requiere_revision;

-- ===========================================================================
-- C. Exclusiones mutuas y códigos que no pueden existir en la BD
-- ===========================================================================

INSERT INTO hallazgo
SELECT 'C', 'SIN_UBICACION y UBICACION_FUERA_DE_SEDES a la vez', count(*)
FROM (SELECT equipo_id FROM equipos_motivos_revision
      WHERE motivo_codigo IN ('SIN_UBICACION', 'UBICACION_FUERA_DE_SEDES')
      GROUP BY equipo_id HAVING count(*) > 1) x;

INSERT INTO hallazgo
SELECT 'C', 'los dos motivos de serial repetido a la vez', count(*)
FROM (SELECT equipo_id FROM equipos_motivos_revision
      WHERE motivo_codigo IN ('SERIAL_DUPLICADO', 'SERIAL_REPETIDO_PERIFERICO')
      GROUP BY equipo_id HAVING count(*) > 1) x;

-- La comprobación de que lo que quedó fuera sigue fuera: estos dos códigos
-- describen filas que no son equipos, y esas se rechazan. Solo viven en el CSV.
INSERT INTO hallazgo
SELECT 'C', 'codigos de fila rechazada presentes en la BD', count(*)
FROM equipos_motivos_revision
WHERE motivo_codigo IN ('ESTADO_NO_APLICA', 'SIN_TIPO');

-- ===========================================================================
-- D. Coherencia con la hoja de origen. Detecta un cruce de hojas, que hoy
--    ninguna constraint vería.
-- ===========================================================================

INSERT INTO hallazgo
SELECT 'D', 'periferico con campos de portatil', count(*)
FROM equipos
WHERE categoria IN ('Monitor', 'Teclado', 'Mouse', 'Diadema')
  AND (etiqueta IS NOT NULL OR licencia_tipo IS NOT NULL OR sistema_operativo IS NOT NULL
       OR procesador IS NOT NULL OR disco IS NOT NULL OR ram IS NOT NULL
       OR bios_password_cifrado IS NOT NULL OR licencia_serial_cifrado IS NOT NULL);

-- La hoja de equipos no tiene columna de condición; si un portátil trae una,
-- vino del sitio equivocado.
INSERT INTO hallazgo
SELECT 'D', 'equipo de computo con condicion', count(*)
FROM equipos WHERE categoria IN ('Portátil', 'Desktop') AND condicion IS NOT NULL;

INSERT INTO hallazgo
SELECT 'D', 'propiedad Cliente que no es portatil', count(*)
FROM equipos WHERE propiedad = 'Cliente' AND categoria <> 'Portátil';

-- ===========================================================================
-- E. Forma del cifrado. Sin descifrar nada: solo longitudes.
--    12 bytes de IV + 16 de authTag + al menos 1 de contenido.
-- ===========================================================================

INSERT INTO hallazgo
SELECT 'E', 'bios cifrado demasiado corto para ser valido', count(*)
FROM equipos WHERE bios_password_cifrado IS NOT NULL AND length(bios_password_cifrado) < 29;

INSERT INTO hallazgo
SELECT 'E', 'licencia cifrada demasiado corta para ser valida', count(*)
FROM equipos WHERE licencia_serial_cifrado IS NOT NULL AND length(licencia_serial_cifrado) < 29;

-- ===========================================================================
-- F. Historia
-- ===========================================================================

INSERT INTO hallazgo
SELECT 'F', 'equipos sin ningun movimiento', count(*)
FROM equipos e
WHERE NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.equipo_id = e.id);

INSERT INTO hallazgo
SELECT 'F', 'equipos sin exactamente un Alta', count(*)
FROM equipos e
WHERE (SELECT count(*) FROM movimientos m WHERE m.equipo_id = e.id AND m.tipo = 'Alta') <> 1;

INSERT INTO hallazgo
SELECT 'F', 'equipos cuyo movimiento mas antiguo no es el Alta', count(*)
FROM equipos e
WHERE (SELECT m.tipo FROM movimientos m WHERE m.equipo_id = e.id
        ORDER BY m.fecha, m.created_at LIMIT 1) <> 'Alta';

-- Acotado a "un solo movimiento" a propósito: sin ese filtro, el primer
-- traslado legítimo de la etapa 5 lo pondría rojo sin que nada esté mal.
INSERT INTO hallazgo
SELECT 'F', 'equipo sin mover cuyo estado no coincide con su Alta', count(*)
FROM equipos e
JOIN movimientos m ON m.equipo_id = e.id
WHERE (SELECT count(*) FROM movimientos x WHERE x.equipo_id = e.id) = 1
  AND (m.sede_destino_id IS DISTINCT FROM e.sede_id
       OR m.empleado_destino_id IS DISTINCT FROM e.empleado_id);

-- ---------------------------------------------------------------------------
-- F2. Los movimientos de la etapa 5: cada tipo dice lo que su nombre promete
-- ---------------------------------------------------------------------------
--
-- Hasta la etapa 5 el único movimiento era el `Alta` del importador y estas
-- comprobaciones habrían sido vacías. Desde que hay seis mutaciones, un
-- movimiento mal rellenado es un historial que miente: una `Asignación` sin
-- destinatario no dice a quién se le dio el equipo, y eso es justo lo que se le
-- va a preguntar dentro de un año.

INSERT INTO hallazgo
SELECT 'F2', 'Asignacion sin empleado destino', count(*)
FROM movimientos m WHERE m.tipo = 'Asignación' AND m.empleado_destino_id IS NULL;

INSERT INTO hallazgo
SELECT 'F2', 'Devolucion sin empleado origen', count(*)
FROM movimientos m WHERE m.tipo = 'Devolución' AND m.empleado_origen_id IS NULL;

INSERT INTO hallazgo
SELECT 'F2', 'Traslado sin sede destino', count(*)
FROM movimientos m WHERE m.tipo = 'Traslado' AND m.sede_destino_id IS NULL;

-- Un traslado de una sede a sí misma no mueve nada y ocuparía la única ranura
-- de traslado abierto que tiene el equipo.
INSERT INTO hallazgo
SELECT 'F2', 'Traslado cuyo origen y destino son la misma sede', count(*)
FROM movimientos m WHERE m.tipo = 'Traslado' AND m.sede_origen_id = m.sede_destino_id;

-- `fecha_confirmacion` solo la usa el traslado. En cualquier otro tipo es una
-- confirmación de algo que nunca estuvo pendiente.
INSERT INTO hallazgo
SELECT 'F2', 'movimiento confirmado que no es un Traslado', count(*)
FROM movimientos m WHERE m.fecha_confirmacion IS NOT NULL AND m.tipo <> 'Traslado';

INSERT INTO hallazgo
SELECT 'F2', 'traslado confirmado antes de salir', count(*)
FROM movimientos m WHERE m.fecha_confirmacion IS NOT NULL AND m.fecha_confirmacion < m.fecha;

-- El índice único parcial ya lo impide. Se comprueba igual porque un índice
-- puede caerse en una restauración parcial, y este es el dato que diría dónde
-- está un equipo: con dos abiertos, en dos sitios.
INSERT INTO hallazgo
SELECT 'F2', 'equipos con mas de un traslado abierto', count(*)
FROM (SELECT m.equipo_id FROM movimientos m
       WHERE m.tipo = 'Traslado' AND m.fecha_confirmacion IS NULL
       GROUP BY m.equipo_id HAVING count(*) > 1) x;

-- ---------------------------------------------------------------------------
-- El invariante que la etapa 5 hace comprobable: el estado del equipo es el
-- que dejó su último movimiento de estado.
--
-- Los traslados quedan fuera del cálculo a propósito: no cambian el estado
-- (D13), así que un equipo asignado que viaja sigue `Asignado` y su último
-- movimiento es el `Traslado`. Mirar «el último movimiento» a secas lo pondría
-- rojo sin que nada esté mal.
--
-- Se sostiene porque el `PATCH` dejó de poder tocar `estado` y `empleado_id`
-- en la etapa 5. Si alguien reabre esa puerta, esta comprobación es la que se
-- pone roja, y por eso está aquí y no en un comentario.
-- ---------------------------------------------------------------------------

INSERT INTO hallazgo
SELECT 'F2', 'equipos cuyo estado no concuerda con su ultimo movimiento', count(*)
FROM equipos e
JOIN LATERAL (
  SELECT m.tipo
    FROM movimientos m
   WHERE m.equipo_id = e.id
     AND m.tipo IN ('Asignación', 'Devolución', 'Reserva', 'Liberación', 'Baja')
   ORDER BY m.fecha DESC, m.created_at DESC
   LIMIT 1
) ult ON true
WHERE e.estado <> CASE ult.tipo
                    WHEN 'Asignación' THEN 'Asignado'
                    WHEN 'Devolución' THEN 'Disponible'
                    WHEN 'Reserva'    THEN 'Reservado'
                    WHEN 'Liberación' THEN 'Disponible'
                    WHEN 'Baja'       THEN 'De baja'
                  END::estado_equipo;

-- La otra cara: el responsable tiene que ser el de la última asignación.
INSERT INTO hallazgo
SELECT 'F2', 'equipos asignados a alguien distinto del de su ultima Asignacion', count(*)
FROM equipos e
JOIN LATERAL (
  SELECT m.empleado_destino_id
    FROM movimientos m
   WHERE m.equipo_id = e.id AND m.tipo = 'Asignación'
   ORDER BY m.fecha DESC, m.created_at DESC
   LIMIT 1
) ult ON true
WHERE e.estado = 'Asignado' AND e.empleado_id IS DISTINCT FROM ult.empleado_destino_id;

-- Y la sede: la de un equipo con traslados confirmados es la del último.
INSERT INTO hallazgo
SELECT 'F2', 'equipos que no estan en el destino de su ultimo traslado confirmado', count(*)
FROM equipos e
JOIN LATERAL (
  SELECT m.sede_destino_id
    FROM movimientos m
   WHERE m.equipo_id = e.id
     AND m.tipo = 'Traslado' AND m.fecha_confirmacion IS NOT NULL
   ORDER BY m.fecha_confirmacion DESC
   LIMIT 1
) ult ON true
WHERE e.sede_id IS DISTINCT FROM ult.sede_destino_id;

-- ===========================================================================
-- G. Reconciliación de las corridas de importación
-- ===========================================================================

INSERT INTO hallazgo
SELECT 'G', 'corridas cuyas filas_insertadas no cuadran con la BD', count(*)
FROM importaciones i
WHERE i.filas_insertadas <> (SELECT count(*) FROM equipos e WHERE e.importacion_id = i.id);

INSERT INTO hallazgo
SELECT 'G', 'corridas cuyas filas_marcadas no cuadran con la BD', count(*)
FROM importaciones i
WHERE i.filas_marcadas <> (SELECT count(*) FROM equipos e
                            WHERE e.importacion_id = i.id AND e.requiere_revision);

INSERT INTO hallazgo
SELECT 'G', 'equipos marcados sin ningun motivo', count(*)
FROM equipos e
WHERE e.requiere_revision
  AND NOT EXISTS (SELECT 1 FROM equipos_motivos_revision m WHERE m.equipo_id = e.id);

INSERT INTO hallazgo
SELECT 'G', 'equipos con motivos pero sin marca', count(*)
FROM equipos e
WHERE NOT e.requiere_revision
  AND EXISTS (SELECT 1 FROM equipos_motivos_revision m WHERE m.equipo_id = e.id);

-- ===========================================================================
-- H. Actas (etapa 5a)
-- ===========================================================================
--
-- Lo que la base no puede imponer con una constraint. La FK compuesta ya
-- garantiza que el movimiento es del equipo del acta; lo que no puede
-- garantizar es que sea del TIPO que el acta dice documentar, ni que la
-- numeración no tenga huecos.

INSERT INTO hallazgo
SELECT 'H', 'actas sin ningun equipo', count(*)
FROM actas a
WHERE NOT EXISTS (SELECT 1 FROM actas_equipos ae WHERE ae.acta_id = a.id);

-- Un acta de Entrega tiene que colgar de una Asignación, y una de Devolución
-- de una Devolución. Cruzarlos daría un papel que dice «entregado» sobre el
-- movimiento en el que la persona lo devolvió.
INSERT INTO hallazgo
SELECT 'H', 'actas cuyo movimiento no concuerda con su tipo', count(*)
FROM actas_equipos ae
JOIN actas a ON a.id = ae.acta_id
JOIN movimientos m ON m.id = ae.movimiento_id
WHERE m.tipo <> CASE a.tipo WHEN 'Entrega' THEN 'Asignación'
                            WHEN 'Devolución' THEN 'Devolución' END::tipo_movimiento;

-- El acta es de la persona que aparece en el extremo correcto del movimiento.
-- Sin esto, el acta de Ana podría colgar de la entrega que se le hizo a Luis.
INSERT INTO hallazgo
SELECT 'H', 'actas cuya persona no es la del movimiento', count(*)
FROM actas_equipos ae
JOIN actas a ON a.id = ae.acta_id
JOIN movimientos m ON m.id = ae.movimiento_id
WHERE a.empleado_id IS DISTINCT FROM
      CASE a.tipo WHEN 'Entrega' THEN m.empleado_destino_id
                  ELSE m.empleado_origen_id END;

INSERT INTO hallazgo
SELECT 'H', 'consecutivos con formato inesperado', count(*)
FROM actas a WHERE a.consecutivo !~ '^ACT-\d{4}-\d{4,}$';

-- El año del número tiene que ser el de la fecha, o el consecutivo de 2027
-- empezaría a numerar sobre el contador de 2026.
INSERT INTO hallazgo
SELECT 'H', 'consecutivos cuyo anio no es el de la fecha', count(*)
FROM actas a
WHERE a.consecutivo ~ '^ACT-\d{4}-'
  AND substring(a.consecutivo from 5 for 4)::int <> extract(year FROM a.fecha AT TIME ZONE 'UTC');

-- Sin huecos: es lo que distingue el contador en tabla de una SEQUENCE (D25),
-- y lo único que lo comprueba de verdad sobre lo emitido.
INSERT INTO hallazgo
SELECT 'H', 'anios con huecos en la numeracion de actas', count(*)
FROM (
  SELECT substring(a.consecutivo from 5 for 4)::int AS anio,
         count(*) AS emitidas,
         max(substring(a.consecutivo from '\d+$')::int) AS maximo,
         min(substring(a.consecutivo from '\d+$')::int) AS minimo
    FROM actas a
   WHERE a.consecutivo ~ '^ACT-\d{4}-\d+$'
   GROUP BY 1
) x
WHERE x.minimo <> 1 OR x.maximo <> x.emitidas;

-- Y el contador no puede ir por detrás de lo emitido: si lo hiciera, la
-- siguiente acta reintentaría un número ya usado y chocaría con el UNIQUE.
INSERT INTO hallazgo
SELECT 'H', 'contadores que no cuadran con las actas emitidas', count(*)
FROM actas_consecutivo c
WHERE c.valor <> (
  SELECT count(*) FROM actas a
   WHERE a.consecutivo LIKE 'ACT-' || c.anio || '-%'
);

-- ===========================================================================

SELECT grupo, caso, filas,
       CASE WHEN filas = 0 THEN 'OK' ELSE '>>> FALLA' END AS veredicto
FROM hallazgo ORDER BY grupo, caso;

SELECT count(*) FILTER (WHERE filas <> 0) AS fallas,
       count(*) AS comprobaciones
FROM hallazgo;

-- Contexto: sobre cuántas filas se ha comprobado todo lo anterior.
SELECT (SELECT count(*) FROM equipos) AS equipos,
       (SELECT count(*) FROM empleados) AS empleados,
       (SELECT count(*) FROM equipos WHERE requiere_revision) AS marcados,
       (SELECT count(*) FROM equipos_motivos_revision) AS motivos,
       (SELECT count(*) FROM importaciones) AS corridas,
       -- Sin esto, las comprobaciones F2 saldrían verdes sobre cero
       -- movimientos de estado y no se vería que no comprobaron nada.
       (SELECT count(*) FROM movimientos WHERE tipo <> 'Alta') AS movimientos_de_estado,
       (SELECT count(*) FROM movimientos
         WHERE tipo = 'Traslado' AND fecha_confirmacion IS NULL) AS traslados_abiertos,
       -- Igual que arriba: sin actas, el grupo H sale verde sin comprobar nada
       -- y eso tiene que verse a simple vista.
       (SELECT count(*) FROM actas) AS actas;

DROP TABLE hallazgo;
