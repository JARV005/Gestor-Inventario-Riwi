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

-- SIN_UBICACION dice que la celda venía vacía. Con sede puesta, la sede salió
-- de algún sitio que no es el archivo: eso sigue siendo un error.
INSERT INTO hallazgo
SELECT 'A', 'SIN_UBICACION con sede asignada', count(*)
FROM equipos e JOIN equipos_motivos_revision m ON m.equipo_id = e.id
WHERE m.motivo_codigo = 'SIN_UBICACION' AND e.sede_id IS NOT NULL;

-- UBICACION_FUERA_DE_SEDES, en cambio, YA NO implica sede vacía. Hasta la 5e
-- ninguna ubicación rara se mapeaba, así que las dos cosas iban siempre juntas;
-- ahora «Remoto - Sabaneta» se mapea a Remoto **y se marca**
-- (decisiones-05): el mapeo es para que salte el aviso de dirección de D30
-- sobre esa persona, y la marca es para que conste que el archivo no escribió
-- una sede. Con sede o sin ella, el código es correcto, así que no hay nada que
-- comprobar aquí — lo que sí se comprueba es el otro lado, en el grupo B: que
-- un equipo sin sede diga por qué.

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

-- La regla de fondo es que TODO ACTIVO SE PUEDA IDENTIFICAR, y hay dos formas
-- de conseguirlo: el serial o la etiqueta.
--
-- Hasta la etapa 8 se escribio como «sin serial tiene que estar marcado»,
-- porque las dos hojas de entonces no etiquetaban periféricos. Los 301
-- monitores y teclados de `INV - CE` SI llevan etiqueta, y todas distintas: son
-- activos perfectamente identificables sin serial, y marcarlos seria pedir a
-- una persona que busque un numero de serie que el aparato no tiene impreso.
--
-- **No se debilita: se exige lo que de verdad importa.** Una fila sin serial NI
-- etiqueta no se puede señalar en una estanteria, y esa sigue teniendo que
-- estar marcada.
INSERT INTO hallazgo
SELECT 'B', 'sin forma de identificarlo y sin marcar', count(*)
FROM equipos e
WHERE e.serial IS NULL AND e.etiqueta IS NULL AND e.propiedad <> 'Cliente'
  AND NOT EXISTS (SELECT 1 FROM equipos_motivos_revision m
                   WHERE m.equipo_id = e.id
                     AND m.motivo_codigo IN ('SIN_SERIAL', 'SIN_ETIQUETA'));

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

-- Todo equipo sin sede tiene que decir por qué, y hay TRES formas de decirlo.
--
-- Las dos marcas, y —desde la 5e— estar prestado: un equipo que tiene otra
-- empresa no está en ninguna sede nuestra, y `prestado_a` lo explica mejor que
-- una marca. Los dos equipos que RIWI prestó a ISF entran así, y marcarlos
-- además sería mandar a la bandeja de limpieza algo que no tiene nada que
-- limpiar (decisiones-05: «ISF como ubicación no es sede: es consecuencia del
-- préstamo»).
-- Desde la etapa 8 hay una CUARTA forma de explicarlo: la SALA (D48).
--
-- «P3 OCCI», «Pecera», «P3 Rack» no son sedes, pero tampoco son ausencia de
-- ubicacion: son donde esta el equipo dentro de una. Una fila con
-- `ubicacion_detalle` SI dice donde esta, asi que exigirle ademas una marca
-- mandaria a la bandeja 559 filas que no tienen nada que limpiar.
INSERT INTO hallazgo
SELECT 'B', 'sin sede y sin explicar por que', count(*)
FROM equipos e
WHERE e.sede_id IS NULL
  AND e.prestado_a IS NULL
  AND e.ubicacion_detalle IS NULL
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

-- La comprobación de que lo que quedó fuera sigue fuera.
--
-- Escrita como «ninguno de los dos códigos aparece en la BD», y eso era cierto
-- por accidente: en el archivo de la etapa 2, la única fila sin estado era
-- también la única sin tipo. En los dos archivos nuevos no: las dos filas con
-- las columnas corridas (BAQ-00022 y BAQ-00023) traen la casilla de estado
-- vacía y son portátiles Dell perfectamente reales.
--
-- Lo que rechaza una fila es tener LOS DOS a la vez —ni tipo ni estado no
-- describe ningún equipo (D7 a)—, y eso es lo que se comprueba.
INSERT INTO hallazgo
SELECT 'C', 'filas con ESTADO_NO_APLICA y SIN_TIPO a la vez', count(*)
FROM (SELECT equipo_id FROM equipos_motivos_revision
      WHERE motivo_codigo IN ('ESTADO_NO_APLICA', 'SIN_TIPO')
      GROUP BY equipo_id HAVING count(*) > 1) x;

