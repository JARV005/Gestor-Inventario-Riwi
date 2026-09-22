/**
 * `/api/equipos`.
 *
 * Las mutaciones de estado —asignar, devolver, reservar, liberar, trasladar y
 * dar de baja— NO están aquí: viven en `rutas/movimientos.ts`, porque escriben
 * en `equipos`, `movimientos` y `auditoria` en la misma transacción y porque
 * qué transición es legal se decide en un solo sitio
 * (`db/transiciones.ts`). Aquí quedan el CRUD y las lecturas.
 */

import type { Express } from 'express';
import { z } from 'zod';

import * as repoAuditoria from '../../db/repositorios/auditoria.js';
import * as repoEquipos from '../../db/repositorios/equipos.js';
import {
  categoriaEquipo,
  condicionEquipo,
  empresaEmpleado,
  estadoEquipo,
  licenciaTipo,
  prestatario,
  propiedadEquipo,
} from '../../db/esquema.js';
import { CODIGOS } from '../../db/motivos.js';
import { guardian } from '../autenticar.js';
import { asincrono, ErrorHttp, noEncontrado } from '../errores.js';
import { ruta } from '../permisos.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
  message: 'identificador inválido',
});

/** Los valores válidos salen del propio enum de la BD, no de una copia. */
const camposEquipo = z.object({
  categoria: z.enum(categoriaEquipo.enumValues),
  etiqueta: z.string().trim().min(1).max(60).nullable().optional(),
  nombre_equipo: z.string().trim().max(120).nullable().optional(),
  marca: z.string().trim().max(80).nullable().optional(),
  modelo: z.string().trim().max(120).nullable().optional(),
  serial: z.string().trim().max(120).nullable().optional(),
  serial_cargador: z.string().trim().max(120).nullable().optional(),
  propiedad: z.enum(propiedadEquipo.enumValues).optional(),
  sistema_operativo: z.string().trim().max(120).nullable().optional(),
  licencia_tipo: z.enum(licenciaTipo.enumValues).nullable().optional(),
  tamano_pantalla: z.string().trim().max(40).nullable().optional(),
  procesador: z.string().trim().max(120).nullable().optional(),
  disco: z.string().trim().max(80).nullable().optional(),
  ram: z.string().trim().max(40).nullable().optional(),
  estado: z.enum(estadoEquipo.enumValues),
  condicion: z.enum(condicionEquipo.enumValues).nullable().optional(),
  sede_id: uuid.nullable().optional(),
  empleado_id: uuid.nullable().optional(),
  sesion_usuario: z.string().trim().max(200).nullable().optional(),
  /**
   * De quién es (D31). SÍ se edita a mano, al contrario que `estado`,
   * `empleado_id` y `sede_id`: la propiedad no sale de ninguna operación —no
   * hay un movimiento «cambio de dueño»— y es justo el campo que hay que tocar
   * para cerrar un `PROPIEDAD_AMBIGUA` desde la bandeja.
   *
   * `prestado_a` no está aquí: ese sí sale de una operación (prestar /
   * recuperar) y su 409 lo dice.
   */
  empresa: z.enum(empresaEmpleado.enumValues).optional(),
  notas: z.string().trim().max(2000).nullable().optional(),
  /**
   * Pesos colombianos, como cadena: `numeric(14,2)` no cabe en un `number` de
   * JavaScript sin perder precisión, y `pg` lo devuelve como texto por lo
   * mismo. Se valida la forma aquí para que un «12.345,67» no llegue a
   * Postgres como error de sintaxis.
   *
   * Estaba fuera del esquema mientras nadie escribía equipos. Al conectar
   * `NewDeviceModal` resultó que el formulario ya pedía el costo y la API lo
   * descartaba sin decir nada: se tecleaba un número y no llegaba a la base.
   */
  costo: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, { message: 'importe inválido; usar punto decimal' })
    .nullable()
    .optional(),
});

const esquemaCrear = camposEquipo;

