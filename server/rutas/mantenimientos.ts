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

const esquemaAbrir = z.object({
  equipo_id: uuid,
  tipo: z.string().trim().min(1).max(120),
  descripcion: z.string().trim().max(2000).nullable().optional(),
  responsable: z.string().trim().max(120).nullable().optional(),
  proveedor: z.string().trim().max(120).nullable().optional(),
});

const esquemaActualizar = z.object({
  // Solo los abiertos: los dos de cierre mueven el equipo y van por su ruta.
  estado: z.enum(['Pendiente', 'En taller', 'Completado']).optional(),
  descripcion: z.string().trim().max(2000).nullable().optional(),
  responsable: z.string().trim().max(120).nullable().optional(),
  proveedor: z.string().trim().max(120).nullable().optional(),
  costo: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, { message: 'importe inválido; usar punto decimal' })
    .nullable()
    .optional(),
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

/** Los errores del repositorio, con el porqué y la salida. */
function traducir(e: unknown): unknown {
  if (e instanceof repoMantenimientos.EquipoNoSePuedeEnviar) {
    return new ErrorHttp(409, e.message, {
      estado_actual: e.estado_actual,
      puedes: e.puedes,
    });
  }
  if (e instanceof repoMantenimientos.ParteNoEncontrado) {
    return new ErrorHttp(404, 'No se encontró el parte.');
  }
  if (e instanceof repoMantenimientos.ParteYaCerrado) {
    return new ErrorHttp(
      409,
      `Ese parte ya está cerrado (${e.message}). Un parte cerrado no se reabre: si el equipo vuelve al taller, se abre uno nuevo.`,
    );
  }
  return e;
}

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

  /**
   * Abrir un parte **manda el equipo al taller**: el parte y el movimiento van
   * en la misma transacción (D29). Si el equipo no se deja mover, no se abre
   * el parte.
   */
  ruta(
    app,
    'post',
    '/api/mantenimientos',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const datos = validar(esquemaAbrir, req.body);
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const parte = await repoMantenimientos.abrir(datos, { usuarioId, ip: req.ip ?? null });
        res.status(201).json({ parte });
      } catch (e) {
        throw traducir(e);
      }
    }),
  );

  /** Mover el parte entre estados abiertos. No toca el equipo. */
  ruta(
    app,
    'patch',
    '/api/mantenimientos/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);

      // ANTES de validar, y no después. `esquemaActualizar` solo admite los
      // tres estados abiertos, así que un `estado: 'Devuelto'` moría en zod con
      // un 400 «Entrada inválida» y este 409 no se alcanzaba nunca: el mensaje
      // que dice por dónde se cierra un parte era código correcto e
      // inalcanzable, como el estado de error de `InventoryView`.
      //
      // Cerrar tiene su propio endpoint porque mueve el equipo. Dejarlo entrar
      // por aquí sería un `PATCH` que cambia el estado de un equipo sin que el
      // nombre de la ruta lo diga — justo lo que D19 cerró.
      const estadoPedido = (req.body as { estado?: string } | null)?.estado;
      if (estadoPedido === 'Devuelto' || estadoPedido === 'Baja tras revisión') {
        throw new ErrorHttp(
          409,
          'Cerrar el parte se hace en POST /api/mantenimientos/:id/cerrar, porque además saca el equipo del taller.',
        );
      }

      const cambios = validar(esquemaActualizar, req.body);
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const parte = await repoMantenimientos.actualizar(id, cambios, {
          usuarioId,
          ip: req.ip ?? null,
        });
        res.json({ parte });
      } catch (e) {
        throw traducir(e);
      }
    }),
  );

  /**
   * Cerrar. **Un solo gesto**: cierra el parte y saca el equipo del taller.
   *
   * `desenlace` es obligatorio y no tiene valor por defecto: la pregunta «¿el
   * equipo volvió, o no tenía arreglo?» solo la puede contestar quien lo tiene
   * delante, y suponerla dejaría un portátil muerto como disponible.
   */
  ruta(
    app,
    'post',
    '/api/mantenimientos/:id/cerrar',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const { desenlace } = validar(
        z.object({ desenlace: z.enum(['retorno', 'baja']) }),
        req.body,
      );
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      try {
        const parte = await repoMantenimientos.cerrar(id, desenlace, {
          usuarioId,
          ip: req.ip ?? null,
        });
        res.json({ parte });
      } catch (e) {
        throw traducir(e);
      }
    }),
  );
}