-- ===========================================================================
-- D. Coherencia con la hoja de origen. Detecta un cruce de hojas, que hoy
--    ninguna constraint vería.
-- ===========================================================================

-- Un periférico no puede traer campos de COMPUTO: si los tiene, la fila se
-- leyó de la hoja equivocada o con las columnas corridas.
--
-- `etiqueta` SALIO de esta lista en la etapa 8. Estaba porque la hoja de
-- periféricos de la 5e no tenia esa columna, asi que una etiqueta en un monitor
-- solo podia venir de un cruce. Ya no: los 301 monitores y teclados de
-- `INV - CE` llevan etiqueta propia y unica, y es su identidad (D50).
INSERT INTO hallazgo
SELECT 'D', 'periferico con campos de computo', count(*)
FROM equipos
WHERE categoria IN ('Monitor', 'Teclado', 'Mouse', 'Diadema')
  AND (licencia_tipo IS NOT NULL OR sistema_operativo IS NOT NULL
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

-- Desde la etapa 8 una corrida inserta EQUIPOS y LICENCIAS, asi que sus
-- contadores tienen que sumar las dos. Contando solo equipos, las dos corridas
-- salian descuadradas en exactamente las 30 licencias del libro de RIWI.
INSERT INTO hallazgo
SELECT 'G', 'corridas cuyas filas_insertadas no cuadran con la BD', count(*)
FROM importaciones i
WHERE i.filas_insertadas <> (
    (SELECT count(*) FROM equipos e WHERE e.importacion_id = i.id)
  + (SELECT count(*) FROM licencias l WHERE l.importacion_id = i.id)
);

INSERT INTO hallazgo
SELECT 'G', 'corridas cuyas filas_marcadas no cuadran con la BD', count(*)
FROM importaciones i
WHERE i.filas_marcadas <> (
    (SELECT count(*) FROM equipos e WHERE e.importacion_id = i.id AND e.requiere_revision)
  + (SELECT count(*) FROM licencias l WHERE l.importacion_id = i.id AND l.requiere_revision)
);

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

-- El formato pasó a ser `PREFIJO-0000`, una serie por empresa y sin año (D40).
--
-- **Dos prefijos y no tres**: `SC` se retiró en la 5f-2 (D42). Si aparece uno,
-- es que alguien emitió un acta sin remitente por un camino que se saltó la
-- guarda, y eso hay que verlo.
INSERT INTO hallazgo
SELECT 'H', 'consecutivos con formato inesperado', count(*)
FROM actas a WHERE a.consecutivo !~ '^(RIWI|BBL)-\d{4,}$';

-- Nadie puede emitir un acta sin empresa (D42). Lo impone una guarda en el
-- repositorio y el tipo de `PREFIJO_CONSECUTIVO`; aquí se comprueba que lo
-- CARGADO lo cumple, que es la otra mitad — una guarda se puede quitar.
INSERT INTO hallazgo
SELECT 'H', 'actas emitidas sin empresa asignada', count(*)
FROM actas a WHERE a.empresa = 'Sin clasificar';

-- Y su contador tampoco debería existir. Una fila `Sin clasificar` aquí es un
-- número reservado para una serie que no puede emitir: si aparece, alguien
-- numeró un acta que después no se guardó.
INSERT INTO hallazgo
SELECT 'H', 'contador de una serie que no puede emitir', count(*)
FROM actas_consecutivo c WHERE c.empresa = 'Sin clasificar';

-- Y el prefijo tiene que ser el de SU empresa. Sin esto, un acta de BBL podría
-- llevar número de la serie de RIWI: dos documentos legales distintos con el
-- mismo número, que es justo lo que el prefijo vino a evitar.
INSERT INTO hallazgo
SELECT 'H', 'consecutivos cuyo prefijo no es el de su empresa', count(*)
FROM actas a
WHERE split_part(a.consecutivo, '-', 1) <> CASE a.empresa
        WHEN 'RIWI' THEN 'RIWI'
        WHEN 'BBL Labs' THEN 'BBL'
        -- Sin rama por defecto a propósito: `Sin clasificar` da NULL, el
        -- `<>` no es cierto y la fila NO cae aquí. La cuenta el caso de
        -- arriba, que es el que sabe qué decir de ella.
        END;

-- Sin huecos DENTRO DE CADA SERIE: es lo que distingue el contador en tabla de
-- una SEQUENCE (D25), y lo único que lo comprueba de verdad sobre lo emitido.
--
-- El mínimo es CERO y no uno: la primera acta de cada empresa es la `0000`
-- (D40). Escrito como estaba —`minimo <> 1`— este caso habría dado por rota
-- toda serie correcta.
INSERT INTO hallazgo
SELECT 'H', 'series con huecos en la numeracion de actas', count(*)
FROM (
  SELECT split_part(a.consecutivo, '-', 1) AS serie,
         count(*) AS emitidas,
         max(substring(a.consecutivo from '\d+$')::int) AS maximo,
         min(substring(a.consecutivo from '\d+$')::int) AS minimo
    FROM actas a
   WHERE a.consecutivo ~ '^(RIWI|BBL)-\d+$'
   GROUP BY 1
) x
WHERE x.minimo <> 0 OR x.maximo <> x.emitidas - 1;

-- Y el contador no puede ir por detrás de lo emitido: si lo hiciera, la
-- siguiente acta reintentaría un número ya usado y chocaría con el UNIQUE.
--
-- `valor` es el ÚLTIMO número dado, no cuántas van: con la serie arrancando en
-- cero, las dos cosas se diferencian en uno. Contar actas y comparar contra
-- `valor` a secas marcaría en rojo todas las series correctas.
INSERT INTO hallazgo
SELECT 'H', 'contadores que no cuadran con las actas emitidas', count(*)
FROM actas_consecutivo c
WHERE c.valor <> (
  SELECT count(*) FROM actas a WHERE a.empresa = c.empresa
) - 1
  AND EXISTS (SELECT 1 FROM actas a WHERE a.empresa = c.empresa);

-- La sección 5 va guardada en toda entrega con documento, y en ninguna
-- devolución (D41). Lo impone una CHECK desde la 0015; aquí se comprueba que
-- lo CARGADO la cumple, que es la otra mitad.
INSERT INTO hallazgo
SELECT 'H', 'actas cuyo chequeo no cuadra con su tipo', count(*)
FROM actas a
WHERE (a.chequeo IS NOT NULL) <> (a.pdf IS NOT NULL AND a.tipo = 'Entrega');


-- ---------------------------------------------------------------------------
-- Grupo J - equipos de infraestructura (etapa 8, D44)
-- ---------------------------------------------------------------------------
--
-- Lo impone una CHECK desde la 0016, asi que esto no comprueba que la regla
-- exista: comprueba que lo CARGADO la cumple. Que esten los dos es deliberado
-- —una CHECK se puede dejar caer en una migracion futura y este seguiria
-- hablando—, el mismo criterio que el grupo I.
--
-- Con su linea de contexto abajo: mientras no haya ni un equipo marcado como
-- infraestructura, las consultas devuelven cero sin haber mirado nada, y
-- «ninguno lo incumple» y «no hay ninguno» se leen igual.
INSERT INTO hallazgo
SELECT 'J', 'infraestructura a nombre de una persona', count(*)
FROM equipos e WHERE NOT e.asignable AND e.empleado_id IS NOT NULL;

INSERT INTO hallazgo
SELECT 'J', 'infraestructura prestada a otra empresa', count(*)
FROM equipos e WHERE NOT e.asignable AND e.prestado_a IS NOT NULL;

INSERT INTO hallazgo
SELECT 'J', 'infraestructura en estado que implica tenedor', count(*)
FROM equipos e
WHERE NOT e.asignable AND e.estado::text IN ('Asignado', 'Reservado', 'Prestado');

-- Un equipo de infraestructura no puede aparecer en un acta: no se entrega. La
-- CHECK no lo alcanza —el acta es otra tabla— asi que este es el unico sitio
-- donde se comprueba.
INSERT INTO hallazgo
SELECT 'J', 'infraestructura dentro de un acta', count(*)
FROM actas_equipos ae
JOIN equipos e ON e.id = ae.equipo_id
WHERE NOT e.asignable;

-- ---------------------------------------------------------------------------
-- Grupo I — préstamos entre empresas (5e)
-- ---------------------------------------------------------------------------
--
-- Los dos primeros casos los impone además una CHECK desde la 0012, así que
-- aquí no comprueban que la regla exista: comprueban que lo CARGADO la cumple.
-- Que estén repetidos es deliberado — una CHECK se puede dejar caer en una
-- migración futura y estos seguirían hablando.
--
-- **Y van con su línea de contexto abajo.** Escritos antes de reimportar
-- habrían dado tres verdes de vacío: sin un solo equipo prestado, las tres
-- consultas devuelven cero infractores sin haber mirado nada. La diferencia
-- entre «ninguno los incumple» y «no hay ninguno» es justo la que hace inútil a
-- un verificador, y solo se ve con el conteo delante.

-- «Sin marcar» y no «sin prestatario» a secas: un equipo prestado del que el
-- archivo no dice a quién es un dato incompleto y legítimo mientras lleve su
-- motivo (D34, la etiqueta 0798). Sin marca, en cambio, nadie lo va a resolver
-- nunca. Es la misma forma que el resto de casos «y sin marcar» del fichero.
INSERT INTO hallazgo
SELECT 'I', 'prestados sin prestatario y sin marcar', count(*)
FROM equipos e
WHERE e.estado = 'Prestado' AND e.prestado_a IS NULL AND NOT e.requiere_revision;

INSERT INTO hallazgo
SELECT 'I', 'prestatario sobre un equipo que no esta Prestado', count(*)
FROM equipos e WHERE e.prestado_a IS NOT NULL AND e.estado <> 'Prestado';

-- Un equipo «prestado a su propia empresa» no es un préstamo: es una fila mal
-- puesta, y además saldría dos veces en la vista de esa empresa, porque el
-- filtro es `empresa = X OR prestado_a = X`.
INSERT INTO hallazgo
SELECT 'I', 'equipos prestados a su propia empresa', count(*)
FROM equipos e
WHERE e.prestado_a IS NOT NULL AND e.prestado_a::text = e.empresa::text;

-- El serial es la identidad física de la máquina: si el mismo aparece bajo dos
-- empresas y nadie lo ha marcado, es que el cruce entre archivos no lo resolvió
-- y hay dos filas para un solo portátil. Es el invariante que D31 existe para
-- sostener — una fila por máquina física.
INSERT INTO hallazgo
SELECT 'I', 'mismo serial en dos empresas sin marcar', count(*)
FROM (
  SELECT e.serial
    FROM equipos e
   WHERE e.serial IS NOT NULL AND NOT e.requiere_revision
   GROUP BY e.serial
  HAVING count(DISTINCT e.empresa) > 1
) x;

-- Un equipo prestado que no dice dónde está no es raro —el prestatario lo
-- tiene—, pero uno prestado Y con sede propia sí: o volvió y nadie lo registró,
-- o la sede es la del dueño y no la de quien lo usa. Solo se avisa de los que
-- además no están marcados.
INSERT INTO hallazgo
SELECT 'I', 'prestados con sede propia y sin marcar', count(*)
FROM equipos e
WHERE e.estado = 'Prestado' AND e.sede_id IS NOT NULL AND NOT e.requiere_revision;

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
       (SELECT count(*) FROM actas) AS actas,
       -- Sin esto, el grupo I entero sale verde sobre cero equipos prestados y
       -- nadie distinguiría «ninguno los incumple» de «no hay ninguno».
       (SELECT count(*) FROM equipos WHERE estado = 'Prestado') AS prestados,
       (SELECT string_agg(t.prestado_a || '=' || t.n, ' ' ORDER BY t.prestado_a)
          FROM (SELECT prestado_a::text AS prestado_a, count(*) AS n
                  FROM equipos WHERE prestado_a IS NOT NULL
                 GROUP BY 1) t) AS reparto_prestamos;

-- ---------------------------------------------------------------------------
-- Y ahora, que el proceso FALLE si hay alguna falla.
-- ---------------------------------------------------------------------------
--
-- Sin esto, psql imprime «fallas: 3» y sale con código 0: `ON_ERROR_STOP` solo
-- reacciona a errores de SQL, no a una fila de resultado que diga que algo está
-- mal. Durante toda la etapa 5 el veredicto lo he leído a ojo en la salida, y
-- eso funciona hasta que alguien encadena `npm run db:verificar &&` en un
-- script o deja de mirar. Se descubrió al cerrar la etapa: la migración 0010
-- rompió un caso del verificador de esquema y el comando siguió saliendo en
-- verde.
--
-- Es la misma clase de fallo que el `# fail 0` con exit 1 de node:test, por el
-- otro lado: el resumen y el código de salida contando cosas distintas.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM hallazgo WHERE filas <> 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'verificar-datos: % comprobacion(es) en rojo. Ver la tabla de arriba.', n;
  END IF;
END $$;

DROP TABLE hallazgo;
