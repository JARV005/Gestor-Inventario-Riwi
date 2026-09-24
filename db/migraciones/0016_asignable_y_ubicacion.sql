-- Etapa 8a · D44 y D48.
--
-- Dos columnas nuevas en `equipos`, las dos empujadas por los ficheros de
-- quince hojas. Ninguna toca datos existentes: las dos tienen valor por
-- defecto y las 305 filas de hoy quedan como estaban.

-- ---------------------------------------------------------------------------
-- D44. Hay equipos que NUNCA se asignan a una persona
-- ---------------------------------------------------------------------------
--
-- Switches, access points, el rack, las impresoras, los equipos fijos de las
-- salas. Se inventarían y se mantienen; no se asignan, ni se reservan, ni se
-- prestan, ni salen en un acta.
--
-- **Lo impone la base y no la interfaz.** Excluirlos del selector deja la
-- puerta abierta: el día que alguien llame al endpoint a mano, asigna un switch
-- a una persona y nada lo para. Con la CHECK, el intento muere en Postgres
-- venga de donde venga.
ALTER TABLE equipos ADD COLUMN asignable boolean NOT NULL DEFAULT true;

-- Los tres estados que implican una persona o una empresa detrás quedan fuera
-- del alcance de un equipo no asignable, y con ellos las dos columnas que los
-- acompañan.
--
-- `De baja` y `En mantenimiento` SÍ se permiten: un switch se avería y se da de
-- baja igual que un portátil. Lo que no se hace es entregárselo a alguien.
ALTER TABLE equipos ADD CONSTRAINT equipos_no_asignable_sin_tenedor CHECK (
  asignable
  OR (
    empleado_id IS NULL
    AND prestado_a IS NULL
    AND estado::text NOT IN ('Asignado', 'Reservado', 'Prestado')
  )
);

COMMENT ON COLUMN equipos.asignable IS
  'D44. false = infraestructura: no se asigna, ni se reserva, ni se presta, ni '
  'sale en un acta. Mantenimiento sí aplica. Lo sostiene '
  'equipos_no_asignable_sin_tenedor, no la interfaz.';

-- ---------------------------------------------------------------------------
-- D48. Dónde está el equipo DENTRO de la sede
-- ---------------------------------------------------------------------------
--
-- Los ficheros nuevos traen «P3 OCCI», «P4 OCCI Review», «Pecera»,
-- «Reuniones P4», «P3 Rack», «BeLAB»… en 273 de sus 654 filas. El modelo solo
-- tiene `sede_id`, que para todas ellas es Medellín: sin esta columna, la sala
-- se pierde en la importación y con ella la única forma de encontrar
-- físicamente un equipo de sala.
--
-- Texto libre a propósito, y no una tabla de ubicaciones. No hay catálogo de
-- salas, los nombres los escribe quien inventaría, y una FK contra algo que
-- nadie mantiene convierte cada sala nueva en un error de importación.
-- Si algún día hay catálogo, esta columna dice qué habría que meter en él.
ALTER TABLE equipos ADD COLUMN ubicacion_detalle text;

COMMENT ON COLUMN equipos.ubicacion_detalle IS
  'D48. Dónde está dentro de la sede: sala, piso, rack. Texto libre: no hay '
  'catálogo de salas y una FK contra algo sin mantener rompería la importación.';
