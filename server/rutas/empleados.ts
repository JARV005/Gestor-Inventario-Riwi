/**
 * `/api/empleados`.
 *
 * Aquí vive la decisión de modelo de la etapa: **no se puede desactivar a un
 * empleado que tenga equipos a su nombre.** Ver `PATCH /:id`.
 */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoEmpleados from '../../db/repositorios/empleados.js';
import { estadoEmpleado } from '../../db/esquema.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp, noEncontrado } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

const campos = z.object({
  nombre: z.string().trim().min(1).max(200),
  cedula: z.string().trim().max(40).nullable().optional(),
  email_corporativo: z.string().trim().max(320).nullable().optional(),
  cargo: z.string().trim().max(160).nullable().optional(),
  area: z.string().trim().max(160).nullable().optional(),
  sede_id: uuid.nullable().optional(),
  estado: z.enum(estadoEmpleado.enumValues).optional(),
  telefono: z.string().trim().max(60).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  activo: z.boolean().optional(),
});

const esquemaCrear = campos;
const esquemaActualizar = campos.partial();

const esquemaFiltros = z.object({
  q: z.string().trim().max(120).optional(),
  sede: uuid.optional(),
  activo: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  pagina: z.coerce.number().int().min(1).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
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

export function registrarRutasEmpleados(app: Express): void {
  ruta(
    app,
    'get',
    '/api/empleados',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      res.json(await repoEmpleados.listar(validar(esquemaFiltros, req.query)));
    }),
  );

  ruta(
    app,
    'get',
    '/api/empleados/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const empleado = await repoEmpleados.porId(validar(uuid, req.params.id));
      if (!empleado) throw noEncontrado('Empleado');
      res.json({ empleado });
    }),
  );

  ruta(
    app,
    'get',
    '/api/empleados/:id/equipos',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const empleado = await repoEmpleados.porId(id);
      if (!empleado) throw noEncontrado('Empleado');
      res.json({ equipos: await repoEmpleados.equiposDe(id) });
    }),
  );

  ruta(
    app,
    'post',
    '/api/empleados',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const datos = validar(esquemaCrear, req.body);
      res.status(201).json({ empleado: await repoEmpleados.crear(datos) });
    }),
  );

  ruta(
    app,
    'patch',
    '/api/empleados/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const datos = validar(esquemaActualizar, req.body);

      const empleado = await repoEmpleados.porId(id);
      if (!empleado) throw noEncontrado('Empleado');

      /**
       * Desactivar a alguien con equipos a su nombre se bloquea, y la respuesta
       * dice cuáles.
       *
       * Un empleado inactivo con un portátil asignado es un equipo perdido con
       * pasos extra: no sale en los listados de gente activa, así que nadie
       * vuelve a mirarlo, y el equipo sigue figurando entregado a quien ya no
       * está. Obligar a devolver primero es el orden real de un offboarding.
       *
       * Se comprueba solo al pasar de activo a inactivo: un PATCH que no toque
       * `activo`, o que reactive, no tiene por qué exigir nada.
       */
      if (datos.activo === false && empleado.activo) {
        const asignados = await repoEmpleados.equiposDe(id);
        if (asignados.length > 0) {
          throw new ErrorHttp(
            409,
            'No se puede desactivar a un empleado con equipos a su nombre. Devolverlos primero.',
            { equipos: asignados },
          );
        }
      }

      const actualizado = await repoEmpleados.actualizar(id, datos);
      if (!actualizado) throw noEncontrado('Empleado');
      res.json({ empleado: actualizado });
    }),
  );
}
