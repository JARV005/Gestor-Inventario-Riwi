# RiwiStock

Inventario de equipos de TI de **RIWI** y **BBL Labs**: quién tiene cada equipo,
qué le ha pasado desde que entró, y las actas de entrega y devolución que lo
respaldan.

Sustituye a un inventario en Excel. La migración va por etapas y su estado está
en [`docs/pendientes.md`](docs/pendientes.md).

## Qué hace

- **Inventario** de 305 equipos con su estado, sede, responsable y garantía.
- **Movimientos**: cada asignación, devolución, traslado, préstamo, baja o
  entrada a mantenimiento queda registrada y no se puede borrar.
- **Actas en PDF** con el formato aprobado por BBL, numeradas por empresa y
  **verificables**: el documento se regenera desde su instantánea y se compara
  el hash, así que se detecta si el PDF guardado fue alterado.
- **Bandeja de revisión** para las filas que el importador no pudo dar por
  buenas, que se cierran por bloques dejando constancia.
- **Mantenimiento**: partes abiertos, su cierre por retorno o por baja.

Las contraseñas de BIOS y las licencias van cifradas con AES-256-GCM y no
aparecen en listados, registros ni exportaciones. Toda escritura sobre `equipos`
deja rastro en `auditoria`.

**La aplicación no hace ninguna llamada a servicios externos.** Puede vivir en
una máquina sin salida a internet.

## Puesta en marcha

Hace falta **Node.js 22** y **Docker**.

```bash
npm install
cp .env.example .env     # y rellenarlo: ver docs/despliegue.md
npm run db:up            # Postgres en Docker
npm run migrate          # esquema
npm run seed             # sedes, motivos y la cuenta de administración
npm run dev              # http://localhost:3000
```

Sin `ADMIN_EMAIL`, `ADMIN_NOMBRE` y `ADMIN_PASSWORD` en el `.env`, la siembra no
crea ninguna cuenta y lo dice: un administrador con contraseña por defecto es
una puerta trasera que nadie recuerda haber abierto. Para crearla a mano:

```bash
npm run usuario -- <email> "<nombre>" admin
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con Vite en middleware |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | La batería completa. **Es el único criterio**: un fichero suelto sale con código 0 aunque falle |
| `npm run db:verificar` | Los dos verificadores SQL: que las reglas están puestas y que los datos las cumplen |
| `npm run build` | Cliente y servidor para producción |
| `npm run import` | Carga los dos Excel de `data/origen/` |

## Cómo se comprueba que está bien

Cuatro cosas, y ninguna es opcional para cerrar una etapa:

```
npm run lint
npm test
npm run db:verificar
npm run build
```

`db/verificar-esquema.sql` comprueba con filas sintéticas que las reglas existen,
y **pasa en una base vacía**. `db/verificar-datos.sql` comprueba que lo cargado
las cumple. Los dos terminan con error si encuentran algo: un verificador cuyo
veredicto lo lee una persona a ojo ya dejó pasar un fallo durante una etapa
entera.

## Stack

React 19 · Vite · Tailwind 4 · Express · PostgreSQL 17 · Drizzle · TypeScript

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/plan-migracion-v1.md`](docs/plan-migracion-v1.md) | El plan y las siete etapas. Fuente de verdad |
| [`docs/despliegue.md`](docs/despliegue.md) | Variables de entorno, puertos, custodia de la clave de cifrado |
| [`docs/esquema.md`](docs/esquema.md) | Las tablas y por qué son así |
| [`docs/api.md`](docs/api.md) | Los endpoints |
| [`docs/importacion.md`](docs/importacion.md) | Cómo se leen los Excel y qué se rechaza |
| [`docs/decisiones-01.md`](docs/decisiones-01.md) … [`06`](docs/decisiones-06.md) | Las decisiones tomadas, en orden. Las últimas ganan |
| [`docs/pendientes.md`](docs/pendientes.md) | Lo que falta, con su etapa |
| [`docs/paleta.md`](docs/paleta.md) | Los colores y sus ratios de contraste |

## Sobre los datos

`data/origen/` está en `.gitignore` y **no debe salir de ahí**: contiene los
Excel originales con contraseñas en texto plano.
