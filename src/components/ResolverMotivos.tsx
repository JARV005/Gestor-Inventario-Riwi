import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';

import type { EmpleadoConConteo, EquipoConMotivos, Empresa } from '../types';
import { EMPRESAS, MOTIVOS } from '../types';
import { api, ErrorApi } from '../lib/api';

/**
 * La bandeja de revisión, del lado en que se vacía.
 *
 * ============================================================================
 * UNA BANDEJA QUE SOLO SE LEE NO ES UNA BANDEJA.
 * ============================================================================
 *
 * Hasta la 5e, los motivos se veían y no se podían cerrar: la importación
 * marcaba 177 filas de 305 y la única forma de sacarlas era un `DELETE` a mano
 * contra la base — justo lo que cerrar el `PATCH` de estado (D19) pretendía
 * impedir. Un listado de problemas sin forma de resolverlos es una lista de
 * reproches, y a los dos meses nadie la abre.
 *
 * Cada motivo se cierra por separado, y **cerrar el último baja la marca**: son
 * el mismo hecho, lo dice el CONSTRAINT TRIGGER de la 0006. Eso reactiva los
 * índices únicos parciales de `serial` y `etiqueta` sobre esa fila, así que si
 * el duplicado que la marcó sigue ahí, Postgres rechaza el cierre. Es
 * deliberado y viene de la etapa 2: la limpieza no se puede cerrar en falso, y
 * el 409 que llega se enseña tal cual.
 *
 * Dos motivos traen además la herramienta con la que se arreglan, porque
 * cerrarlos sin arreglar el dato sería taparlos:
 *
 *   - `PROPIEDAD_AMBIGUA` → decidir de qué empresa es.
 *   - `RESPONSABLE_EN_CONFLICTO` → decidir quién lo tiene en la mano.
 *
 * Los dos nombres en conflicto están en las notas del equipo, que se pintan
 * justo encima: la herramienta no los repite, porque la nota es el dato de
 * origen y esto es la decisión.
 */

interface ResolverMotivosProps {
  equipo: EquipoConMotivos;
  onCambiado: (equipo: EquipoConMotivos) => void;
}

