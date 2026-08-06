/** `/api/sedes`. */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoSedes from '../../db/repositorios/sedes.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp, noEncontrado } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

const campos = z.object({
  nombre: z.string().trim().min(1).max(120),
  ciudad: z.string().trim().max(120).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  responsable: z.string().trim().max(200).nullable().optional(),
  contacto_email: z.string().trim().max(320).nullable().optional(),
  contacto_telefono: z.string().trim().max(60).nullable().optional(),
  activa: z.boolean().optional(),
});

function validar<T>(esquema: z.ZodType<T>, entrada: unknown): T {
  const r = esquema.safeParse(entrada);
  if (!r.success) {
    throw new ErrorHttp(400, 'Entrada inválida', {
      campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })),
    });
  }
  return r.data;
}

export function registrarRutasSedes(app: Express): void {
  ruta(
    app,
    'get',
    '/api/sedes',
    'autenticado',
    guardian,
    asincrono(async (_req, res) => {
      res.json({ sedes: await repoSedes.listar() });
    }),
  );

  ruta(
    app,
    'get',
    '/api/sedes/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const sede = await repoSedes.porId(validar(uuid, req.params.id));
      if (!sede) throw noEncontrado('Sede');
      res.json({ sede });
    }),
  );

  ruta(
    app,
    'post',
    '/api/sedes',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      res.status(201).json({ sede: await repoSedes.crear(validar(campos, req.body)) });
    }),
  );

  ruta(
    app,
    'patch',
    '/api/sedes/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const sede = await repoSedes.actualizar(id, validar(campos.partial(), req.body));
      if (!sede) throw noEncontrado('Sede');
      res.json({ sede });
    }),
  );
}
