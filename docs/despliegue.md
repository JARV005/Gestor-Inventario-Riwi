# Despliegue y entorno local

Cómo levantar la base de datos y dejarla en un estado utilizable. El detalle de
qué contiene el esquema y por qué está en `esquema.md`.

## Requisitos

- Node.js y npm
- Docker Desktop corriendo (el daemon, no solo instalado)

## Puesta en marcha

```bash
cp .env.example .env      # y rellenar POSTGRES_PASSWORD
npm install
npm run db:up             # levanta Postgres en un contenedor
npm run migrate           # crea el esquema
npm run seed              # sedes y usuario de sistema
npm run db:verificar      # comprueba que los invariantes muerden
```

`npm run migrate` y `npm run seed` son idempotentes: correrlos de nuevo no
duplica nada ni pisa cambios.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run db:up` | Levanta el contenedor de Postgres |
| `npm run db:down` | Lo para. **Conserva** los datos |
| `npm run db:reset` | Lo para, **borra el volumen** y lo vuelve a levantar. Vacío |
| `npm run db:psql` | Abre una sesión psql interactiva dentro del contenedor |
| `npm run db:verificar` | Corre los dos verificadores |
| `npm run db:verificar-esquema` | Que las reglas están puestas. Filas sintéticas y ROLLBACK: no deja nada. Pasa en BD vacía |
| `npm run db:verificar-datos` | Que las filas cargadas son coherentes. Solo lee. **No** tiene sentido en BD vacía |
| `npm run migrate` | Aplica las migraciones pendientes |
| `npm run migrate:generate` | Genera una migración nueva a partir de `db/esquema.ts` |
| `npm run seed` | Siembra sedes y usuario de sistema |

## Variables de entorno

En `.env`, a partir de `.env.example`. `.env` está en `.gitignore`.

| Variable | Para qué |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credenciales con las que docker-compose crea el contenedor |
| `POSTGRES_PORT` | Puerto en la máquina anfitriona. **5433 por defecto**, ver abajo |
| `DATABASE_URL` | La usan el servidor, las migraciones y las semillas. Tiene que concordar con las cuatro de arriba |
| `ADMIN_EMAIL` / `ADMIN_NOMBRE` / `ADMIN_PASSWORD` | La cuenta con la que entrar tras `npm run seed`. Las tres o ninguna |

### El admin inicial

`npm run db:reset` borra el volumen, y con él **todos los usuarios**. Sin estas
tres variables la base queda migrada, sembrada y sin ninguna cuenta con la que
entrar: `sistema@bbl.local` no puede iniciar sesión por diseño (D4). Ya dejó a
alguien fuera de su propia aplicación una vez.

Con las tres puestas, `npm run seed` crea el admin. **Sin ellas no se crea nada
y la siembra lo dice**: un admin con contraseña por defecto es una puerta
trasera que nadie recuerda haber abierto. Mismo criterio que
`POSTGRES_PASSWORD`.

Sembrar dos veces **no pisa la contraseña**. Si la cuenta ya existe se deja como
está — la contraseña que vale es la que tenga puesta su dueño, no la que quedó
en un `.env` de hace meses. Para cambiarla, `npm run usuario`.

`POSTGRES_PASSWORD` no tiene valor por defecto a propósito: docker compose falla
si no está definida, en vez de arrancar con una contraseña adivinable.

## La aplicación es completamente interna

**No hace ninguna llamada a servicios externos.** Ni una. Todo lo que necesita
está dentro: Postgres, la sesión en Postgres, los ficheros estáticos que sirve
ella misma.

Hasta la etapa 4b no era así. El copiloto mandaba datos del inventario a la API
de Google (`generativelanguage.googleapis.com`) y eso obligaba a que la máquina
tuviera salida a internet y a que alguien custodiara una clave de API. El módulo
se eliminó entero — `docs/decisiones-03.md` §D12 — y con él la única salida.

Lo que esto permite, y conviene aprovechar:

- **La aplicación puede vivir sin salida a internet.** Un cortafuegos que
  bloquee todo el tráfico saliente no rompe nada de ella. Solo hace falta
  alcanzarla desde la red interna, y que ella alcance a Postgres.

  **Caddy sí necesita salida**, y eso es nuevo desde el despliegue en la VPS: el
  certificado de Let's Encrypt se pide y se renueva por ACME, contra un servidor
  de fuera. Bloquear el saliente en esa máquina no rompe nada hoy — el
  certificado ya está emitido — y rompe el sitio entero **noventa días después**,
  cuando toca renovar. Es un fallo diferido y sin aviso, así que si el saliente
  se cierra, hay que dejar pasar el ACME de Caddy o pasar a un certificado
  puesto a mano.

  Con la aplicación servida solo en la red interna y sin dominio público, Caddy
  no hace falta: se puede levantar únicamente `postgres` y `app`, que es como se
  probó el compose de producción en el portátil.
- **No hay ninguna clave de proveedor externo que custodiar.** La única clave
  sensible sigue siendo `ENCRYPTION_KEY`, que no sale de la máquina; su
  procedimiento está más abajo.
- **Ningún dato del inventario cruza la frontera de la empresa.** Antes sí lo
  hacía, con una lista blanca de seis campos como única salvaguarda.

Si alguien vuelve a añadir una llamada saliente, esta sección deja de ser cierta
y hay que actualizarla en el mismo cambio.

## El puerto es 5433, no 5432

Si hay un Postgres instalado en la máquina, se queda con el 5432 y las
conexiones llegan a él en vez de al contenedor. El síntoma despista bastante:

```
error: password authentication failed for user "inventario"
```

…y `docker compose logs postgres` no muestra **ni una línea** sobre ese intento,
porque el intento nunca llegó al contenedor. Pasó durante la etapa 1 en una
máquina con Docker escuchando en `::` (IPv6) y un Postgres nativo en `0.0.0.0`
(IPv4): `localhost` resolvía a IPv4 y aterrizaba en el nativo.

Para comprobar quién tiene el puerto, en PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen |
  Select-Object LocalAddress, OwningProcess
```

