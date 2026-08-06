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

- **La máquina puede vivir sin salida a internet.** Un cortafuegos que bloquee
  todo el tráfico saliente no rompe nada de la aplicación. Solo hace falta
  alcanzarla desde la red interna, y que ella alcance a Postgres.
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

## Restauración de backups

Fuera de alcance hasta la etapa 7. El §5 del plan la exige y añade que un backup
no verificado no es un backup.
