-- Retira los motivos que ya estaban contradichos, y se asegura de que no queda
-- ninguno.
--
-- ===========================================================================
-- POR QUÉ HACE FALTA UNA SEGUNDA MIGRACIÓN
-- ===========================================================================
--
-- La 0018 pone la regla, pero sus triggers son DEFERRABLE y cuelgan de
-- `equipos` y de `equipos_motivos_revision`. Su propio `UPDATE` sobre
-- `motivos_revision` no los dispara, así que la 0018 se aplicó limpia sobre una
-- base que violaba la regla que acababa de crear: el equipo 0468 seguía
-- `Asignado`, con responsable y con las dos marcas puestas.
--
-- Una constraint nueva que se instala sin mirar si los datos la cumplen es una
-- constraint que no protege nada hasta el siguiente cambio. Esta migración
-- cierra eso: limpia lo contradicho y **falla si queda algo**, así que ninguna
-- base puede pasar de aquí llevándose la contradicción dentro. Importa
-- especialmente para la VPS, cuya base entra por un volcado del portátil.
--
-- ===========================================================================
-- ESTO NO ES DECIDIR NADA SOBRE LOS DATOS
-- ===========================================================================
--
-- Los 495 equipos marcados se resuelven desde la aplicación, uno a uno o por
-- bloques, porque cada uno necesita que alguien averigüe algo. Aquí no hay nada
-- que averiguar: el motivo dice «no se sabe quién lo tiene» y la fila registra
-- quién lo tiene, puesto por una persona desde la interfaz y con su movimiento
-- en `movimientos`. Quitar la marca no elige entre dos posibilidades, retira una
-- afirmación que los propios datos ya desmintieron.
--
-- La condición es `estado = 'Asignado'` y no solo `empleado_id IS NOT NULL`:
-- en `Prestado` esa columna no es el responsable, es quién tiene el equipo
-- mientras está prestado, y no contradice a ningún motivo. Lo acotó la 0020,
-- que es donde está explicado; aquí se repite para que una base creada de cero
-- no borre de más al pasar por esta migración antes de llegar a esa.
--
-- Lo que sí se conserva es el rastro: se escribe su fila en `auditoria`, porque
-- una marca que desaparece sin dejar constancia es indistinguible de una que
-- nunca estuvo.

-- ---------------------------------------------------------------------------
-- 1. El rastro, ANTES de borrar
-- ---------------------------------------------------------------------------
--
-- En el mismo orden que en el repositorio y por el mismo motivo: escrito
-- después, un fallo a mitad dejaría el motivo retirado y su rastro no.
--
-- Se atribuye al usuario de sistema (D4), que es el que existe justamente para
-- que un cambio no hecho por una persona quede distinguible para siempre.
INSERT INTO auditoria (tabla, registro_id, accion, usuario_app_id, ip, antes, despues)
SELECT
  'equipos',
  e.id,
  'retirar_motivos_resueltos',
  (SELECT u.id FROM usuarios_app u WHERE u.email = 'sistema@bbl.local'),
  NULL,
  jsonb_build_object(
    'motivos',
    (SELECT jsonb_agg(emr.motivo_codigo ORDER BY emr.motivo_codigo)
       FROM equipos_motivos_revision emr
       JOIN motivos_revision mr ON mr.codigo = emr.motivo_codigo
      WHERE emr.equipo_id = e.id AND mr.implica_sin_responsable),
    'requiere_revision', true
  ),
  jsonb_build_object(
    'por_operacion', 'migracion_0019',
    'nota', 'El equipo tenia responsable registrado: el motivo estaba contradicho por su propia fila'
  )
FROM equipos e
WHERE e.estado = 'Asignado' AND e.empleado_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM equipos_motivos_revision emr
    JOIN motivos_revision mr ON mr.codigo = emr.motivo_codigo
    WHERE emr.equipo_id = e.id AND mr.implica_sin_responsable
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Los motivos contradichos
-- ---------------------------------------------------------------------------
DELETE FROM equipos_motivos_revision emr
USING equipos e, motivos_revision mr
WHERE emr.equipo_id = e.id
  AND mr.codigo = emr.motivo_codigo
  AND mr.implica_sin_responsable
  AND e.estado = 'Asignado' AND e.empleado_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. La marca, para los que se quedaron sin ningún motivo
-- ---------------------------------------------------------------------------
--
-- Lo exige el trigger deferido de la 0006: la marca y la existencia de motivos
-- son el mismo hecho. Sin esto, la transacción de la migración no llegaría al
-- COMMIT.
--
-- Y bajarla reactiva los índices únicos parciales de `serial` y `etiqueta`
-- (etapa 2): si uno de estos equipos tuviera un duplicado sin marcar, el UPDATE
-- sería rechazado y la migración entera se desharía. Es lo correcto — cerrar la
-- limpieza en falso es lo que la etapa 2 no permite.
UPDATE equipos e SET requiere_revision = false
WHERE e.requiere_revision
  AND NOT EXISTS (
    SELECT 1 FROM equipos_motivos_revision emr WHERE emr.equipo_id = e.id
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Y ahora se afirma que no queda ninguna
-- ---------------------------------------------------------------------------
--
-- Es lo que convierte esta migración en una garantía y no en un apaño: si algo
-- de lo de arriba no cubrió un caso, la migración no pasa. Un `DELETE` que se
-- cree completo y no lo esté es indistinguible de uno que sí, salvo por esto.
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
      '0019: quedan % equipos con responsable y un motivo que dice que no se sabe quien lo tiene. La limpieza de esta migracion no los cubrio.',
      v_quedan
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