## Cambios que exigen recrear el volumen

La colación en español (`--locale-provider=icu --icu-locale=es-CO`) se aplica en
el `initdb`, es decir **solo al crear el volumen**. Cambiar `POSTGRES_INITDB_ARGS`
sobre un volumen que ya existe no hace nada: hay que pasar por `npm run db:reset`.

Lo mismo vale para `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB`.

Cambiar el puerto o las variables `PGUSER`/`PGDATABASE`, en cambio, solo pide
recrear el contenedor: `docker compose up -d`, sin `-v`.

## `PGUSER` y `PGDATABASE` en el contenedor

Están en `docker-compose.yml` para que `psql` y `pg_isready` dentro del
contenedor apunten solos al usuario y la BD correctos. El motivo es prosaico:
sin ellas los scripts de npm tendrían que pasar `-U` y `-d` entre comillas, y en
Windows npm ejecuta los scripts con `cmd.exe`, que no respeta las comillas
simples. Con las variables puestas, `npm run db:psql` es literalmente
`docker compose exec postgres psql`.

## Custodia de `ENCRYPTION_KEY`

Es la única pieza del sistema cuya pérdida **no se puede reparar con trabajo**.

`bios_password_cifrado` y `licencia_serial_cifrado` están cifrados con AES-256-GCM
usando esa clave y ninguna otra. No hay copia dentro de la base, ni derivación a
partir de nada, ni puerta trasera. Si la clave desaparece, esos 115 y 110 valores
son ruido permanente: habría que ir equipo por equipo a releer la clave BIOS de
cada máquina.

Eso es una propiedad del diseño, no un defecto. Una clave recuperable desde la
aplicación sería una clave que también recupera quien se lleve una copia de la
base. **Pero significa que el cifrado protege los datos de su dueño con la misma
eficacia con la que los protege de un atacante**, y por eso la custodia no es un
detalle operativo: es parte del diseño.

