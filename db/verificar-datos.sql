-- Comprueba que LO QUE HAY DENTRO es coherente. `npm run db:verificar-datos`.
--
-- Complementa `verificar-esquema.sql`, que solo comprueba que las reglas están
-- puestas. Ese pasa en una BD vacía; **este no**: sin inventario cargado, casi
-- todo da 0 y el fichero entero es vacuamente verde.
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

SELECT grupo, caso, filas,
       CASE WHEN filas = 0 THEN 'OK' ELSE '>>> FALLA' END AS veredicto
FROM hallazgo ORDER BY grupo, caso;

SELECT count(*) FILTER (WHERE filas <> 0) AS fallas,
       count(*) AS comprobaciones
FROM hallazgo;

-- Contexto, no comprobación: si esto sale vacío, el fichero entero es
-- vacuamente verde y hay que cargar el inventario antes de creerse nada.
SELECT (SELECT count(*) FROM equipos) AS equipos,
       (SELECT count(*) FROM empleados) AS empleados,
       (SELECT count(*) FROM equipos WHERE requiere_revision) AS marcados,
       (SELECT count(*) FROM equipos_motivos_revision) AS motivos,
       (SELECT count(*) FROM importaciones) AS corridas;

DROP TABLE hallazgo;
