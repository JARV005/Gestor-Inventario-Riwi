/**
 * Acceso a `equipos`.
 *
 * ============================================================================
 * NUNCA `SELECT *` EN ESTE FICHERO. LAS COLUMNAS SE ENUMERAN SIEMPRE.
 * ============================================================================
 *
 * `equipos` tiene dos columnas que no pueden salir en ningún listado, ni
 * siquiera para un admin: `bios_password_cifrado` y `licencia_serial_cifrado`
 * (§5.2). Solo se leen de una en una, por `GET /api/equipos/:id/bios`, con rol
 * admin y dejando fila en `auditoria`.
 *
 * En Drizzle, `.select()` sin argumentos es literalmente `SELECT *`. Basta con
 * que alguien lo escriba una vez —o añada un endpoint copiando otro— para que
 * los dos campos aparezcan en todas las respuestas de ese endpoint. No haría
 * ruido: el listado seguiría funcionando y nadie mira los campos que no usa.
 *
 * Por eso las consultas de aquí parten de `CAMPOS_PUBLICOS`, que es una lista
 * cerrada, y por eso hay un test que lee este directorio y falla si encuentra
 * un `.select()` sin argumentos. El comentario avisa; el test es lo que impide.
 */

import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import { db, type BD } from '../cliente.js';
import { descifrar } from '../cifrado.js';
import { equipos, equiposMotivosRevision, movimientos } from '../esquema.js';

/**
 * Lo que puede salir de la API. Sin los dos campos cifrados: no están
 * comentados ni excluidos después, sencillamente no se piden.
 */
const CAMPOS_PUBLICOS = {
  id: equipos.id,
  categoria: equipos.categoria,
  etiqueta: equipos.etiqueta,
  nombre_equipo: equipos.nombre_equipo,
  marca: equipos.marca,
  modelo: equipos.modelo,
  serial: equipos.serial,
  serial_cargador: equipos.serial_cargador,
  propiedad: equipos.propiedad,
  sistema_operativo: equipos.sistema_operativo,
  licencia_tipo: equipos.licencia_tipo,
  tamano_pantalla: equipos.tamano_pantalla,
  procesador: equipos.procesador,
  disco: equipos.disco,
  ram: equipos.ram,
  estado: equipos.estado,
  condicion: equipos.condicion,
  sede_id: equipos.sede_id,
  empleado_id: equipos.empleado_id,
  empleado_mencionado_id: equipos.empleado_mencionado_id,
  importacion_id: equipos.importacion_id,
  sesion_usuario: equipos.sesion_usuario,
  fecha_compra: equipos.fecha_compra,
  garantia_vence: equipos.garantia_vence,
  costo: equipos.costo,
  notas: equipos.notas,
  requiere_revision: equipos.requiere_revision,
  created_at: equipos.created_at,
  updated_at: equipos.updated_at,
} as const;

export interface FiltrosEquipos {
  estado?: string;
  sede?: string;
  categoria?: string;
  q?: string;
  revision?: boolean;
  /** Código de `motivos_revision`. Es para lo que existe la tabla puente. */
  motivo?: string;
  pagina?: number;
  porPagina?: number;
}

