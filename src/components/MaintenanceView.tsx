import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, RefreshCw, Wrench } from 'lucide-react';

import type { MantenimientoConEquipo } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * Partes de mantenimiento, desde `GET /api/mantenimientos`.
 *
 * **La tabla está vacía**, y eso es exactamente lo que hay que enseñar bien.
 * Es la única vista cuyo fallo interesante no es un error sino el estado
 * vacío: una tabla sin filas que muestra encabezados y nada más es
 * indistinguible de una que falló en silencio.
 *
 * TODO(6): abrir y cerrar partes son escrituras que además tocan el estado del
 * equipo. El endpoint es de solo lectura a propósito.
 */

const colorEstado: Record<string, string> = {
  Pendiente: 'bg-info/20 text-ink border border-info/50',
  'En taller': 'bg-warn/20 text-ink border border-warn/50',
  Completado: 'bg-ok/15 text-ink border border-ok/40',
  Devuelto: 'bg-surface-alt text-ink-muted border border-line',
};

export const MaintenanceView: React.FC = () => {
  const [filas, setFilas] = useState<MantenimientoConEquipo[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const d = await api.mantenimientos({ porPagina: 100 });
      setFilas(d.filas);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
      setFilas([]);
      setTotal(0);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const nombreEquipo = (m: MantenimientoConEquipo) =>
    m.equipo_nombre ??
    m.equipo_etiqueta ??
    ([m.equipo_marca, m.equipo_modelo].filter(Boolean).join(' ') || 'Equipo');

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Wrench className="w-6 h-6 text-brand" />
            Mantenimiento
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {cargando && filas.length === 0
              ? 'Cargando…'
              : `${total} parte${total === 1 ? '' : 's'} registrado${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="px-3 py-2 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface-alt disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </header>

      {error ? (
        <ErrorDeCarga error={error} que="los partes de mantenimiento" onReintentar={cargar} />
      ) : cargando && filas.length === 0 ? (
        <Cargando que="los partes de mantenimiento" />
      ) : filas.length === 0 ? (
        // El estado vacío. Una afirmación, no un hueco: dice que la consulta
        // llegó, que no hubo error, y que la respuesta es "ninguno todavía".
        <Vacio
          titulo="No hay partes de mantenimiento registrados"
          detalle="La consulta funcionó y no devolvió ninguno: todavía no se ha abierto ningún parte. Poder abrirlos llega en la etapa 6."
        />
      ) : (
        <div className="border border-line rounded-xl bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Equipo</th>
                  <th className="text-left font-semibold px-4 py-3">Tipo</th>
                  <th className="text-left font-semibold px-4 py-3">Estado</th>
                  <th className="text-left font-semibold px-4 py-3">Reportado</th>
                  <th className="text-left font-semibold px-4 py-3">Responsable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filas.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-alt">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{nombreEquipo(m)}</div>
                      <div className="text-xs font-mono text-ink-muted">
                        {m.equipo_etiqueta ?? m.equipo_serial ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink">{m.tipo}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${colorEstado[m.estado] ?? ''}`}
                      >
                        {m.estado === 'Completado' ? (
                          <CheckCircle2 className="w-3 h-3 inline mr-1" />
                        ) : (
                          <Clock className="w-3 h-3 inline mr-1" />
                        )}
                        {m.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{m.fecha_reporte.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-ink-muted">{m.responsable ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
