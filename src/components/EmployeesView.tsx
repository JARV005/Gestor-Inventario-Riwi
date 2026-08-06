import React, { useCallback, useEffect, useState } from 'react';
import {
  Building,
  ChevronLeft,
  ChevronRight,
  Laptop,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  UserX,
  Users,
} from 'lucide-react';

import type { EmpleadoConConteo, EquipoResumen, Sede } from '../types';
import { ESTADOS_EMPLEADO } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * Los 113 colaboradores reales, desde Postgres.
 *
 * Es la vista que demuestra que la relación se recalcula bien desde el lado de
 * equipos ahora que `assignedDeviceIds[]` no existe (D2): el número de equipos
 * de cada tarjeta lo cuenta el servidor con una subconsulta sobre
 * `equipos.empleado_id`, y la lista completa se pide al desplegar la tarjeta.
 *
 * TODO(5): el alta y el offboarding producen movimientos, y eso es de la etapa
 * 5. Los botones abren el asistente, que todavía no persiste nada.
 */

interface EmployeesViewProps {
  onOpenOnboardingModal: () => void;
  onOpenOffboardingModal: (empleado: EmpleadoConConteo) => void;
}

const iniciales = (nombre: string) =>
  nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();

const colorEstado: Record<string, string> = {
  Activo: 'bg-ok/15 text-ink border border-ok/40',
  Onboarding: 'bg-info/20 text-ink border border-info/50',
  Offboarding: 'bg-warn/20 text-ink border border-warn/50',
  Inactivo: 'bg-surface-alt text-ink-soft border border-line',
};

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  onOpenOnboardingModal,
  onOpenOffboardingModal,
}) => {
  const [q, setQ] = useState('');
  const [sede, setSede] = useState('');
  const [estado, setEstado] = useState('');
  const [soloActivos, setSoloActivos] = useState<'' | 'true' | 'false'>('');
  const [pagina, setPagina] = useState(1);

  const [filas, setFilas] = useState<EmpleadoConConteo[]>([]);
  const [total, setTotal] = useState(0);
  const [sedes, setSedes] = useState<Sede[]>([]);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  /** Equipos de cada empleado, pedidos solo al desplegar su tarjeta. */
  const [desplegado, setDesplegado] = useState<string | null>(null);
  const [equiposDe, setEquiposDe] = useState<
    Record<string, EquipoResumen[] | 'cargando' | 'error'>
  >({});

  const porPagina = 24;

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const datos = await api.empleados({
        q,
        sede,
        activo: soloActivos === '' ? undefined : soloActivos === 'true',
        pagina,
        porPagina,
      });
      setFilas(datos.filas);
      setTotal(datos.total);
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
      setFilas([]);
      setTotal(0);
    } finally {
      setCargando(false);
    }
  }, [q, sede, soloActivos, pagina]);

  useEffect(() => {
    const t = setTimeout(cargar, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, q]);

  useEffect(() => {
    api.sedes().then(
      (d) => setSedes(d.sedes),
      () => setSedes([]),
    );
  }, []);

  useEffect(() => setPagina(1), [q, sede, estado, soloActivos]);

  const desplegar = async (emp: EmpleadoConConteo) => {
    if (desplegado === emp.id) {
      setDesplegado(null);
      return;
    }
    setDesplegado(emp.id);
    if (Array.isArray(equiposDe[emp.id])) return;
    setEquiposDe((p) => ({ ...p, [emp.id]: 'cargando' }));
    try {
      const d = await api.equiposDe(emp.id);
      setEquiposDe((p) => ({ ...p, [emp.id]: d.equipos }));
    } catch {
      setEquiposDe((p) => ({ ...p, [emp.id]: 'error' }));
    }
  };

  const nombreSede = (id: string | null) =>
    id ? (sedes.find((s) => s.id === id)?.nombre ?? '—') : '—';

  const visibles = estado ? filas.filter((e) => e.estado === estado) : filas;
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Users className="w-6 h-6 text-brand" />
            Colaboradores
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            {cargando && filas.length === 0
              ? 'Cargando…'
              : `${total} persona${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargar}
            disabled={cargando}
            className="px-3 py-2 text-sm border border-line rounded-lg text-ink-soft hover:bg-surface-alt disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={onOpenOnboardingModal}
            className="px-3 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Onboarding
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre, cédula o correo…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </div>
        <select
          value={sede}
          onChange={(e) => setSede(e.target.value)}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Todas las sedes</option>
          {sedes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_EMPLEADO.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={soloActivos}
          onChange={(e) => setSoloActivos(e.target.value as '' | 'true' | 'false')}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Activos e inactivos</option>
          <option value="true">Solo activos</option>
          <option value="false">Solo inactivos</option>
        </select>
      </div>

      {error ? (
        <ErrorDeCarga error={error} que="los colaboradores" onReintentar={cargar} />
      ) : cargando && filas.length === 0 ? (
        <Cargando que="los colaboradores" />
      ) : visibles.length === 0 ? (
        <Vacio
          titulo="Ninguna persona coincide"
          detalle="Probar con menos filtros, o limpiarlos todos."
        />
      ) : (
        <>
          <div
            className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${cargando ? 'opacity-60' : ''}`}
          >
            {visibles.map((emp) => {
              const equipos = equiposDe[emp.id];
              const abierto = desplegado === emp.id;
              return (
                <article
                  key={emp.id}
                  className={`bg-surface border border-line rounded-xl p-4 space-y-3 ${
                    emp.activo ? '' : 'bg-surface-alt/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-brand/10 text-brand grid place-items-center font-bold text-sm shrink-0">
                        {iniciales(emp.nombre)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-ink text-sm truncate">{emp.nombre}</h3>
                        <p className="text-xs text-ink-soft truncate">{emp.cargo ?? '—'}</p>
                      </div>
                    </div>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${colorEstado[emp.estado] ?? ''}`}
                    >
                      {emp.estado}
                    </span>
                  </div>

                  {/* Los dos artefactos del Excel que la etapa 3 desactivó desde
                      la API caen aquí, y tienen que verse. */}
                  {!emp.activo && (
                    <p className="text-[11px] text-ink-soft bg-surface-alt border border-line rounded px-2 py-1 flex items-center gap-1.5">
                      <UserX className="w-3.5 h-3.5 shrink-0" />
                      Inactivo: no aparece en asignaciones nuevas
                    </p>
                  )}

                  <dl className="text-xs text-ink-soft space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Building className="w-3.5 h-3.5 shrink-0" />
                      <dd className="truncate">{nombreSede(emp.sede_id)}</dd>
                    </div>
                    {emp.email_corporativo && (
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <dd className="truncate">{emp.email_corporativo}</dd>
                      </div>
                    )}
                    {emp.telefono && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <dd className="truncate">{emp.telefono}</dd>
                      </div>
                    )}
                  </dl>

                  <button
                    onClick={() => desplegar(emp)}
                    className="w-full text-left text-xs border-t border-line pt-2 flex items-center justify-between text-ink hover:text-brand"
                  >
                    <span className="flex items-center gap-1.5">
                      <Laptop className="w-3.5 h-3.5" />
                      Equipos a su nombre
                    </span>
                    <span className="font-semibold tabular-nums">{emp.equipos_asignados}</span>
                  </button>

                  {abierto && (
                    <div className="text-xs space-y-1">
                      {equipos === 'cargando' && <p className="text-ink-soft">Cargando…</p>}
                      {equipos === 'error' && (
                        <p className="text-danger">No se pudieron cargar sus equipos.</p>
                      )}
                      {Array.isArray(equipos) &&
                        (equipos.length === 0 ? (
                          <p className="text-ink-soft">Sin equipos asignados.</p>
                        ) : (
                          equipos.map((eq) => (
                            <div
                              key={eq.id}
                              className="bg-surface-alt border border-line rounded px-2 py-1 flex items-center justify-between gap-2"
                            >
                              <span className="truncate text-ink">
                                {[eq.marca, eq.modelo].filter(Boolean).join(' ') || eq.categoria}
                              </span>
                              <span className="font-mono text-[10px] text-brand shrink-0">
                                {eq.etiqueta ?? eq.serial ?? '—'}
                              </span>
                            </div>
                          ))
                        ))}
                    </div>
                  )}

                  {emp.activo && (
                    <button
                      onClick={() => onOpenOffboardingModal(emp)}
                      className="w-full text-xs text-ink-soft hover:text-ink border border-line rounded-lg py-1.5"
                    >
                      Offboarding
                    </button>
                  )}
                </article>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-ink-soft">
            <span>
              {(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina === 1 || cargando}
                className="p-1.5 border border-line rounded disabled:opacity-40 hover:bg-surface-alt"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 tabular-nums">
                {pagina} / {ultimaPagina}
              </span>
              <button
                onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))}
                disabled={pagina >= ultimaPagina || cargando}
                className="p-1.5 border border-line rounded disabled:opacity-40 hover:bg-surface-alt"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
