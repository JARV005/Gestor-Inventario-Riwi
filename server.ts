// Sin esto no hay DATABASE_URL, ni SESSION_SECRET, ni ENCRYPTION_KEY: `tsx` no
// lee .env por su cuenta y el servidor moría al construir el pool.
import "dotenv/config";

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

import { crearApp } from "./server/app.js";
import { exigirClaveDeCifradoValida } from "./db/comprobar-cifrado.js";

const app = express();
const PORT = 3000;

// Aquí había un `express.json({ limit: "10mb" })`. Existía para los payloads
// del copiloto, y como corría antes que la API, **anulaba en silencio el límite
// de 1 MB** que `crearApp()` se pone a sí misma: para cuando su parser miraba,
// el cuerpo ya estaba leído. Sin IA no queda ninguna ruta fuera de `/api` que
// reciba un cuerpo, así que se va y el límite de la API vuelve a ser el real.

/**
 * La API de la etapa 3, montada solo para `/api`.
 *
 * Con `app.use(api)` a secas, la sesión y el parseo de JSON correrían también
 * para cada asset que sirve Vite — una consulta a Postgres por cada .tsx del
 * arranque. El filtro por prefijo lo evita.
 *
 * Antes había manejadores `/api/gemini/*` más abajo que recogían lo que la API
 * no conocía. Ya no existe ninguno: `/api` es enteramente `crearApp()`, y una
 * ruta desconocida bajo ese prefijo termina en su 404, no en el index.html.
 */
const api = crearApp();
app.use((req, res, next) => (req.path.startsWith("/api") ? api(req, res, next) : next()));

async function startServer() {
  // Antes de aceptar una sola peticion: si la clave no descifra, no se arranca.
  await exigirClaveDeCifradoValida();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`RiwiStock escuchando en http://0.0.0.0:${PORT}`);
  });
}

startServer();
