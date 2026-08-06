/**
 * El guardián que se antepone a toda ruta registrada con `ruta()`.
 *
 * Revalida la sesión **en cada petición** contra la BD, no solo en el login.
 * Eso es deliberado y es el punto más importante de la etapa:
 *
 *   - Desactivar a alguien desde la aplicación tiene que echarlo **ahora**. Si
 *     su sesión sigue viva hasta que caduque, no lo desactivaste: le pusiste
 *     una fecha.
 *   - Cambiar una contraseña tiene que matar las sesiones abiertas. Quien la
 *     cambia porque sospecha que se la robaron no gana nada si la sesión del
 *     atacante sobrevive al cambio.
 *
 * El precio es una consulta por petición. Es una lectura por clave primaria y
 * el rol también hay que leerlo de todos modos: guardarlo en la sesión haría
 * que degradar a alguien de admin a tecnico no tuviera efecto hasta que
 * cerrase sesión, que es el mismo error con otro nombre.
 */

import type { Request, RequestHandler, Response } from 'express';

import * as repoUsuarios from '../db/repositorios/usuarios.js';
import { ErrorHttp, noAutenticado, permisoInsuficiente } from './errores.js';
import type { Permiso, Rol } from './permisos.js';
import { huellaCredenciales } from './sesion.js';

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioSesion;
    }
  }
}

/** Cierra la sesión del lado del servidor. No basta con borrar la cookie. */
function destruir(req: Request): Promise<void> {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
}

export function guardian(permiso: Permiso): RequestHandler {
  return (req: Request, res: Response, next) => {
    if (permiso === 'publico') {
      next();
      return;
    }

    void (async () => {
      try {
        const enSesion = req.session?.usuario;
        if (!enSesion) throw noAutenticado();

        const usuario = await repoUsuarios.porIdParaSesion(enSesion.id);

        // Cada comprobación por separado y con su propio motivo. Ninguna
        // depende de que la anterior siga puesta: ver D4 y los tests que
        // construyen los dos estados por separado.
        if (!usuario) {
          await destruir(req);
          throw noAutenticado();
        }
        if (!usuario.activo) {
          await destruir(req);
          throw noAutenticado();
        }
        if (usuario.password_hash === null) {
          await destruir(req);
          throw noAutenticado();
        }
        if (huellaCredenciales(usuario.password_hash) !== enSesion.huella) {
          await destruir(req);
          throw noAutenticado();
        }

        req.usuario = {
          id: usuario.id,
          email: usuario.email,
          nombre: usuario.nombre,
          rol: usuario.rol,
        };

        if (permiso === 'autenticado') {
          next();
          return;
        }
        if (usuario.rol !== permiso) throw permisoInsuficiente();

        next();
      } catch (e) {
        next(e instanceof ErrorHttp ? e : noAutenticado());
      }
    })();
  };
}