### Reglas

1. **Se genera una vez.** No se rota sin un script de recifrado, que hoy no
   existe (`pendientes.md`, etapa 7). Regenerarla «por si acaso» destruye los
   datos.
2. **No vive solo en `.env`.** Ese archivo está en `.gitignore`, en un único
   disco, y ya se rellenó una vez con los valores de plantilla sin que nada
   avisara. Un `.env` es un archivo de trabajo, no una copia de seguridad.
3. **Se guarda fuera de la máquina de desarrollo**, en un sitio donde alguien
   que no sea quien la generó pueda encontrarla. Dónde exactamente lo decide
   quien dirige el proyecto; lo que no vale es que exista en un solo portátil.
4. **Nunca en el repositorio, ni en un chat, ni en un correo.** Si acaba en
   alguno de los tres, hay que recifrar con una clave nueva — que es
   precisamente el procedimiento que todavía no existe.
5. **Un backup de la base sin la clave no es un backup.** El §5 exige probar la
   restauración; esa prueba tiene que incluir descifrar una fila.

### El arranque la comprueba

Desde la etapa 4a, el servidor intenta descifrar una fila real antes de aceptar
peticiones. Si no lo consigue, **no arranca**:

```
ENCRYPTION_KEY incorrecta o cambiada; los datos cifrados no son legibles con esta clave.
Hay 115 filas cifradas en la base y la primera no se pudo descifrar.
No se toca nada: recuperar la clave original antes de volver a arrancar.
```

Existe porque el modo de fallo es silencioso. Con la clave equivocada, el
servidor arrancaría igual y los listados funcionarían igual —los campos
cifrados no salen en ninguno—, así que el problema no aparecería hasta que
alguien pidiera una clave BIOS. Para entonces podría haber ocurrido una
reimportación que recifrase las filas con la clave equivocada, y ahí sí no hay
vuelta atrás.

Vale más no arrancar que arrancar con los datos ilegibles y enterarse en tres
meses. Si la base no tiene todavía ninguna fila cifrada, la comprobación lo dice
y sigue: no hay nada que verificar.

## Migraciones

Regla 7 de `CLAUDE.md`: nunca `ALTER TABLE` a mano. El flujo es siempre:

1. Editar `db/esquema.ts`
2. `npm run migrate:generate`
3. **Leer el `.sql` generado.** No es un trámite: drizzle-kit ha emitido SQL
   inválido en este proyecto (referencias calificadas `"equipos"."estado"`
   dentro de un CHECK, que Postgres rechaza)
4. `npm run migrate`
5. `npm run db:verificar` si se tocaron restricciones o triggers

Funciones y triggers no los modela drizzle-kit. Van en un archivo aparte creado
con `npx drizzle-kit generate --custom --name=...`, que registra el archivo en
el journal sin generar SQL.

## Producción: la VPS

Todo lo anterior es el portátil. Producción son tres ficheros aparte:

| Fichero | Qué es |
| --- | --- |
| `Dockerfile` | La imagen. Dos etapas: la primera construye con todo, la segunda se queda con lo que sirve. Sin `vite`, sin `tsx`, sin tests, sin Excel. |
| `docker-compose.produccion.yml` | Los tres servicios: base, aplicación, proxy. |
| `Caddyfile` | El HTTPS, con certificado automático de Let's Encrypt. |

`docker-compose.yml` (el de desarrollo) sigue siendo otra cosa y no se usa en la
VPS: aquel publica el 5433 para poder abrir `psql` desde el portátil.

### Lo que no está expuesto

Solo Caddy publica puertos (80 y 443). Postgres **no tiene `ports`** y la
aplicación solo `expose: 3000`, que es visible dentro de la red de compose y no
desde fuera de la máquina. Añadir un `ports` a Postgres «para poder mirar» lo
pone en internet entero: para eso está `docker compose exec -T postgres psql`,
que no abre nada.

