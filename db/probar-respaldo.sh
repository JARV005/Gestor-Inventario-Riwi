#!/usr/bin/env bash
#
# Prueba del ciclo de respaldo y restauración. Etapa 7.
#
#   ./db/probar-respaldo.sh
#
# ============================================================================
# POR QUÉ EXISTE ESTE FICHERO
# ============================================================================
#
# `npm test` no toca nada de esto, y los fallos que tenían `respaldar.sh` y
# `restaurar.sh` la primera vez que se corrieron de verdad fueron cinco:
#
#   1. `CREATE DATABASE verificacion_20260925-121744` — el sello llevaba un
#      guion y no es un identificador válido. El respaldo no podía verificarse.
#   2. `read` de la confirmación llegaba a EOF, porque `docker compose exec -T`
#      hereda stdin y lo consume. `--en-serio` no restauraba nada y salía sin
#      decir por qué.
#   3. `pg_restore --clean` no vaciaba la base: una tabla creada después del
#      respaldo seguía ahí mientras el script decía «restaurada y comprobada».
#   4. Vaciar solo `public` dejaba el esquema `drizzle` en pie y el
#      `pg_restore` moría con «__drizzle_migrations_id_seq already exists».
#   5. Las herramientas compiladas salían con extensión `.js` y no arrancaban,
#      porque el package.json declara `"type": "module"`.
#
# Ninguno se ve leyendo el código y los cinco salen en un minuto de correrlo.
# Así que se corre: antes de un despliegue, y una vez en la VPS recién montada.
#
# NO deja nada puesto. Trabaja sobre la base que le digas, y comprueba al final
# que quedó con las mismas filas que al empezar.

set -euo pipefail
exec < /dev/null

COMPOSE="${COMPOSE:-docker compose -f docker-compose.produccion.yml}"
ENV_FICHERO="${ENV_FICHERO:-.env}"

psql_() { $COMPOSE exec -T postgres psql -tAq "$@" < /dev/null; }

fallos=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
mal()  { printf '  \033[31mMAL\033[0m   %s\n' "$1"; fallos=$((fallos + 1)); }

echo "── Prueba del ciclo de respaldo ───────────────────────────────────"
echo

# ---------------------------------------------------------------------------
# 0. El punto de partida, para poder comprobar que volvemos a él
# ---------------------------------------------------------------------------
EQUIPOS_ANTES=$(psql_ -c 'SELECT count(*) FROM equipos;')
CIFRADAS_ANTES=$(psql_ -c 'SELECT count(*) FROM equipos WHERE bios_password_cifrado IS NOT NULL;')
echo "Partida: ${EQUIPOS_ANTES} equipos, ${CIFRADAS_ANTES} filas cifradas."

# Un respaldo probado sobre una base sin nada cifrado no prueba lo que importa.
if [ "$CIFRADAS_ANTES" = "0" ]; then
  echo
  echo "ABORTA: esta base no tiene ni una fila cifrada." >&2
  echo "        La prueba pasaría sin comprobar el descifrado, que es su motivo" >&2
  echo "        de ser. Cargar los datos antes." >&2
  exit 1
fi
echo

# ---------------------------------------------------------------------------
# 1. Las herramientas de la imagen arrancan
# ---------------------------------------------------------------------------
echo "1. Las herramientas compiladas de la imagen"
for H in migrar semillas crear-usuario verificar-cifrado; do
  # Se busca el error de módulo, no el éxito: `migrar` sin argumentos hace su
  # trabajo y `crear-usuario` se queja de que faltan, y las dos cosas están bien.
  # Lo que no puede salir es que node no sepa cargar el fichero.
  SALIDA=$($COMPOSE run --rm --no-deps app node "dist/herramientas/${H}.cjs" 2>&1 || true)
  case "$SALIDA" in
    *'require is not defined'*|*'Cannot find module'*|*'ERR_REQUIRE_ESM'*)
      mal "${H}.cjs no se puede cargar" ;;
    *) ok "${H}.cjs carga" ;;
  esac
done
echo

