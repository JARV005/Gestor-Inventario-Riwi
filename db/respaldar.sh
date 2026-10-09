#!/usr/bin/env bash
#
# Respaldo de RiwiStock. Etapa 7.
#
#   ./db/respaldar.sh
#
# Se ejecuta EN LA MÁQUINA que tiene el compose de producción. Vuelca la base
# dentro del volumen `respaldos`, que es distinto del de datos a propósito: en el
# mismo volumen, un disco lleno o un `docker volume rm` se llevan el original y
# la copia a la vez.
#
# ============================================================================
# UN RESPALDO NO COMPROBADO NO ES UN RESPALDO.
# ============================================================================
#
# Este script hace el volcado Y lo verifica: lo restaura en una base temporal y
# cuenta las filas. `pg_dump` puede terminar con código 0 y dejar un fichero
# truncado si el disco se llena a mitad, y nadie lo descubre hasta el día que
# hace falta. Ver `db/restaurar.sh` para la prueba completa, que además descifra.

set -euo pipefail

# `docker compose exec -T` HEREDA stdin y se lo come entero. Este script no
# lee nada de stdin, así que se le cierra de una vez: si no, los `exec` de
# aquí abajo se quedarían esperando entrada cuando se corre desde cron con la
# entrada conectada a algo que no termina.
exec < /dev/null

# ---------------------------------------------------------------------------
# El entorno
# ---------------------------------------------------------------------------
#
# `docker compose` lee `.env` solo; este script, no. Y lo necesita fuera del
# contenedor para hablar con la base. Sin esto, `set -u` mata el script con
# «unbound variable» en la máquina donde el .env sí está — el fallo aparece
# justo el día que hace falta restaurar.
#
# NO se hace con `source`, por dos motivos que se descubrieron al probarlo:
#
#   1. El formato de `.env` de compose admite `RAZON_SOCIAL=BBL SAS` sin
#      comillas; `source` lo lee como el comando `SAS` y aborta con
#      «command not found». Un valor perfectamente válido para compose deja
#      el respaldo sin poder correr.
#   2. `source` EJECUTA el fichero. Un `.env` es datos, no un script.
#
# Así que se extraen solo las tres variables que este script necesita, y se
# leen como texto.
ENV_FICHERO="${ENV_FICHERO:-.env}"