export const ResolverMotivos: React.FC<ResolverMotivosProps> = ({ equipo, onCambiado }) => {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [empresa, setEmpresa] = useState<Empresa>(equipo.empresa);
  const [tenedor, setTenedor] = useState('');
  const [empleados, setEmpleados] = useState<EmpleadoConConteo[]>([]);

  const hayConflicto = equipo.motivos_revision.includes('RESPONSABLE_EN_CONFLICTO');
  const hayAmbiguedad = equipo.motivos_revision.includes('PROPIEDAD_AMBIGUA');

  // Los colaboradores solo se piden si hacen falta: en la mayoría de las fichas
  // de la bandeja no hay ningún conflicto de responsable que resolver.
  useEffect(() => {
    if (!hayConflicto) return;
    let vigente = true;
    api.empleados({ porPagina: 300, activo: true }).then(
      (d) => vigente && setEmpleados(d.filas),
      () => vigente && setEmpleados([]),
    );
    return () => {
      vigente = false;
    };
  }, [hayConflicto]);

  useEffect(() => {
    setEmpresa(equipo.empresa);
    setTenedor(equipo.empleado_id ?? '');
    setError(null);
  }, [equipo.id, equipo.empresa, equipo.empleado_id]);

  const hacer = async (clave: string, accion: () => Promise<{ equipo: EquipoConMotivos }>) => {
    setOcupado(clave);
    setError(null);
    try {
      const r = await accion();
      onCambiado(r.equipo);
    } catch (e) {
      // El 409 del servidor ya dice por qué no se puede —«el serial sigue
      // duplicado», «eso va por otra ruta»—. Se enseña tal cual.
      setError(e instanceof ErrorApi ? e.message : 'No se pudo completar.');
    } finally {
      setOcupado(null);
    }
  };

  if (equipo.motivos_revision.length === 0) return null;

  return (
    <div className="bg-warn/10 border border-warn/40 rounded-lg p-3 space-y-3">
      <p className="text-sm font-medium text-ink flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 text-warn" />
        Pendiente de revisión
        <span className="text-xs font-normal text-ink-muted">
          ({equipo.motivos_revision.length}{' '}
          {equipo.motivos_revision.length === 1 ? 'motivo' : 'motivos'})
        </span>
      </p>

      {hayAmbiguedad && (
        <div className="bg-surface border border-line rounded-lg p-2.5 space-y-2">
          <label className="block text-xs font-medium text-ink">
            ¿De qué empresa es este equipo?
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value as Empresa)}
              className="px-3 py-1.5 text-sm border border-line rounded-lg bg-surface text-ink"
            >
              {EMPRESAS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                void hacer('empresa', () => api.actualizarEquipo(equipo.id, { empresa }))
              }
              disabled={ocupado !== null || empresa === equipo.empresa}
              className="px-3 py-1.5 text-sm border border-line rounded-lg text-ink hover:bg-surface-alt disabled:opacity-50"
            >
              {ocupado === 'empresa' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar'}
            </button>
          </div>
          <p className="text-[11px] text-ink-muted">
            Guardar la empresa no cierra el motivo: eso se hace abajo, cuando la decisión ya está
            tomada.
          </p>
        </div>
      )}

      {hayConflicto && (
        <div className="bg-surface border border-line rounded-lg p-2.5 space-y-2">
          <label className="block text-xs font-medium text-ink">
            ¿Quién tiene este equipo en la mano?
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={tenedor}
              onChange={(e) => setTenedor(e.target.value)}
              className="px-3 py-1.5 text-sm border border-line rounded-lg bg-surface text-ink max-w-full"
            >
              <option value="">— nadie / sin decidir —</option>
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre} · {e.empresa}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                void hacer('tenedor', () => api.fijarTenedor(equipo.id, tenedor || null))
              }
              disabled={ocupado !== null || tenedor === (equipo.empleado_id ?? '')}
              className="px-3 py-1.5 text-sm border border-line rounded-lg text-ink hover:bg-surface-alt disabled:opacity-50"
            >
              {ocupado === 'tenedor' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar'}
            </button>
          </div>
          <p className="text-[11px] text-ink-muted">
            Los dos nombres que dan los archivos están en las notas, arriba. Esto solo vale para un
            equipo prestado; si estuviera asignado, la operación sería «Asignar a alguien».
          </p>
        </div>
      )}

      <ul className="space-y-1.5">
        {equipo.motivos_revision.map((m) => (
          <li
            key={m}
            className="text-xs text-ink-muted flex items-start justify-between gap-3 border-t border-warn/30 pt-1.5 first:border-0 first:pt-0"
          >
            <span className="min-w-0">
              <span className="font-mono text-ink">{m}</span>
              {' — '}
              {MOTIVOS[m as keyof typeof MOTIVOS]?.descripcion ?? 'sin descripción'}
              <span className="block text-ink-muted/80 mt-0.5">
                {MOTIVOS[m as keyof typeof MOTIVOS]?.recomendacion}
              </span>
            </span>
            <button
              onClick={() => void hacer(m, () => api.cerrarMotivo(equipo.id, m))}
              disabled={ocupado !== null}
              title="Cerrar este motivo: alguien lo miró y ya está resuelto"
              className="shrink-0 px-2 py-1 text-[11px] border border-line rounded-lg bg-surface text-ink hover:bg-surface-alt disabled:opacity-50 flex items-center gap-1"
            >
              {ocupado === m ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              Resuelto
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p
          role="alert"
          className="text-xs text-danger bg-danger/10 border border-danger/40 rounded-lg px-2 py-1.5"
        >
          {error}
        </p>
      )}
    </div>
  );
};
