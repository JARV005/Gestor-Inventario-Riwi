#!/usr/bin/env bash
#
# Restauración de RiwiStock, probada de verdad. Etapa 7.
#
#   ./db/restaurar.sh                      # prueba en una base temporal
#   ./db/restaurar.sh --en-serio           # vacía la base real y carga el respaldo
#   ./db/restaurar.sh /respaldos/x.dump    # elige el fichero
#
# ============================================================================
# LA PRUEBA LLEGA HASTA DESCIFRAR. UN `pg_restore` EN VERDE NO BASTA.
# ============================================================================
#
# `ENCRYPTION_KEY` no está dentro del dump: vive en el entorno del servidor. Una
# base restaurada con la clave equivocada devuelve `bios_password` y las keys de
# licencia como bytes ilegibles, y `pg_restore` no se entera: termina con código
# 0 y deja una base que parece completa.
#
# Por eso este script no se conforma con restaurar. Descifra una fila real y
# comprueba que sale texto. Es la diferencia entre «la base volvió» y «la base
# volvió entera».

set -euo pipefail

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
EN_SERIO=0
FICHERO=""

for arg in "$@"; do
  case "$arg" in
    --en-serio) EN_SERIO=1 ;;
    *) FICHERO="$arg" ;;
  esac
done

# Sin fichero, el más reciente.
if [ -z "$FICHERO" ]; then
  FICHERO=$($COMPOSE exec -T postgres sh -c 'ls -1t /respaldos/riwistock-*.dump 2>/dev/null | head -1' < /dev/null | tr -d '\r')
  if [ -z "$FICHERO" ]; then
    echo "No hay ningún respaldo en /respaldos. Correr antes db/respaldar.sh." >&2
    exit 1
  fi
fi

echo "── Restauración de RiwiStock ──────────────────────────────────────"
echo "Fichero: ${FICHERO}"