### El `.env` de la VPS

Las mismas variables que en desarrollo menos las de desarrollo, más `DOMINIO`:

```
POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
SESSION_SECRET, ENCRYPTION_KEY
ORGANIZACION_RAZON_SOCIAL, ORGANIZACION_NIT
DOMINIO
```

No hacen falta `POSTGRES_PORT`, `DATABASE_URL` (la arma el compose con el nombre
de servicio interno) ni `DATABASE_URL_TEST`. Los `ADMIN_*` tampoco: la cuenta se
crea a mano con `usuario:prod`, y así la contraseña no queda en un fichero.

Están en `.env.produccion.example`, que es una lista aparte de `.env.example`
justamente para no arrastrar a producción las cinco variables que solo tienen
sentido en el portátil.

### Cambiar el `.env` no basta: hay que recrear

`docker compose restart app` **reinicia el contenedor que ya existe, con el
entorno que tenía cuando se creó**. Un cambio en `.env` no le llega. Hay que
usar `up -d`, que lo recrea.

Esto costó un rato de diagnóstico: tras cambiar `ENCRYPTION_KEY` y hacer
`restart`, el servidor se negó a arrancar diciendo *«ENCRYPTION_KEY incorrecta o
cambiada»* — que es verdad desde su punto de vista, pero el mensaje parece un
desastre de datos y el problema era el comando. La comprobación de arranque hizo
exactamente su trabajo.

    docker compose -f docker-compose.produccion.yml up -d    # sí
    docker compose -f docker-compose.produccion.yml restart  # no aplica el .env

### Las herramientas en la imagen son `.cjs`

`tsx` es una dependencia de desarrollo y no existe en la imagen de producción, así
que el migrador, la siembra, el creador de usuarios y el verificador de cifrado se
compilan con esbuild al construir. Se invocan por su ruta:

```bash
docker compose -f docker-compose.produccion.yml exec app node dist/herramientas/migrar.cjs
docker compose -f docker-compose.produccion.yml exec app node dist/herramientas/semillas.cjs
docker compose -f docker-compose.produccion.yml exec -it app node dist/herramientas/crear-usuario.cjs \
  johan@bbl.local "Johan Rivera" admin
```

La extensión es `.cjs` y no `.js` a propósito: `package.json` declara
`"type": "module"`, así que un `.js` con `require()` revienta al arrancar con
`require is not defined in ES module scope`. El `Dockerfile` pasa
`--out-extension:.js=.cjs` a esbuild por eso.

### Puesta en marcha, en orden

#### Paso 1. La `ENCRYPTION_KEY`

> **La `ENCRYPTION_KEY` de producción es LA MISMA que la de desarrollo. Generar
> una nueva deja 72 contraseñas BIOS y 29 keys de licencia ilegibles para
> siempre, y ningún respaldo lo arregla.**

Va primero porque es el único paso de esta página que no se puede deshacer. Todo
lo demás se rehace: el contenedor se recrea, la base se vuelve a restaurar, el
certificado se vuelve a pedir. Esto no. La clave no viaja dentro del volcado
—vive en el entorno del servidor— así que un `.env` de producción con una clave
recién generada produce una instalación que arranca, se ve bien y tiene 101
valores cifrados que nadie podrá volver a leer.

Y es el paso que uno hace mal por costumbre: `.env.example` dice cómo generar
una, y generar secretos nuevos para producción es lo correcto para
`SESSION_SECRET` y para `POSTGRES_PASSWORD`. Para esta, no.

```bash
# En el portátil, para copiarla al .env de la VPS. No la imprimas en un
# terminal compartido ni la pegues en un chat.
grep '^ENCRYPTION_KEY' .env
```

Lo comprueba el arranque, no la buena voluntad: `exigirClaveDeCifradoValida`
descifra una fila real antes de aceptar peticiones y **el servidor se niega a
arrancar** si la clave no es la que cifró los datos. No repara nada —no puede—,
pero convierte «arrancó y parece bien» en «no arranca y dice por qué». Se puede
comprobar a mano en cualquier momento:

