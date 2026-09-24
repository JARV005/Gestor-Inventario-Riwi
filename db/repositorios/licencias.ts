/**
 * Inventario de licencias de software (D43, etapa 8b).
 *
 * ============================================================================
 * LA KEY NO SALE DE AQUÍ SALVO POR `descifrarKey`.
 * ============================================================================
 *
 * `key_cifrada` es un secreto del §5, con las mismas reglas que
 * `bios_password`: no aparece en listados, ni en exportaciones, ni en logs. Se
 * lee de una en una, por rol admin, y cada lectura deja su fila en `auditoria`.
 *
 * Por eso `CAMPOS_PUBLICOS` la sustituye por `tiene_key`, un booleano: quien
 * mira la lista necesita saber si la licencia tiene key registrada —una sin ella
 * está a medias— pero no cuál es.
 *
 * No se fusiona con `equipos.licencia_serial_cifrado`, que es otra cosa: aquel
 * es un atributo del portátil y muere con él; esto es un activo con vida propia
 * que se desactiva de un equipo y se activa en otro.
 */
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import { descifrar } from '../cifrado.js';
import { db, type BD, type Ejecutor } from '../cliente.js';
import { equipos, licencias } from '../esquema.js';
import * as repoAuditoria from './auditoria.js';
import type { ContextoEscritura } from './equipos.js';

/**
 * Lo que sale por la API.
 *
 * `key_cifrada` NO está, y en su lugar va `tiene_key`. Enumeradas y nunca
 * `select()` a secas: un `SELECT *` traería la key a memoria y de ahí a la
 * respuesta JSON en cuanto alguien serialice el objeto.
 */
const CAMPOS_PUBLICOS = {
  id: licencias.id,
  tipo: licencias.tipo,
  descripcion: licencias.descripcion,
  equipo_id: licencias.equipo_id,
  equipo_referencia: licencias.equipo_referencia,
  estado: licencias.estado,
  usuario_responsable: licencias.usuario_responsable,
  ubicacion: licencias.ubicacion,
  notas: licencias.notas,
  requiere_revision: licencias.requiere_revision,
  created_at: licencias.created_at,
  /** Si tiene key registrada, no cuál. Una licencia sin key está a medias. */
  tiene_key: sql<boolean>`(licencias.key_cifrada IS NOT NULL)`,
} as const;

export class LicenciaNoEncontrada extends Error {}

export interface FiltrosLicencias {
  estado?: string;
  equipo?: string;
  /** Solo las que no resolvieron su equipo: las 12 de Barranquilla y compañía. */
  sin_equipo?: boolean;
  revision?: boolean;
  q?: string;
  pagina?: number;
  porPagina?: number;
}

export async function listar(f: FiltrosLicencias = {}, bd: BD = db) {
  const cond: SQL[] = [];
  if (f.estado) cond.push(eq(licencias.estado, f.estado as 'Activada'));
  if (f.equipo) cond.push(eq(licencias.equipo_id, f.equipo));
  if (f.revision) cond.push(eq(licencias.requiere_revision, true));
  /**
   * «Sin equipo» es `equipo_id IS NULL` **y** que hubiera algo a lo que apuntar.
   *
   * Una licencia `Disponible` sin equipo no es un problema: es una licencia
   * libre. La que interesa es la que dice apuntar a algo que no se pudo
   * resolver, que es lo que llegará con los ficheros de las otras sedes.
   */
  if (f.sin_equipo) {
    cond.push(isNull(licencias.equipo_id));
    cond.push(sql`licencias.equipo_referencia IS NOT NULL`);
  }
  if (f.q?.trim()) {
    const t = `%${f.q.trim()}%`;
    // La key NO se busca: buscar dentro de un secreto lo expondría por
    // diferencia —quien acierta el prefijo sabe que acertó—.
    const enTexto = or(
      ilike(licencias.descripcion, t),
      ilike(licencias.tipo, t),
      ilike(licencias.equipo_referencia, t),
      ilike(licencias.usuario_responsable, t),
    );
    if (enTexto) cond.push(enTexto);
  }

  const donde = cond.length ? and(...cond) : undefined;
  const pagina = Math.max(1, f.pagina ?? 1);
  const porPagina = Math.min(200, Math.max(1, f.porPagina ?? 50));

  const [filas, [{ total }]] = await Promise.all([
    bd
      .select(CAMPOS_PUBLICOS)
      .from(licencias)
      .where(donde)
      .orderBy(desc(licencias.requiere_revision), asc(licencias.descripcion))
      .limit(porPagina)
      .offset((pagina - 1) * porPagina),
    bd.select({ total: count() }).from(licencias).where(donde),
  ]);

  return { filas, total, pagina, porPagina };
}

export async function porId(id: string, bd: BD = db) {
  const [fila] = await bd.select(CAMPOS_PUBLICOS).from(licencias).where(eq(licencias.id, id));
  return fila ?? null;
}