# ---------------------------------------------------------------------------
# Dónde se restaura
# ---------------------------------------------------------------------------
if [ "$EN_SERIO" = "1" ]; then
  # Restaurar encima de la base real es destructivo y no se hace por accidente:
  # hay que escribir la palabra.
  echo
  echo "ATENCIÓN: esto va a SUSTITUIR la base de producción por el respaldo."
  echo "Se vacía el esquema entero y se carga ${FICHERO}: todo lo que haya"
  echo "entrado después se pierde, tablas nuevas incluidas."
  echo "Antes de vaciar se deja un volcado de seguridad en /respaldos."
  # ------------------------------------------------------------------------
  # La confirmación se lee del TERMINAL, no de stdin.
  # ------------------------------------------------------------------------
  #
  # `docker compose exec -T` hereda stdin y lo consume hasta EOF. Cuando se
  # llegaba aquí, `read` ya no tenía nada que leer, devolvía 1 y `set -e`
  # mataba el script justo después de imprimir el prompt — sin restaurar y sin
  # decir por qué. Corriéndolo a mano no se nota, porque el teclado no se
  # agota; se vio al automatizarlo.
  #
  # Si no hay terminal (cron, CI), NO se asume que sí: hay que pasar
  # `CONFIRMAR=RESTAURAR` a propósito. Un script que sustituye la base de
  # producción no continúa porque nadie haya dicho que no.
  if [ -n "${CONFIRMAR:-}" ]; then
    RESPUESTA="$CONFIRMAR"
  # `[ -r /dev/tty ]` NO sirve para saber si hay terminal: en Git Bash da
  # verdadero y luego abrirlo falla con «No such device or address», que es el
  # mensaje que ve el usuario en vez del de aquí abajo. Se comprueba abriéndolo.
  elif { exec 3< /dev/tty; } 2> /dev/null; then
    printf 'Escribe RESTAURAR para continuar: ' > /dev/tty
    read -r RESPUESTA <&3 || RESPUESTA=""
    exec 3<&-
  else
    echo "No hay terminal para confirmar, y esto sustituye la base de producción." >&2
    echo "Si de verdad es lo que quieres: CONFIRMAR=RESTAURAR ./db/restaurar.sh --en-serio" >&2
    exit 1
  fi

  [ "$RESPUESTA" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
  DESTINO="${POSTGRES_DB:-inventario_bbl}"
  $COMPOSE stop app
else
  DESTINO="prueba_restauracion_$(date +%s)"
  echo "Modo PRUEBA: se restaura en ${DESTINO} y se borra al terminar."
  echo "La base de producción no se toca. Para restaurar de verdad: --en-serio"
  limpiar() {
    $COMPOSE exec -T postgres psql -q -c "DROP DATABASE IF EXISTS ${DESTINO};" >/dev/null 2>&1 || true
  }
  trap limpiar EXIT
  $COMPOSE exec -T postgres psql -q -c "CREATE DATABASE ${DESTINO};"
fi

echo
echo "Restaurando…"
if [ "$EN_SERIO" = "1" ]; then
  # ------------------------------------------------------------------------
  # 1. UN VOLCADO DE SEGURIDAD ANTES DE TOCAR NADA
  # ------------------------------------------------------------------------
  #
  # Lo siguiente vacía el esquema. Si el `pg_restore` falla a mitad —fichero
  # corrupto, disco lleno— la base se queda sin lo que tenía Y sin lo que iba a
  # tener. Este volcado es la única vuelta atrás, y cuesta un segundo.
  RED="/respaldos/antes-de-restaurar-$(date +%Y%m%d%H%M%S).dump"
  echo "  red de seguridad: ${RED}"
  $COMPOSE exec -T postgres pg_dump -Fc -f "$RED" "$DESTINO"

  # ------------------------------------------------------------------------
  # 2. VACIAR EL ESQUEMA. `--clean` NO BASTA.
  # ------------------------------------------------------------------------
  #
  # `pg_restore --clean --if-exists` borra solo los objetos QUE ESTÁN EN EL
  # DUMP. Lo que se creó después de ese respaldo sobrevive, y el script decía
  # «todo lo que haya entrado después se pierde»: era mentira. Se comprobó
  # creando una tabla después del respaldo y viéndola seguir ahí con el script
  # diciendo «producción restaurada y comprobada».
  #
  # Lo grave no es la tabla suelta: es el caso mixto. Si entre el respaldo y la
  # restauración se aplicó una migración, `__drizzle_migrations` vuelve al
  # estado del dump —dice que esa migración no corrió— mientras las tablas que
  # creó se quedan puestas. La siguiente migración muere con «already exists» y
  # el motivo está dos semanas atrás.
  #
  # Vaciar el esquema deja la base exactamente como el dump, que es lo que
  # significa restaurar.
  # TODOS los esquemas de la aplicación, no solo `public`.
  #
  # Drizzle guarda su tabla de migraciones en un esquema propio llamado
  # `drizzle`. Vaciando solo `public` sobrevivía, y el `pg_restore` moría con
  # «relation "__drizzle_migrations_id_seq" already exists» y un
  # «duplicate key value» encima. Se vio al probarlo.
  #
  # Se recorren los esquemas en vez de nombrar los dos: el día que aparezca un
  # tercero, esto ya lo cubre. Se excluyen los del sistema (`pg_*` y
  # `information_schema`), que no son de nadie y no se pueden borrar.
  # Va por heredoc y no por `-c "…"`: entre comillas dobles, bash expande el
  # `$$` del bloque PL/pgSQL al PID del shell y el SQL deja de ser válido. Con
  # `<<'SQL'` no se expande nada, y además se lee.
  $COMPOSE exec -T postgres psql -q -v ON_ERROR_STOP=1 -d "$DESTINO" <<'SQL'
DO $$
DECLARE e text;
BEGIN
  FOR e IN SELECT nspname FROM pg_namespace
           WHERE left(nspname, 3) <> 'pg_' AND nspname <> 'information_schema'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', e);
  END LOOP;
END $$;
CREATE SCHEMA public;
SQL

  if ! $COMPOSE exec -T postgres pg_restore -d "$DESTINO" --no-owner "$FICHERO"; then
    echo >&2
    echo "El pg_restore falló con el esquema ya vacío." >&2
    echo "La base NO tiene ni lo de antes ni lo del respaldo. Volver atrás con:" >&2
    echo "  ./db/restaurar.sh --en-serio ${RED}" >&2
    exit 1
  fi
else
  $COMPOSE exec -T postgres pg_restore -d "$DESTINO" --no-owner "$FICHERO"
fi

# ---------------------------------------------------------------------------
# 1. Las filas volvieron
# ---------------------------------------------------------------------------
echo
echo "Filas restauradas:"
for TABLA in equipos empleados movimientos actas licencias usuarios_app; do
  N=$($COMPOSE exec -T postgres psql -tAq -d "$DESTINO" -c "SELECT count(*) FROM ${TABLA};" | tr -d '\r')
  printf '  %-14s %s\n' "$TABLA" "$N"
done

# ---------------------------------------------------------------------------
# 2. LO QUE DE VERDAD IMPORTA: que los secretos se puedan leer
# ---------------------------------------------------------------------------
#
# Se hace desde la aplicación y no con SQL, porque descifrar necesita
# `ENCRYPTION_KEY` y el algoritmo: es la misma ruta que usaría una persona
# pidiendo una clave BIOS en la pantalla.
echo
echo "Comprobando que los secretos se descifran…"

# Si faltan, se dice cuál falta. Con `set -u` a secas el mensaje sería
# «POSTGRES_USER: unbound variable», que no explica que hay que rellenar el .env.
if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ]; then
  echo "Faltan POSTGRES_USER o POSTGRES_PASSWORD: están en ${ENV_FICHERO} y hacen" >&2
  echo "falta para leer la base restaurada desde fuera del contenedor." >&2
  exit 1
