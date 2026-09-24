-- Etapa 8b · D43. El inventario de licencias.
--
-- Vuelve el módulo que la etapa 0 retiró porque no existía. Ahora existe: 30
-- filas en `INV - LICENCIAS` con su key, el equipo donde está activada y su
-- estado.
--
-- **No es el módulo SaaS del prototipo.** Aquello tenía asientos, renovaciones
-- y proveedores. Esto es un inventario: una key, dónde está puesta, y quién
-- responde por ella.

CREATE TYPE estado_licencia AS ENUM ('Activada', 'Disponible', 'Vencida', 'Retirada');

CREATE TABLE licencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Qué es. `Local` y `Cuenta` en el fichero de hoy; texto y no enum porque el
  -- catálogo lo pone quien compra, no quien programa, y un valor nuevo no debe
  -- reventar una importación.
  tipo text NOT NULL,
  descripcion text NOT NULL,

  -- ==========================================================================
  -- LA KEY ES UN SECRETO DEL §5. MISMAS REGLAS QUE `bios_password`.
  -- ==========================================================================
  --
  -- AES-256-GCM con el mecanismo de `db/cifrado.ts` — el que ya existe, no un
  -- segundo—. No sale en listados, ni en exportaciones, ni en logs: se lee de
  -- una en una por rol admin y cada lectura deja su fila en `auditoria`.
  --
  -- `bytea` y NULL permitido: una licencia puede estar registrada sin que
  -- todavía se sepa su key, y guardar una cadena vacía cifrada sería un secreto
  -- que no lo es.
  key_cifrada bytea,

  /*
   * Dónde está activada.
   *
   * FK cuando el equipo se puede resolver, NULL cuando no. Doce de las treinta
   * filas apuntan a equipos `BAQ-000xx` de Barranquilla, que no están en los
   * ficheros de Medellín: esas entran con `equipo_id` a NULL y el texto
   * original conservado en `equipo_referencia`.
   *
   * ON DELETE RESTRICT: una licencia activada es una razón para no borrar el
   * equipo de un plumazo, igual que un acta.
   */
  equipo_id uuid REFERENCES equipos(id) ON DELETE RESTRICT,
  /*
   * Lo que decía el fichero, tal cual, se resuelva o no.
   *
   * No es redundante con la FK: cuando `equipo_id` es NULL, esto es lo ÚNICO
   * que dice a qué apuntaba. Sin ella, las doce de Barranquilla se convertirían
   * en doce licencias sin destino y nadie podría reconciliarlas cuando lleguen
   * sus ficheros.
   */
  equipo_referencia text,

  estado estado_licencia NOT NULL DEFAULT 'Disponible',
  usuario_responsable text,
  ubicacion text,
  notas text,

  -- Como en `equipos`: la fila entra marcada cuando el importador no puede dar
  -- algo por bueno, y la bandeja la resuelve.
  requiere_revision boolean NOT NULL DEFAULT false,
  importacion_id uuid REFERENCES importaciones(id) ON DELETE SET NULL,

  /*
   * Una licencia activada tiene que decir DÓNDE, de una de las dos formas.
   *
   * Sin esto, `Activada` con las dos columnas vacías sería una licencia puesta
   * en ninguna parte: el estado afirmaría algo que ningún dato sostiene, que es
   * justo el tipo de fila que nadie descubre hasta que la busca.
   */
  CONSTRAINT licencias_activada_dice_donde CHECK (
    estado <> 'Activada' OR equipo_id IS NOT NULL OR equipo_referencia IS NOT NULL
  ),

  /*
   * Y al revés: si no está activada, no puede estar apuntando a un equipo.
   *
   * Una licencia `Disponible` con `equipo_id` puesto es la contradicción que
   * hace que el conteo de licencias libres mienta.
   */
  CONSTRAINT licencias_solo_activada_tiene_equipo CHECK (
    estado = 'Activada' OR equipo_id IS NULL
  )
);

-- La misma key no puede estar registrada dos veces: sería contar dos licencias
-- donde hay una, y al activarlas en equipos distintos nadie sabría cuál vale.
-- Parcial sobre `requiere_revision` como en `equipos`: una fila marcada está
-- esperando a una persona y no debe chocar contra otra igual de dudosa.
CREATE UNIQUE INDEX idx_licencias_key_unica
  ON licencias (key_cifrada)
  WHERE key_cifrada IS NOT NULL AND NOT requiere_revision;

CREATE INDEX idx_licencias_equipo ON licencias (equipo_id);
CREATE INDEX idx_licencias_estado ON licencias (estado);

COMMENT ON COLUMN licencias.key_cifrada IS
  'D43. Secreto del §5: AES-256-GCM, nunca en listados ni exportaciones, una a '
  'una por admin y con su fila en auditoria.';
COMMENT ON COLUMN licencias.equipo_referencia IS
  'D43. Lo que decia el fichero. Cuando equipo_id es NULL, es lo unico que dice '
  'a que apuntaba: las 12 de Barranquilla se reconcilian por aqui.';