/**
 * Cuántas hay en cada estado, y cuántas apuntan a un equipo que no existe.
 *
 * El segundo número es el que dice si hace falta pedir los ficheros de otra
 * sede: doce de treinta apuntan hoy a Barranquilla.
 */
export async function resumen(bd: BD = db) {
  const [porEstado, [{ n: sinResolver }], [{ n: total }]] = await Promise.all([
    bd
      .select({ estado: licencias.estado, licencias: count() })
      .from(licencias)
      .groupBy(licencias.estado)
      .orderBy(asc(licencias.estado)),
    bd
      .select({ n: count() })
      .from(licencias)
      .where(and(isNull(licencias.equipo_id), sql`licencias.equipo_referencia IS NOT NULL`)),
    bd.select({ n: count() }).from(licencias),
  ]);
  return { por_estado: porEstado, sin_equipo_resuelto: sinResolver, total };
}

/**
 * La key, en claro y de una en una.
 *
 * **Quien llame a esto tiene que registrar la lectura**, igual que el endpoint
 * de BIOS. No se hace aquí dentro porque el repositorio no conoce la petición
 * —ni la IP ni el usuario— y pasarle medio contexto para que escriba media fila
 * sería peor que dejarlo explícito arriba.
 */
export async function descifrarKey(id: string, bd: BD = db) {
  const [fila] = await bd
    .select({ key: licencias.key_cifrada })
    .from(licencias)
    .where(eq(licencias.id, id));
  if (!fila) return null;
  return { key: descifrar(fila.key as Buffer | null) };
}

/**
 * Activar una licencia en un equipo, o soltarla.
 *
 * Las dos direcciones en la misma función porque son la misma transición vista
 * desde sus dos lados, y separarlas duplicaría la auditoría y la CHECK que hay
 * que respetar: `Activada` exige destino, y cualquier otro estado exige que no
 * lo haya.
 */
export async function activar(
  id: string,
  equipoId: string | null,
  contexto: ContextoEscritura,
  bd: Ejecutor = db,
) {
  return bd.transaction(async (tx) => {
    const [previo] = await tx
      .select({
        equipo_id: licencias.equipo_id,
        estado: licencias.estado,
        referencia: licencias.equipo_referencia,
      })
      .from(licencias)
      .where(eq(licencias.id, id))
      .for('update');
    if (!previo) throw new LicenciaNoEncontrada(id);

    if (equipoId) {
      const [eq_] = await tx
        .select({ id: equipos.id, etiqueta: equipos.etiqueta })
        .from(equipos)
        .where(eq(equipos.id, equipoId));
      if (!eq_) throw new LicenciaNoEncontrada(equipoId);
    }

    const [fila] = await tx
      .update(licencias)
      .set({
        equipo_id: equipoId,
        estado: equipoId ? 'Activada' : 'Disponible',
        // Al activarla contra un equipo de verdad, la referencia del fichero ya
        // no hace falta: su trabajo era decir a qué apuntaba mientras no se
        // pudiera resolver. Se conserva si se suelta, para no perder el rastro.
        equipo_referencia: equipoId ? null : previo.referencia,
        updated_at: new Date(),
      })
      .where(eq(licencias.id, id))
      .returning(CAMPOS_PUBLICOS);

    await repoAuditoria.registrar(
      {
        tabla: 'licencias',
        registro_id: id,
        accion: equipoId ? 'activar_licencia' : 'soltar_licencia',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes: { equipo_id: previo.equipo_id, estado: previo.estado },
        despues: { equipo_id: equipoId, estado: fila.estado },
      },
      tx,
    );

    return fila;
  });
}

/** Cierra la marca de revisión de una licencia. Como en `equipos`. */
export async function cerrarRevision(
  id: string,
  nota: string | null,
  contexto: ContextoEscritura,
  bd: Ejecutor = db,
) {
  return bd.transaction(async (tx) => {
    const [previo] = await tx
      .select({ requiere_revision: licencias.requiere_revision, notas: licencias.notas })
      .from(licencias)
      .where(eq(licencias.id, id))
      .for('update');
    if (!previo) throw new LicenciaNoEncontrada(id);

    const [fila] = await tx
      .update(licencias)
      .set({
        requiere_revision: false,
        // Se acumula, como en el cierre en bloque de equipos: las notas del
        // importador dicen por qué se marcó, y perderlas para dejar constancia
        // de la revisión sería cambiar un dato por otro.
        notas: nota
          ? sql`concat_ws(E'\n', nullif(licencias.notas, ''), ${nota}::text)`
          : previo.notas,
        updated_at: new Date(),
      })
      .where(eq(licencias.id, id))
      .returning(CAMPOS_PUBLICOS);

    await repoAuditoria.registrar(
      {
        tabla: 'licencias',
        registro_id: id,
        accion: 'cerrar_revision_licencia',
        usuario_app_id: contexto.usuarioId,
        ip: contexto.ip,
        antes: { requiere_revision: true },
        despues: { requiere_revision: false, nota_anadida: nota },
      },
      tx,
    );

    return fila;
  });
}