# ---------------------------------------------------------------------------
# 2. Los cuatro códigos de verificar-cifrado
# ---------------------------------------------------------------------------
echo "2. verificar-cifrado distingue sus cuatro casos"

codigo_cifrado() {
  set +e
  $COMPOSE run --rm --no-deps -e "DATABASE_URL=$1" \
    app node dist/herramientas/verificar-cifrado.cjs > /dev/null 2>&1
  local c=$?
  set -e
  echo "$c"
}

POSTGRES_USER="${POSTGRES_USER:-$(sed -n 's/^[[:space:]]*POSTGRES_USER[[:space:]]*=[[:space:]]*//p' "$ENV_FICHERO" 2>/dev/null | tail -1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/')}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(sed -n 's/^[[:space:]]*POSTGRES_PASSWORD[[:space:]]*=[[:space:]]*//p' "$ENV_FICHERO" 2>/dev/null | tail -1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/')}"
POSTGRES_DB="${POSTGRES_DB:-$(sed -n 's/^[[:space:]]*POSTGRES_DB[[:space:]]*=[[:space:]]*//p' "$ENV_FICHERO" 2>/dev/null | tail -1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/')}"
BASE="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432"

[ "$(codigo_cifrado "${BASE}/${POSTGRES_DB}")" = "0" ] \
  && ok "0 con la clave buena" || mal "no da 0 con la clave buena"

[ "$(codigo_cifrado 'postgres://x:y@no-existe-esta-base:5432/nada')" = "3" ] \
  && ok "3 con la base inalcanzable (no 1: no se sabe)" \
  || mal "no da 3 con la base inalcanzable"

# Una base migrada y vacía: el «verde de vacío» que no debe pasar.
LIMPIA="prueba_vacia_$(date +%s)"
psql_ -c "CREATE DATABASE ${LIMPIA};" > /dev/null
limpiar_limpia() { psql_ -c "DROP DATABASE IF EXISTS ${LIMPIA};" > /dev/null 2>&1 || true; }
trap limpiar_limpia EXIT
$COMPOSE run --rm --no-deps -e "DATABASE_URL=${BASE}/${LIMPIA}" \
  app node dist/herramientas/migrar.cjs > /dev/null 2>&1
[ "$(codigo_cifrado "${BASE}/${LIMPIA}")" = "2" ] \
  && ok "2 con la base migrada y sin cifrar (no pasa en verde)" \
  || mal "no da 2 con la base sin filas cifradas"
limpiar_limpia
trap - EXIT
echo

# ---------------------------------------------------------------------------
# 3. respaldar.sh
# ---------------------------------------------------------------------------
echo "3. respaldar.sh vuelca y se verifica solo"
if COMPOSE="$COMPOSE" ENV_FICHERO="$ENV_FICHERO" ./db/respaldar.sh > /dev/null 2>&1; then
  ok "respaldar.sh termina en verde"
else
  mal "respaldar.sh falla"
fi

DUMP=$($COMPOSE exec -T postgres sh -c 'ls -1t /respaldos/riwistock-*.dump 2>/dev/null | head -1' < /dev/null | tr -d '\r')
[ -n "$DUMP" ] && ok "dejó un fichero: $(basename "$DUMP")" || mal "no dejó ningún fichero"
echo

# ---------------------------------------------------------------------------
# 4. restaurar.sh en modo prueba
# ---------------------------------------------------------------------------
echo "4. restaurar.sh en modo prueba llega hasta descifrar"
if COMPOSE="$COMPOSE" ENV_FICHERO="$ENV_FICHERO" ./db/restaurar.sh > /dev/null 2>&1; then
  ok "prueba superada sin tocar la base real"
else
  mal "la prueba de restauración falla"
fi
echo

# ---------------------------------------------------------------------------
# 5. Sin terminal y sin CONFIRMAR, --en-serio NO restaura
# ---------------------------------------------------------------------------
echo "5. --en-serio no se dispara por accidente"
set +e
COMPOSE="$COMPOSE" ENV_FICHERO="$ENV_FICHERO" ./db/restaurar.sh --en-serio > /dev/null 2>&1
C=$?
set -e
[ "$C" != "0" ] && ok "sin confirmar, aborta (código ${C})" || mal "restauró SIN confirmación"