/**
 * El `PATCH` edita la **ficha**, no la situación del equipo.
 *
 * `estado`, `empleado_id` y `sede_id` quedan fuera desde la etapa 5, y no es
 * una restricción de forma: cambiarlos por aquí escribiría en `equipos` sin
 * escribir en `movimientos`, que es exactamente lo que prohíbe la regla 5 del
 * proyecto. Un equipo que cambia de dueño con un `PATCH` no deja rastro de
 * quién lo tenía antes, y el historial —lo único que justifica el proyecto—
 * pasa a tener agujeros que nadie ve.
 *
 * Los tres tienen su endpoint, y el 409 dice cuál.
 */
const esquemaActualizar = camposEquipo
  .omit({ estado: true, empleado_id: true, sede_id: true })
  .partial();

const POR_SU_ENDPOINT: Record<string, string> = {
  prestado_a:
    'A quién está prestado no se edita a mano: sale de una operación. POST /api/equipos/:id/prestar o /recuperar_prestamo.',
  estado:
    'El estado no se edita a mano: sale de una operación. POST /api/equipos/:id/{asignar|devolver|reservar|liberar|baja}.',
  empleado_id:
    'El responsable no se edita a mano: se asigna o se devuelve. POST /api/equipos/:id/asignar o /devolver.',
  sede_id:
    'La sede no se edita a mano: se traslada. POST /api/equipos/:id/trasladar, y la sede cambia al confirmar la llegada.',
};

const esquemaFiltros = z.object({
  estado: z.enum(estadoEquipo.enumValues).optional(),
  categoria: z.enum(categoriaEquipo.enumValues).optional(),
  sede: uuid.optional(),
  /**
   * Contra el enum de PRÉSTAMO y no el de empresa, más `Sin clasificar`:
   * filtrar por ISF tiene que funcionar, porque ISF tiene dos equipos nuestros
   * en la mano, y `Sin clasificar` no es un prestatario posible pero sí una
   * empresa posible.
   *
   * Enumerado y no texto libre por lo mismo que `motivo`: un valor inexistente
   * devolvería cero filas y parecería «no hay ninguno».
   */
  empresa: z.enum([...prestatario.enumValues, 'Sin clasificar']).optional(),
  q: z.string().trim().max(120).optional(),
  // Se valida contra el catálogo de códigos, no como texto libre: un código
  // inexistente devolvería cero filas y parecería "no hay ninguno".
  motivo: z.enum(CODIGOS as [string, ...string[]]).optional(),
  pagina: z.coerce.number().int().min(1).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
});

function validar<T>(esquema: z.ZodType<T>, entrada: unknown): T {
  const r = esquema.safeParse(entrada);
  if (!r.success) {
    // Solo la ruta del campo y el mensaje: los `issues` de zod incluyen el
    // valor recibido, y ese valor puede ser cualquier cosa que hayan mandado.
    throw new ErrorHttp(400, 'Entrada inválida', {
      campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })),
    });
  }
  return r.data;
}

