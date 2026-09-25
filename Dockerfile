# syntax=docker/dockerfile:1

# ============================================================================
# RiwiStock — imagen de producción
# ============================================================================
#
# Dos etapas: una construye con todas las dependencias, la otra se queda solo
# con lo que hace falta para servir. La imagen final no lleva `vite`, ni `tsx`,
# ni los tests, ni los Excel.

# ---------------------------------------------------------------------------
# 1. Construcción
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# `canvas-confetti` y `pdfkit` no compilan nada, pero `bcryptjs` y `pg` sí
# pueden necesitar herramientas según la plataforma. Se instalan aquí y se
# quedan en esta etapa.
COPY package*.json ./
RUN npm ci

COPY . .

# Genera `dist/` con el cliente (vite) y el servidor (esbuild).
RUN npm run build

# `--out-extension:.js=.cjs` no es un capricho: el package.json declara
# "type": "module", así que un .js con require() revienta al arrancar. La
# extension .cjs es lo que le dice a node que ese fichero es CommonJS.
#
# El migrador y la siembra van por `tsx`, que es una dependencia de desarrollo:
# en la imagen final no existe. Se compilan aquí con el mismo esbuild que el
# servidor, y así producción no arrastra el cargador de TypeScript.
RUN npx esbuild db/migrar.ts db/semillas.ts db/crear-usuario.ts db/verificar-cifrado.ts \
      --bundle --platform=node --format=cjs --packages=external \
      --outdir=dist/herramientas --out-extension:.js=.cjs

# ---------------------------------------------------------------------------
# 2. Ejecución
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Solo las dependencias de producción: la imagen baja de ~500 MB a la mitad, y
# lo que no está no se puede explotar.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Los .sql de las migraciones se leen EN EJECUCIÓN: `drizzle` los abre desde
# `./db/migraciones` cuando corre `migrate`. Sin ellos, la imagen arranca pero
# no se puede migrar.
COPY --from=build /app/db/migraciones ./db/migraciones

# Los logos de las actas, por lo mismo: `db/acta-formato.ts` los lee con ruta
# relativa al directorio de trabajo, y sus bytes forman parte del hash de cada
# acta (D39). Sin ellos no se puede emitir ninguna.
COPY --from=build /app/assets ./assets

# Usuario sin privilegios. La imagen de node ya trae `node` (uid 1000).
USER node

EXPOSE 3000

# Sin `npm start`: npm se queda en medio como proceso padre y no reenvía
# SIGTERM, así que el contenedor tarda diez segundos en morir en cada
# despliegue en vez de cerrar el pool de Postgres y salir.
CMD ["node", "dist/server.cjs"]