fi

CIFRADAS=$($COMPOSE exec -T postgres psql -tAq -d "$DESTINO" \
  -c "SELECT count(*) FROM equipos WHERE bios_password_cifrado IS NOT NULL;" | tr -d '\r')

if [ "$CIFRADAS" = "0" ]; then
  # Cero filas cifradas no es «todo bien»: es que no hay nada que comprobar, y
  # eso deja la prueba sin valor. Se dice en vez de pasar en verde.
  echo "AVISO: la base restaurada no tiene ni una fila cifrada." >&2
  echo "       La prueba de descifrado no comprueba nada. Revisar el respaldo." >&2
  exit 1
fi

# Se apunta `verificar-cifrado` a la base restaurada.
#
# Reusa `comprobarClaveDeCifrado`, la misma que corre al arrancar el servidor:
# escribir aquí un segundo desciframiento sería un segundo sitio donde
# equivocarse, y podría equivocarse distinto.
#
# Y falla si no hay NINGUNA fila cifrada en vez de pasar: sin nada que
# descifrar no hay nada comprobado, y un verde de vacío en la prueba de un
# respaldo es justo lo que no sirve.
# Se apunta `verificar-cifrado` a la base restaurada.
#
# Reusa `comprobarClaveDeCifrado`, la misma que corre al arrancar el servidor:
# escribir aquí un segundo desciframiento sería un segundo sitio donde
# equivocarse, y podría equivocarse distinto.
#
# NO se lee «salió distinto de cero» como «la clave está mal»: la herramienta
# devuelve un código por causa, porque no son la misma cosa. Con la base caída,
# decir «tus secretos son ilegibles» es inventarse un diagnóstico y podría
# mandar a alguien a buscar una clave que no se ha perdido.
set +e
$COMPOSE run --rm --no-deps \
  -e "DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${DESTINO}" \
  app node dist/herramientas/verificar-cifrado.cjs
CIFRADO=$?
set -e

case "$CIFRADO" in
  0)
    echo "  ✓ los secretos se descifran con la ENCRYPTION_KEY de este servidor"
    ;;
  1)
    echo "  ✗ la clave de este servidor NO descifra estos datos." >&2
    echo "    La base volvió pero sus secretos son ilegibles: recuperar la" >&2
    echo "    ENCRYPTION_KEY con la que se cifraron. El respaldo está a medias." >&2
    exit 1
    ;;
  2)
    # Ya se contó arriba que hay filas cifradas, así que llegar aquí significa
    # que la base restaurada no es la que se contó. Vale la pena decirlo.
    echo "  ✗ la base restaurada no tiene ni una fila cifrada." >&2
    echo "    Se contaron ${CIFRADAS} antes de restaurar: el volcado no trajo" >&2
    echo "    lo que debía. No se da por buena." >&2
    exit 1
    ;;
  *)
    echo "  ? no se pudo comprobar el descifrado." >&2
    echo "    NO significa que la clave esté mal: significa que no se sabe." >&2
    echo "    Repetir cuando la base responda, antes de dar el respaldo por bueno." >&2
    exit 1
    ;;
esac

if [ "$EN_SERIO" = "1" ]; then
  $COMPOSE start app
  echo
  echo "── Producción restaurada y comprobada ─────────────────────────────"
else
  echo
  echo "── Prueba superada. La base de producción no se tocó. ─────────────"
fi