```bash
docker compose -f docker-compose.produccion.yml exec app \
  node dist/herramientas/verificar-cifrado.cjs
```

#### Paso 2. Lo demás

```bash
git clone … && cd Inventario-General-Riwi
cp .env.produccion.example .env && $EDITOR .env   # con la clave del paso 1
docker compose -f docker-compose.produccion.yml up -d --build
docker compose -f docker-compose.produccion.yml exec app node dist/herramientas/migrar.cjs
docker compose -f docker-compose.produccion.yml exec app node dist/herramientas/semillas.cjs
```

Después, la cuenta de administrador (interactiva, pide la contraseña por stdin):

```bash
docker compose -f docker-compose.produccion.yml exec -it app \
  node dist/herramientas/crear-usuario.cjs johan@bbl.local "Johan Rivera" admin
```

### La carga inicial de los datos va por volcado, no por Excel

Los 938 equipos ya están importados, limpios y revisados en el portátil. En la
VPS **no se vuelve a importar**: se lleva un volcado.

Es lo correcto por dos motivos. Uno, los Excel de `data/origen/` llevan
contraseñas en texto plano y no deben salir de esa carpeta (regla 6): subirlos a
la VPS sería mandarlas a un servidor. Dos, reimportar significa volver a pasar
por los 495 marcados y las decisiones ya tomadas sobre ellos.

```bash
# En el portátil
docker compose exec -T postgres pg_dump -Fc -f /tmp/carga-inicial.dump
docker cp "$(docker compose ps -q postgres):/tmp/carga-inicial.dump" ./carga-inicial.dump
scp carga-inicial.dump usuario@vps:/tmp/

# En la VPS
docker cp /tmp/carga-inicial.dump \
  "$(docker compose -f docker-compose.produccion.yml ps -q postgres):/respaldos/"
CONFIRMAR=RESTAURAR ./db/restaurar.sh --en-serio /respaldos/carga-inicial.dump
```

> La clave del `.env` de la VPS tiene que ser la del portátil — es el **paso 1**
> de la puesta en marcha, y el motivo está ahí. `db/restaurar.sh` lo comprueba y
> se niega a dar el respaldo por bueno, pero conviene no llegar ahí.

## Respaldos y restauración

Etapa 7. El §5 del plan lo exige y añade que **un backup no verificado no es un
backup**, así que ninguno de los dos scripts se conforma con que el comando
termine bien.

### `db/respaldar.sh`

Vuelca a `/respaldos` (volumen aparte del de datos, para que un disco lleno o un
`docker volume rm` no se lleve el original y la copia a la vez), **restaura el
volcado en una base temporal y compara los conteos de las seis tablas**, y solo
entonces rota conservando `RETENER=14`.

```bash
./db/respaldar.sh            # verifica y rota
RETENER=30 ./db/respaldar.sh # conservar más
```

En cron, con la ruta absoluta del repo:

```cron
15 3 * * * cd /srv/riwistock && ./db/respaldar.sh >> /var/log/riwistock-respaldo.log 2>&1
```

Lo que **no** hace, y hay que hacer aparte: sacar la copia de la máquina. Un
respaldo en el mismo servidor protege de un `DROP TABLE`, no de perder el
servidor.

### `db/restaurar.sh`

```bash
./db/restaurar.sh                       # PRUEBA: base temporal, no toca producción
./db/restaurar.sh --en-serio            # sustituye la base real
./db/restaurar.sh /respaldos/x.dump     # elige el fichero
```

Sin `--en-serio` restaura en una base desechable y la borra al terminar. Es el
modo que se puede correr cualquier día sin miedo, y el que conviene correr de vez
en cuando: **un respaldo que nunca se ha restaurado no se sabe si sirve**.

