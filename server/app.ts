/**
 * Construye la aplicación de API. Sin escuchar en ningún puerto: eso lo hacen
 * `server.ts` en desarrollo y los tests, que la levantan en un puerto efímero.
 *
 * Los tests hablan HTTP de verdad contra esto, y no con un arnés en proceso,
 * porque lo que hay que comprobar es la cookie y el store: un arnés que permita
 * inyectar un objeto de sesión prueba el arnés.
 */

import express, { type Express } from 'express';

import { manejadorErrores } from './errores.js';
import { guardian } from './autenticar.js';
import { limpiarRegistro, ruta } from './permisos.js';
import { registrarRutasAuth } from './rutas/auth.js';
import { registrarRutasEmpleados } from './rutas/empleados.js';
import { registrarRutasEquipos } from './rutas/equipos.js';
import { registrarRutasSedes } from './rutas/sedes.js';
import { middlewareSesion } from './sesion.js';

export function crearApp(): Express {
  // El registro de permisos es de módulo. Si la app se construye dos veces en
  // el mismo proceso —los tests lo hacen— habría que empezar de cero o `ruta()`
  // lanzaría por duplicado.
  limpiarRegistro();

  const app = express();

  // Detrás de un proxy, sin esto todas las peticiones parecen venir de la
  // misma IP y el rate limit del login se convierte en un límite global.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '1mb' }));
  app.use(middlewareSesion());

  ruta(app, 'get', '/api/health', 'publico', guardian, (_req, res) => {
    res.json({ ok: true });
  });

  registrarRutasAuth(app);
  registrarRutasEquipos(app);
  registrarRutasEmpleados(app);
  registrarRutasSedes(app);

  // Siempre el último: si se registra antes que las rutas, no las cubre.
  app.use(manejadorErrores);

  return app;
}
