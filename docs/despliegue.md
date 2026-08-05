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

`POSTGRES_PASSWORD` no tiene valor por defecto a propósito: docker compose falla
si no está definida, en vez de arrancar con una contraseña adivinable.

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
