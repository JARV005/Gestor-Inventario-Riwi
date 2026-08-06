/**
 * `/api/mantenimientos`. **Solo lectura.**
 *
 * Sin `POST` ni `PATCH`: abrir, cerrar y devolver partes es la etapa 6, y son
 * escrituras que además tocan el estado del equipo. Este `GET` existe para que
 * `MaintenanceView` pueda dejar de leer `mockData` en la 4b, que es la
 * condición para poder borrarlo.
 *
 * La tabla está vacía hoy. Eso no es un problema del endpoint: es el estado
 * vacío, y es justo el fallo que hay que provocar en esa vista.
 */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoMantenimientos from '../../db/repositorios/mantenimientos.js';
import { estadoMantenimiento } from '../../db/esquema.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

const esquemaFiltros = z.object({
  equipo: uuid.optional(),
  estado: z.enum(estadoMantenimiento.enumValues).optional(),
  pagina: z.coerce.number().int().min(1).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
});

export function registrarRutasMantenimientos(app: Express): void {
  ruta(
    app,
    'get',
    '/api/mantenimientos',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const r = esquemaFiltros.safeParse(req.query);
      if (!r.success) {
        throw new ErrorHttp(400, 'Entrada inválida', {
          campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })),
        });
      }
      res.json(await repoMantenimientos.listar(r.data));
    }),
  );
}