export function registrarRutasEquipos(app: Express): void {
  ruta(
    app,
    'get',
    '/api/equipos',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const f = validar(esquemaFiltros, req.query);
      // Los conteos por empresa viajan con el listado, igual que los de motivo
      // en la bandeja y los de colaboradores (D28): un número delante es lo que
      // hace que «Sin clasificar» se vea sin ir a buscarlo.
      const [pagina, conteos] = await Promise.all([
        repoEquipos.listar(f),
        repoEquipos.conteoPorEmpresa(),
      ]);
      res.json({ ...pagina, conteos_empresa: conteos });
    }),
  );

  // Antes de '/api/equipos/:id', o Express trataría "revision" como un id.
  ruta(
    app,
    'get',
    '/api/equipos/revision',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const f = validar(esquemaFiltros, req.query);
      const [pagina, conteos, conteosEmpresa] = await Promise.all([
        repoEquipos.listar({ ...f, revision: true }),
        repoEquipos.conteoPorMotivo(),
        repoEquipos.conteoPorEmpresa(),
      ]);
      // Los conteos van con el listado para que la bandeja pueda pintar los
      // bloques sin una segunda petición: "los 37 de licencia" tiene que ser
      // visible antes de filtrar, o nadie sabe por dónde empezar.
      res.json({ ...pagina, conteos, conteos_empresa: conteosEmpresa });
    }),
  );

  /**
   * Cerrar un motivo en TODO su bloque.
   *
   * `admin` y no `autenticado`, al contrario que el cierre de uno solo: esto
   * toca cientos de filas de una vez, y el permiso tiene que ser proporcional a
   * lo que la acción alcanza.
   *
   * POST y no DELETE porque lleva cuerpo —la nota— y porque no es idempotente
   * en el sentido que importa aquí: repetirlo añadiría la nota otra vez a las
   * filas que aún conserven el motivo.
   *
   * Responde **200 aunque haya rechazos**, con el detalle fila a fila. Un 409
   * global diría que no se hizo nada, y lo normal es justo lo contrario: entran
   * casi todas y quedan unas pocas que necesitan una decisión antes (las que al
   * bajar la marca reactivan un índice único parcial sobre un duplicado que
   * sigue ahí).
   */
  ruta(
    app,
    'post',
    '/api/equipos/revision/cerrar-en-bloque',
    'admin',
    guardian,
    asincrono(async (req, res) => {
      const datos = validar(
        z.object({
          motivo: z.enum(CODIGOS as [string, ...string[]]),
          /**
           * Opcional, y con un tope para que no se convierta en un campo de
           * texto libre donde acabe media conversación.
           *
           * No se rellena por defecto: qué se comprobó y quién lo confirmó lo
           * sabe la persona que cierra, no el programa.
           */
          nota: z.string().trim().min(1).max(500).nullable().optional(),
        }),
        req.body,
      );

      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');

      const resultados = await repoEquipos.cerrarMotivoEnBloque(
        datos.motivo,
        datos.nota ?? null,
        { usuarioId, ip: req.ip ?? null },
      );

      const fallidos = resultados.filter((r) => r.problema !== null);
      res.json({
        motivo: datos.motivo,
        cerrados: resultados.length - fallidos.length,
        // Las que no pudieron, con su motivo. Es lo que permite volver sobre
        // ellas: un recuento de fallos sin nombres obliga a buscarlos a mano.
        fallidos,
      });
    }),
  );

  // Igual que '/revision': antes de '/api/equipos/:id' o "resumen" se validaría
  // como uuid y devolvería un 400 en vez del resumen.
  ruta(
    app,
    'get',
    '/api/equipos/resumen',
    'autenticado',
    guardian,
    asincrono(async (_req, res) => {
      res.json(await repoEquipos.resumen());
    }),
  );

  ruta(
    app,
    'get',
    '/api/equipos/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const equipo = await repoEquipos.porId(id);
      if (!equipo) throw noEncontrado('Equipo');
      res.json({ equipo });
    }),
  );

  // `GET /api/equipos/:id/historial` vive en `rutas/movimientos.ts` desde la
  // etapa 5. El de aquí devolvía los UUID a pelo, sin resolver nombres.

  /**
   * El único endpoint que devuelve los campos cifrados, de uno en uno y solo
   * para admin (§5.2). Deja fila en `auditoria` ANTES de responder: si el
   * registro falla, la respuesta no sale.
   */
  ruta(
    app,
    'get',
    '/api/equipos/:id/bios',
    'admin',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const secretos = await repoEquipos.descifrarSecretos(id);
      if (!secretos) throw noEncontrado('Equipo');

      await repoAuditoria.registrar({
        tabla: 'equipos',
        registro_id: id,
        accion: 'descifrar_bios',
        usuario_app_id: req.usuario?.id ?? null,
        ip: req.ip ?? null,
        // Se registra QUE se leyó, nunca el valor leído.
        despues: { campos: ['bios_password', 'licencia_serial'] },
      });

      res.json(secretos);
    }),
  );

  ruta(
    app,
    'post',
    '/api/equipos',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const datos = validar(esquemaCrear, req.body);
      // `guardian` ya rechazó la petición sin sesión, pero el tipo no lo sabe.
      // Si alguna vez dejara de hacerlo, esto falla aquí y no escribe un
      // movimiento sin autor.
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');
      res.status(201).json({
        equipo: await repoEquipos.crear(datos, { usuarioId, ip: req.ip ?? null }),
      });
    }),
  );

  ruta(
    app,
    'patch',
    '/api/equipos/:id',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);

      // Antes de validar: un campo prohibido tiene que decir por dónde va, no
      // desaparecer en silencio. `.omit()` a secas lo descartaría y la
      // respuesta sería un 200 que no hizo lo que le pidieron — el mismo modo
      // de fallo que tenía `costo` en el POST.
      const cuerpo = (req.body ?? {}) as Record<string, unknown>;
      for (const campo of Object.keys(POR_SU_ENDPOINT)) {
        if (campo in cuerpo) {
          throw new ErrorHttp(409, POR_SU_ENDPOINT[campo], { campo });
        }
      }

      const datos = validar(esquemaActualizar, cuerpo);
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');
      const equipo = await repoEquipos.actualizar(id, datos, {
        usuarioId,
        ip: req.ip ?? null,
      });
      if (!equipo) throw noEncontrado('Equipo');
      res.json({ equipo });
    }),
  );

  /**
   * Cerrar un motivo de la bandeja: alguien lo miró y lo resolvió.
   *
   * Sin esto la bandeja solo se puede LEER, y una bandeja que no se vacía no es
   * una bandeja: es una lista de reproches. Los 177 marcados de la 5e se
   * quedarían ahí para siempre aunque alguien arreglara el dato.
   *
   * Cuando cae el último motivo, la marca baja sola —son el mismo hecho, lo
   * dice el CONSTRAINT TRIGGER de la 0006— y los índices únicos parciales
   * vuelven a mirar esa fila. Si el duplicado que la motivó sigue ahí, Postgres
   * rechaza: la limpieza no se cierra en falso.
   */
  ruta(
    app,
    'delete',
    '/api/equipos/:id/motivos/:codigo',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const codigo = validar(z.enum(CODIGOS as [string, ...string[]]), req.params.codigo);
      // `guardian` ya rechazó la petición sin sesión. Si dejara de hacerlo, esto
      // falla aquí y no escribe una fila de auditoría sin autor.
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');
      try {
        const equipo = await repoEquipos.cerrarMotivo(id, codigo, {
          usuarioId,
          ip: req.ip ?? null,
        });
        if (!equipo) throw noEncontrado('Equipo');
        res.json({ equipo });
      } catch (e) {
        if (e instanceof repoEquipos.MotivoNoPuesto) {
          throw new ErrorHttp(409, `Ese equipo no tiene puesto el motivo "${codigo}".`);
        }
        throw e;
      }
    }),
  );

  /**
   * Quién tiene en la mano un equipo prestado.
   *
   * Ruta propia y no un campo del `PATCH`: `empleado_id` está en
   * `POR_SU_ENDPOINT` desde D19 y tiene que seguir estándolo. Lo que la 0012
   * abrió es un hueco estrecho —`Prestado` es el único estado donde ese campo
   * es libre, y ninguna de las diez operaciones lo escribe: `prestar` mueve el
   * estado y deja el tenedor a NULL— y este endpoint lo cubre sin tocar el
   * resto. El estado no cambia, la empresa prestataria tampoco, y fuera de
   * `Prestado` responde 409 diciendo qué operación toca.
   *
   * Sin él, el `RESPONSABLE_EN_CONFLICTO` de `F5X8494` sería visible y no
   * resoluble: dos nombres en una nota y ninguna forma de elegir.
   */
  ruta(
    app,
    'post',
    '/api/equipos/:id/tenedor',
    'autenticado',
    guardian,
    asincrono(async (req, res) => {
      const id = validar(uuid, req.params.id);
      const { empleado_id } = validar(z.object({ empleado_id: uuid.nullable() }), req.body ?? {});
      const usuarioId = req.usuario?.id;
      if (!usuarioId) throw new ErrorHttp(401, 'Sesión requerida');
      try {
        const equipo = await repoEquipos.fijarTenedor(id, empleado_id, {
          usuarioId,
          ip: req.ip ?? null,
        });
        if (!equipo) throw noEncontrado('Equipo');
        res.json({ equipo });
      } catch (e) {
        if (e instanceof repoEquipos.NoEstaPrestado) {
          throw new ErrorHttp(
            409,
            'Fijar quién lo tiene solo aplica a un equipo prestado. Para uno asignado ' +
              'la operación es POST /api/equipos/:id/asignar.',
            { estado_actual: e.estado_actual },
          );
        }
        throw e;
      }
    }),
  );
}