set +e
CONFIRMAR=no COMPOSE="$COMPOSE" ENV_FICHERO="$ENV_FICHERO" ./db/restaurar.sh --en-serio > /dev/null 2>&1
C=$?
set -e
[ "$C" != "0" ] && ok "con CONFIRMAR=no, cancela" || mal "restauró con CONFIRMAR=no"
echo

# ---------------------------------------------------------------------------
# 6. --en-serio de verdad: la marca tiene que desaparecer
# ---------------------------------------------------------------------------
#
# Es la comprobación que pilló que `--clean` no vaciaba nada. Sin ella, el
# script decía «restaurada y comprobada» con la tabla de más todavía puesta.
echo "6. --en-serio deja la base como el respaldo, no encima de ella"
MARCA="marca_prueba_$(date +%s)"
psql_ -c "CREATE TABLE ${MARCA} (x int);" > /dev/null
ok "marca ${MARCA} creada DESPUÉS del respaldo"

if CONFIRMAR=RESTAURAR COMPOSE="$COMPOSE" ENV_FICHERO="$ENV_FICHERO" \
     ./db/restaurar.sh --en-serio "$DUMP" > /dev/null 2>&1; then
  ok "restauración destructiva en verde"
else
  mal "la restauración destructiva falla"
fi

QUEDA=$(psql_ -c "SELECT count(*) FROM information_schema.tables WHERE table_name='${MARCA}';")
if [ "$QUEDA" = "0" ]; then
  ok "la marca desapareció: se vació el esquema de verdad"
else
  mal "la marca SIGUE AHÍ: la restauración no vació nada"
  psql_ -c "DROP TABLE IF EXISTS ${MARCA};" > /dev/null 2>&1 || true
fi

# El esquema `drizzle` es el que se quedaba fuera al vaciar solo `public`.
MIGR=$(psql_ -c 'SELECT count(*) FROM drizzle.__drizzle_migrations;')
EN_DISCO=$(ls db/migraciones/*.sql | wc -l | tr -d ' ')
[ "$MIGR" = "$EN_DISCO" ] \
  && ok "migraciones coherentes (${MIGR} registradas, ${EN_DISCO} en disco)" \
  || mal "migraciones descuadradas: ${MIGR} registradas, ${EN_DISCO} en disco"
echo

# ---------------------------------------------------------------------------
# 7. Volvimos al punto de partida
# ---------------------------------------------------------------------------
echo "7. La base quedó como estaba"
EQUIPOS_DESPUES=$(psql_ -c 'SELECT count(*) FROM equipos;')
CIFRADAS_DESPUES=$(psql_ -c 'SELECT count(*) FROM equipos WHERE bios_password_cifrado IS NOT NULL;')
[ "$EQUIPOS_ANTES" = "$EQUIPOS_DESPUES" ] \
  && ok "equipos: ${EQUIPOS_DESPUES}" \
  || mal "equipos: había ${EQUIPOS_ANTES} y hay ${EQUIPOS_DESPUES}"
[ "$CIFRADAS_ANTES" = "$CIFRADAS_DESPUES" ] \
  && ok "filas cifradas: ${CIFRADAS_DESPUES}" \
  || mal "cifradas: había ${CIFRADAS_ANTES} y hay ${CIFRADAS_DESPUES}"

# ---------------------------------------------------------------------------
# Veredicto
# ---------------------------------------------------------------------------
#
# Sale con código distinto de cero si hay fallos. Un script que imprime «MAL» y
# sale con 0 no sirve de criterio: ya pasó en este proyecto con los
# verificadores de SQL, y el veredicto lo leía una persona a ojo.
echo
if [ "$fallos" -gt 0 ]; then
  echo "── ${fallos} comprobación(es) en rojo ─────────────────────────────────" >&2
  exit 1
fi
echo "── Ciclo de respaldo comprobado entero ────────────────────────────"