export async function listar(f: FiltrosEquipos = {}, bd: BD = db) {
  const condiciones: SQL[] = [];
  if (f.estado) condiciones.push(eq(equipos.estado, f.estado as never));
  if (f.sede) condiciones.push(eq(equipos.sede_id, f.sede));
  if (f.categoria) condiciones.push(eq(equipos.categoria, f.categoria as never));
  if (f.revision !== undefined) condiciones.push(eq(equipos.requiere_revision, f.revision));
  if (f.motivo) {
    // EXISTS y no JOIN: un equipo con tres motivos aparecería tres veces, y el
    // total de la paginación contaría filas en vez de equipos.
    condiciones.push(
      sql`EXISTS (SELECT 1 FROM ${equiposMotivosRevision} m
                   WHERE m.equipo_id = ${equipos.id} AND m.motivo_codigo = ${f.motivo})`,
    );
  }
  if (f.q) {
    const patron = `%${f.q}%`;
    const busqueda = or(
      ilike(equipos.etiqueta, patron),
      ilike(equipos.serial, patron),
      ilike(equipos.nombre_equipo, patron),
      ilike(equipos.marca, patron),
      ilike(equipos.modelo, patron),
    );
    if (busqueda) condiciones.push(busqueda);
  }
  const donde = condiciones.length ? and(...condiciones) : undefined;

  const porPagina = Math.min(Math.max(f.porPagina ?? 50, 1), 200);
  const pagina = Math.max(f.pagina ?? 1, 1);

  const filas = await bd
    .select(CAMPOS_PUBLICOS)
    .from(equipos)
    .where(donde)
    .orderBy(equipos.etiqueta, equipos.id)
    .limit(porPagina)
    .offset((pagina - 1) * porPagina);

  const [{ total }] = await bd
    .select({ total: sql<number>`count(*)::int` })
    .from(equipos)
    .where(donde);

  // Los motivos, en una segunda consulta y no con un JOIN, por lo mismo que
  // arriba: el JOIN multiplicaría las filas de los equipos con varios motivos.
  const ids = filas.map((f) => f.id);
  const porEquipo = new Map<string, string[]>();
  if (ids.length > 0) {
    const motivos = await bd
      .select({
        equipo_id: equiposMotivosRevision.equipo_id,
        codigo: equiposMotivosRevision.motivo_codigo,
      })
      .from(equiposMotivosRevision)
      .where(inArray(equiposMotivosRevision.equipo_id, ids));
    for (const m of motivos) {
      const lista = porEquipo.get(m.equipo_id) ?? [];
      lista.push(m.codigo);
      porEquipo.set(m.equipo_id, lista);
    }
  }

  return {
    filas: filas.map((f) => ({ ...f, motivos_revision: porEquipo.get(f.id) ?? [] })),
    total,
    pagina,
    porPagina,
  };
}

/** Cuántos equipos hay por cada código. Alimenta la bandeja de revisión. */
export async function conteoPorMotivo(bd: BD = db) {
  return bd
    .select({
      codigo: equiposMotivosRevision.motivo_codigo,
      equipos: sql<number>`count(*)::int`,
    })
    .from(equiposMotivosRevision)
    .groupBy(equiposMotivosRevision.motivo_codigo)
    .orderBy(sql`count(*) DESC`, equiposMotivosRevision.motivo_codigo);
}

export async function porId(id: string, bd: BD = db) {
  const [fila] = await bd.select(CAMPOS_PUBLICOS).from(equipos).where(eq(equipos.id, id));
  if (!fila) return null;
  const motivos = await bd
    .select({ codigo: equiposMotivosRevision.motivo_codigo })
    .from(equiposMotivosRevision)
    .where(eq(equiposMotivosRevision.equipo_id, id));
  return { ...fila, motivos_revision: motivos.map((m) => m.codigo) };
}

export async function crear(datos: typeof equipos.$inferInsert, bd: BD = db) {
  const [fila] = await bd.insert(equipos).values(datos).returning(CAMPOS_PUBLICOS);
  return fila;
}

export async function actualizar(
  id: string,
  datos: Partial<typeof equipos.$inferInsert>,
  bd: BD = db,
) {
  const [fila] = await bd
    .update(equipos)
    .set(datos)
    .where(eq(equipos.id, id))
    .returning(CAMPOS_PUBLICOS);
  return fila ?? null;
}

/**
 * El único punto del sistema que lee los campos cifrados. Quien llama es
 * responsable de haber comprobado el rol y de dejar la fila en `auditoria`.
 */
export async function descifrarSecretos(id: string, bd: BD = db) {
  const [fila] = await bd
    .select({
      bios: equipos.bios_password_cifrado,
      licencia: equipos.licencia_serial_cifrado,
    })
    .from(equipos)
    .where(eq(equipos.id, id));
  if (!fila) return null;
  return {
    bios_password: descifrar(fila.bios as Buffer | null),
    licencia_serial: descifrar(fila.licencia as Buffer | null),
  };
}

export async function historial(id: string, bd: BD = db) {
  return bd
    .select({
      id: movimientos.id,
      tipo: movimientos.tipo,
      fecha: movimientos.fecha,
      empleado_origen_id: movimientos.empleado_origen_id,
      empleado_destino_id: movimientos.empleado_destino_id,
      sede_origen_id: movimientos.sede_origen_id,
      sede_destino_id: movimientos.sede_destino_id,
      usuario_app_id: movimientos.usuario_app_id,
      observaciones: movimientos.observaciones,
      fecha_confirmacion: movimientos.fecha_confirmacion,
    })
    .from(movimientos)
    .where(eq(movimientos.equipo_id, id))
    .orderBy(desc(movimientos.fecha));
}
