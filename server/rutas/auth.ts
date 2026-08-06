/**
 * `/api/auth`. Login, logout y quién soy.
 */

import bcrypt from 'bcryptjs';
import type { Express, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import * as repoUsuarios from '../../db/repositorios/usuarios.js';
import { asincrono, ErrorHttp, noAutenticado } from '../errores.js';
import { guardian } from '../autenticar.js';
import { ruta } from '../permisos.js';
import { huellaCredenciales } from '../sesion.js';

export const COSTE_BCRYPT = 12;

/**
 * Hash señuelo, con el mismo coste que los reales.
 *
 * Cuando el email no existe, se compara contra esto en vez de responder de
 * inmediato. Sin ello, "usuario inexistente" tarda ~1 ms y "contraseña
 * incorrecta" ~230 ms, y esa diferencia enumera cuentas aunque el cuerpo de la
 * respuesta sea idéntico.
 *
 * De su contraseña no hay copia: se generó de 32 bytes aleatorios y se tiró.
 */
const HASH_SENUELO = '$2b$12$ACpANO7gQXxpUXxM4.SoCOok8SHwyqCrWeQjc3bHw6lLefQ3Htur.';

/** Un solo mensaje para todos los fallos de login. Ver `responderCredenciales`. */
const CREDENCIALES_INVALIDAS = 'Credenciales inválidas';

/**
 * El mismo error para "no existe", "contraseña incorrecta", "inactivo" y "sin
 * contraseña". Distinguirlos convierte el login en un oráculo de qué cuentas
 * existen y cuáles están desactivadas.
 */
const credencialesInvalidas = () => new ErrorHttp(401, CREDENCIALES_INVALIDAS);

const esquemaLogin = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(200),
});

/**
 * Se crea por aplicación y no al cargar el módulo: su contador vive en memoria,
 * y compartido entre las apps que levantan los tests, el que agota la cuota
 * dejaría 429 a todos los demás.
 */
function crearLimitadorLogin() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_LIMITE ?? 10),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Cuenta también los intentos correctos. No es por castigar el acierto: si
    // no contaran, bastaría con intercalar un login válido de una cuenta propia
    // para reiniciar la cuota y seguir probando contra otra.
    message: { error: 'Demasiados intentos. Probar de nuevo más tarde.' },
  });
}

/** `req.session.regenerate` en forma de promesa. */
function regenerar(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function guardar(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export function registrarRutasAuth(app: Express): void {
  ruta(
    app,
    'post',
    '/api/auth/login',
    'publico',
    guardian,
    crearLimitadorLogin(),
    asincrono(async (req, res) => {
      const entrada = esquemaLogin.safeParse(req.body);
      if (!entrada.success) throw credencialesInvalidas();

      const { email, password } = entrada.data;
      const usuario = await repoUsuarios.porEmailParaLogin(email);

      if (!usuario) {
        // Se compara igualmente, para no responder antes que en el caso real.
        await bcrypt.compare(password, HASH_SENUELO);
        throw credencialesInvalidas();
      }

      // --- Las dos comprobaciones de D4, separadas y explícitas.
      //
      // Van una detrás de otra y no en una sola condición combinada a
      // propósito: cada una tiene que rechazar por su cuenta, sin que la otra
      // la esté tapando. Los tests construyen los dos estados por separado
      // —activo=false con hash válido, y activo=true con hash NULL— justo para
      // demostrar que ninguna depende de la otra.

      if (!usuario.activo) {
        await bcrypt.compare(password, HASH_SENUELO);
        throw credencialesInvalidas();
      }

      if (usuario.password_hash === null) {
        // Nunca se llama a bcrypt.compare con null: según la versión, puede
        // lanzar, y un throw atrapado más arriba se convertiría en un camino
        // de salida inesperado. La cuenta sin hash se rechaza aquí y punto.
        await bcrypt.compare(password, HASH_SENUELO);
        throw credencialesInvalidas();
      }

      const coincide = await bcrypt.compare(password, usuario.password_hash);
      if (!coincide) throw credencialesInvalidas();

      // Sesión nueva: sin esto, un `sid` que el atacante haya conseguido fijar
      // antes del login pasaría a estar autenticado.
      await regenerar(req);
      req.session.usuario = {
        id: usuario.id,
        huella: huellaCredenciales(usuario.password_hash),
      };
      await guardar(req);
      await repoUsuarios.marcarAcceso(usuario.id);

      res.json({
        usuario: {
          id: usuario.id,
          email: usuario.email,
          nombre: usuario.nombre,
          rol: usuario.rol,
        },
      });
    }),
  );

  ruta(
    app,
    'post',
    '/api/auth/logout',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      // Destruir la fila del store, no solo limpiar la cookie: si la sesión
      // sobrevive en Postgres, quien tenga la cookie sigue dentro.
      await new Promise<void>((resolve, reject) =>
        req.session.destroy((err) => (err ? reject(err) : resolve())),
      );
      res.clearCookie('inventario.sid');
      res.status(204).end();
    }),
  );

  ruta(app, 'get', '/api/auth/me', 'autenticado', guardian, (req, res) => {
    if (!req.usuario) throw noAutenticado();
    res.json({ usuario: req.usuario });
  });
}
