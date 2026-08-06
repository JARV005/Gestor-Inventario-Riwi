/**
 * Errores HTTP y el manejador final.
 *
 * La regla central: **el cuerpo de una respuesta de error se construye, nunca
 * se serializa.** Un `res.json(err)` o un `res.json({ ...fila })` en un 500
 * filtra exactamente lo mismo que un listado descuidado —incluidos
 * `bios_password_cifrado` y `licencia_serial_cifrado`— y encima en el sitio
 * donde nadie mira. Por eso el manejador de abajo solo lee dos campos del
 * error y descarta el resto: lo que no está en la lista no sale.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { traducirErrorPostgres } from './errores-postgres.js';

export class ErrorHttp extends Error {
  constructor(
    readonly estado: number,
    /** Este texto SÍ se manda al cliente. Escribirlo pensando en eso. */
    readonly mensajePublico: string,
    /** Datos adicionales para el cliente. Solo campos elegidos a mano. */
    readonly detalles?: Record<string, unknown>,
  ) {
    super(mensajePublico);
  }
}

export const noAutenticado = () => new ErrorHttp(401, 'No autenticado');
export const permisoInsuficiente = () => new ErrorHttp(403, 'Permiso insuficiente');
export const noEncontrado = (que: string) => new ErrorHttp(404, `${que} no encontrado`);

/**
 * Express 4 no captura el rechazo de un manejador async: se pierde y la
 * petición se queda colgada. Todo manejador async se envuelve con esto.
 */
export const asincrono =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function manejadorErrores(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ErrorHttp) {
    res.status(err.estado).json({ error: err.mensajePublico, ...(err.detalles ?? {}) });
    return;
  }

  // Las violaciones de integridad no son fallos nuestros: son la base
  // rechazando algo que la persona puede corregir. Se traducen aquí, una vez,
  // y no en cada formulario — si no, reaparecen en cada uno.
  const traducido = traducirErrorPostgres(err);
  if (traducido) {
    res.status(traducido.estado).json({
      error: traducido.mensajePublico,
      ...(traducido.detalles ?? {}),
    });
    return;
  }

  // Cualquier otra cosa sí es un fallo nuestro. Al log va todo; al cliente,
  // nada más que el código. Un error de Postgres lleva dentro la consulta y a
  // veces los valores, así que serializarlo es una fuga con otro nombre.
  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'Error interno' });
}
