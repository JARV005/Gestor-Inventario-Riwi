-- 5f-2 · D40 y D41.
--
-- Dos cambios en la instantánea del acta, en la misma migración porque los dos
-- salen del mismo formato aprobado por BBL y los dos afectan a los bytes del
-- PDF.
--
-- `actas`, `actas_equipos` y `actas_consecutivo` estaban VACÍAS al escribir
-- esto —comprobado con un count(*) sobre las tres—, así que no hay ninguna
-- serie viva que reencajar ni ningún acta a la que inventarle un chequeo.

-- ---------------------------------------------------------------------------
-- D40. El consecutivo pasa de una serie por año a una serie por empresa
-- ---------------------------------------------------------------------------
--
-- El formato nuevo es `BBL-0000` / `RIWI-0000`: **no lleva el año**. Con la
-- tabla clavada en `anio` la serie se reiniciaría cada 1 de enero y el segundo
-- año chocaría contra el UNIQUE de `actas.consecutivo` en el acta número uno.
-- La clave tiene que ser exactamente lo que distingue una serie de otra, y eso
-- ahora es la empresa.
--
-- De regalo, y no como efecto secundario: dos actas simultáneas de empresas
-- distintas dejan de serializarse entre sí, porque bloquean filas distintas.
--
-- Se recrea en vez de alterarse porque está vacía: un DROP + CREATE de dos
-- columnas se lee entero de una vez, y una escalera de cuatro ALTER para
-- cambiar la clave primaria de una tabla sin filas no compra nada.
DROP TABLE actas_consecutivo;

CREATE TABLE actas_consecutivo (
  empresa empresa PRIMARY KEY,
  valor integer NOT NULL,
  -- Era `> 0` y ahora es `>= 0`. La primera acta de cada empresa es la `0000`,
  -- así que el contador arranca en cero: con la CHECK anterior el primer POST
  -- de cada serie habría muerto contra la constraint.
  CONSTRAINT actas_consecutivo_no_negativo CHECK (valor >= 0)
);

-- ---------------------------------------------------------------------------
-- D41. La lista de chequeo entra en la instantánea, porque entra en el hash
-- ---------------------------------------------------------------------------
--
-- La sección 5 se imprime en el PDF, así que sus cuatro respuestas forman
-- parte de los bytes y por tanto del `hash_sha256`. `recalcularHash` regenera
-- el acta **desde su instantánea** para comprobar que el PDF guardado no se ha
-- tocado: sin el chequeo dentro, la regeneración lo pintaría vacío, los bytes
-- saldrían distintos y la comprobación diría que el documento no cuadra.
--
-- Es el mismo modo de fallo que la empresa en la 0014, y el peor que puede
-- tener esa función: no revienta, ACUSA. Alguien miraría un acta legítima y
-- concluiría que la habían manipulado.
--
-- JSONB y no una tabla puente: es contenido congelado de un documento firmado,
-- no una relación que nadie va a consultar. Si mañana cambian los items, las
-- actas viejas conservan la forma que tenían, que es lo correcto aquí.
ALTER TABLE actas ADD COLUMN chequeo jsonb;

-- La CHECK de la instantánea pasa a cubrir las cuatro columnas, no tres.
--
-- El chequeo NO puede ir en el mismo «todas o ninguna» que las otras: la
-- sección 5 solo existe en las entregas, y un acta de devolución con PDF tiene
-- que poder tener el chequeo a NULL. La regla es una equivalencia con dos
-- condiciones:
--
--   hay chequeo  ⟺  hay PDF  Y  el acta es de entrega
--
-- que corta los tres errores a la vez: un acta sin documento con chequeo
-- guardado, una entrega con PDF y sin él, y una devolución que se inventa una
-- sección que su formato no tiene.
--
-- `tipo` es un enum que ya existía antes de esta migración, así que se compara
-- directo. El rodeo por `::text` de la 0012 hacía falta para valores AÑADIDOS
-- en la misma transacción, que es otra cosa.
ALTER TABLE actas DROP CONSTRAINT actas_pdf_con_hash;

ALTER TABLE actas ADD CONSTRAINT actas_pdf_con_hash CHECK (
  (pdf IS NULL) = (hash_sha256 IS NULL)
  AND (pdf IS NULL) = (plantilla_version IS NULL)
  AND (chequeo IS NOT NULL) = (pdf IS NOT NULL AND tipo = 'Entrega')
);