La prueba llega hasta descifrar. `pg_restore` puede terminar en 0 y dejar una
base cuyos secretos son ilegibles, porque la `ENCRYPTION_KEY` no está dentro del
volcado. `db/verificar-cifrado.cjs` descifra una fila real y **falla si no hay ni
una fila cifrada**: sin nada que descifrar no hay nada comprobado, y un verde de
vacío en la prueba de un respaldo es justo lo que no sirve.

Cada causa tiene su código de salida, porque no son lo mismo:

| Código | Significa |
| --- | --- |
| 0 | la clave descifra |
| 1 | la clave **no** descifra — un hecho |
| 2 | no hay ni una fila cifrada — no se comprobó nada |
| 3 | no se pudo comprobar — ausencia de información, no un diagnóstico |

El 3 existe porque la primera versión salía con 1 pasara lo que pasara, y el
script traducía ese 1 a «tus secretos son ilegibles». Con la base caída ese
mensaje es falso y manda a buscar una clave que no se ha perdido.

### `--en-serio` vacía los esquemas; `--clean` no bastaba

`pg_restore --clean --if-exists` borra solo los objetos **que están en el
volcado**. Lo creado después sobrevive. Se comprobó creando una tabla después del
respaldo y viéndola seguir ahí mientras el script decía «producción restaurada y
comprobada».

Lo grave no es la tabla suelta: es el caso mixto. Si entre el respaldo y la
restauración se aplicó una migración, `drizzle.__drizzle_migrations` vuelve al
estado del volcado —dice que esa migración no corrió— mientras las tablas que
creó se quedan puestas. La siguiente migración muere con `already exists` y el
motivo está dos semanas atrás.

Ahora se vacían **todos** los esquemas de la aplicación y luego se restaura. Son
dos y no uno: drizzle guarda su tabla de migraciones en un esquema llamado
`drizzle`, y vaciando solo `public` el `pg_restore` moría con
`relation "__drizzle_migrations_id_seq" already exists`.

Antes de vaciar, el script deja un volcado de seguridad en
`/respaldos/antes-de-restaurar-<sello>.dump`. Si el `pg_restore` falla a mitad, la
base se quedaría sin lo que tenía y sin lo que iba a tener; ese fichero es la
vuelta atrás, y el script dice el comando exacto para usarlo.

### `db/probar-respaldo.sh`: el ciclo entero, repetible

Corre las siete cosas de una vez y sale con código distinto de cero si alguna
falla. **Se corre antes de un despliegue y una vez en la VPS recién montada.**

    ./db/probar-respaldo.sh

Comprueba que las cuatro herramientas `.cjs` de la imagen cargan, que
`verificar-cifrado` devuelve sus cuatro códigos distintos, que `respaldar.sh`
deja un fichero verificado, que la restauración de prueba llega a descifrar, que
`--en-serio` **no** se dispara sin confirmación, que una tabla creada después del
respaldo desaparece al restaurar, y que al terminar la base tiene las mismas
filas que al empezar.

Aborta si la base no tiene ni una fila cifrada: sobre datos sin cifrar pasaría
sin comprobar el descifrado, que es su motivo de existir.

Existe porque los cinco fallos que tenían estos scripts la primera vez que se
corrieron de verdad no se ven leyendo el código, y `npm test` no toca nada de
esto. El paso 6 se falsificó volviendo `restaurar.sh` a `--clean` para ver que
salía en rojo.

### La confirmación se lee del terminal

`--en-serio` pide escribir `RESTAURAR`. Se lee de `/dev/tty`, no de stdin, porque
`docker compose exec -T` hereda stdin y lo consume hasta EOF: cuando el script
llegaba a preguntar ya no había nada que leer, `read` devolvía 1 y `set -e` lo
mataba justo después de imprimir la pregunta, sin restaurar y sin decir por qué.
A mano no se nota, porque el teclado no se agota.

Sin terminal (cron, CI) **no se asume que sí**: hay que pasar
`CONFIRMAR=RESTAURAR` a propósito. Un script que sustituye la base de producción
no continúa porque nadie haya dicho que no.