leer_env() {
  # Última aparición gana, igual que compose. Se quitan las comillas envolventes
  # —compose también las quita— y el \r de un fichero guardado en Windows, que
  # de otro modo acaba dentro de la contraseña y da «authentication failed».
  [ -f "$ENV_FICHERO" ] || return 0
  sed -n "s/^[[:space:]]*${1}[[:space:]]*=[[:space:]]*//p" "$ENV_FICHERO" \
    | tail -1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Lo que ya venga en el entorno gana sobre el fichero: así se puede apuntar el
# script a otra base sin editar nada.
POSTGRES_USER="${POSTGRES_USER:-$(leer_env POSTGRES_USER)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(leer_env POSTGRES_PASSWORD)}"
POSTGRES_DB="${POSTGRES_DB:-$(leer_env POSTGRES_DB)}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.produccion.yml}"
RETENER="${RETENER:-14}"
SELLO="$(date +%Y%m%d-%H%M%S)"
FICHERO="/respaldos/riwistock-${SELLO}.dump"

echo "── Respaldo de RiwiStock ──────────────────────────────────────────"

# ---------------------------------------------------------------------------
# 1. El volcado
# ---------------------------------------------------------------------------
#
# Formato `custom` (-Fc) y no SQL plano: se restaura con `pg_restore`, admite
# restauración selectiva de tablas y viene comprimido. Con 938 equipos y sus
# PDF de actas en `bytea`, el plano ocuparía varias veces más.
echo "Volcando a ${FICHERO}…"
$COMPOSE exec -T postgres pg_dump -Fc -f "$FICHERO"

TAMANO=$($COMPOSE exec -T postgres stat -c %s "$FICHERO")
echo "Volcado: ${TAMANO} bytes"

# Un dump de menos de 50 KB con esta base no es un dump: es un fichero que se
# quedó a medias. Mejor fallar aquí que descubrirlo cuando haga falta.
if [ "$TAMANO" -lt 51200 ]; then
  echo "ABORTA: el volcado son ${TAMANO} bytes, demasiado poco para esta base." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. La comprobación: se restaura en una base temporal y se cuenta
# ---------------------------------------------------------------------------
#
# Es lo que separa «el comando salió bien» de «el fichero sirve». Se hace aquí,
# en cada respaldo, y no una vez al año.
# Sin los guiones del sello: `verificacion_20260925-121744` no es un
# identificador válido y `CREATE DATABASE` muere con «syntax error at or near
# "-"». El guion se queda en el nombre del FICHERO, que sí se lee a ojo.
TEMPORAL="verificacion_$(printf %s "$SELLO" | tr -d -)"
echo "Comprobando: restaurando en ${TEMPORAL}…"

limpiar() {
  $COMPOSE exec -T postgres psql -q -c "DROP DATABASE IF EXISTS ${TEMPORAL};" >/dev/null 2>&1 || true
}
trap limpiar EXIT

$COMPOSE exec -T postgres psql -q -c "CREATE DATABASE ${TEMPORAL};"
$COMPOSE exec -T postgres pg_restore -d "${TEMPORAL}" --no-owner "$FICHERO" >/dev/null

# Los conteos del original contra la copia. Si no cuadran, el volcado no vale
# aunque pese lo que debe.
for TABLA in equipos empleados movimientos actas licencias usuarios_app; do
  ORIGEN=$($COMPOSE exec -T postgres psql -tAq -c "SELECT count(*) FROM ${TABLA};")
  COPIA=$($COMPOSE exec -T postgres psql -tAq -d "${TEMPORAL}" -c "SELECT count(*) FROM ${TABLA};")
  if [ "$ORIGEN" != "$COPIA" ]; then
    echo "ABORTA: ${TABLA} tiene ${ORIGEN} filas y la copia ${COPIA}." >&2
    exit 1
  fi
  printf '  %-14s %s filas\n' "$TABLA" "$ORIGEN"
done

# ---------------------------------------------------------------------------
# 3. Rotación
# ---------------------------------------------------------------------------
#
# Se borran los más viejos DESPUÉS de comprobar el nuevo: al revés, un respaldo
# roto podría haber borrado el último bueno.
echo "Rotando (se conservan ${RETENER})…"
$COMPOSE exec -T postgres sh -c \
  "ls -1t /respaldos/riwistock-*.dump 2>/dev/null | tail -n +$((RETENER + 1)) | xargs -r rm -f"

QUEDAN=$($COMPOSE exec -T postgres sh -c 'ls -1 /respaldos/riwistock-*.dump 2>/dev/null | wc -l')
echo "── Respaldo comprobado. Copias guardadas: ${QUEDAN} ───────────────"

# ---------------------------------------------------------------------------
# Lo que este script NO hace, y hay que hacer aparte
# ---------------------------------------------------------------------------
#
# 1. SACAR LA COPIA DE LA MÁQUINA. Un respaldo en el mismo servidor protege de
#    un `DROP TABLE`, no de que el servidor se pierda. Copiarlo fuera con
#    `docker cp` + `rsync`/`rclone` a otro sitio es el paso que falta.
#
# 2. LA CLAVE DE CIFRADO. `ENCRYPTION_KEY` NO está en el dump: vive en el
#    entorno. Un respaldo restaurado sin ella deja `bios_password` y las keys de
#    licencia como bytes ilegibles — la base vuelve, los secretos no. Se guarda
#    aparte y en otro sitio, y `db/restaurar.sh` comprueba que la que hay
#    descifra de verdad.
