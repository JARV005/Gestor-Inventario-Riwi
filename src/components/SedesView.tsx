import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building2, Laptop, RefreshCw, Truck, Users } from 'lucide-react';

import type { SedeConConteos } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * Sustituye a `LogisticsHubsView` (D1).
 *
 * Los hubs con capacidad, transportadoras y números de guía se fueron con
 * `LogisticsTicket`: no había de dónde sacar esos datos. Queda lo que la base
 * sí sabe, y los conteos los calcula el servidor con subconsultas por sede.
 */

export const SedesView: React.FC = () => {
  const [sedes, setSedes] = useState<SedeConConteos[]>([]);
  const [sinSede, setSinSede] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const d = await api.sedesConConteos();
      setSedes(d.sedes);
      setSinSede(d.equipos_sin_sede);
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
      setSedes([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Building2 className="w-6 h-6 text-brand" />
            Sedes
          </h1>
          <p className="text-sm text-ink-soft mt-1">Equipos y personas por sede.</p>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="px-3 py-2 text-sm border border-line rounded-lg text-ink-soft hover:bg-surface-alt disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </header>

      {error ? (
        <ErrorDeCarga error={error} que="las sedes" onReintentar={cargar} />
      ) : cargando && sedes.length === 0 ? (
        <Cargando que="las sedes" />
      ) : sedes.length === 0 ? (
        <Vacio
          titulo="No hay sedes registradas"
          detalle="Las cinco iniciales las crea `npm run seed`."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sedes.map((sede) => (
              <article key={sede.id} className="bg-surface border border-line rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-ink">{sede.nombre}</h2>
                    {sede.ciudad && <p className="text-xs text-ink-soft">{sede.ciudad}</p>}
                  </div>
                  <span className="text-2xl font-bold text-brand tabular-nums">
                    {sede.equipos_total}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Laptop className="w-4 h-4 text-ink-soft shrink-0" />
                    <dt className="text-ink-soft">Asignados</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.equipos_asignados}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-ink-soft">Disponibles</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.equipos_disponibles}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-ink-soft shrink-0" />
                    <dt className="text-ink-soft">En tránsito</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.equipos_en_transito}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-ink-soft shrink-0" />
                    <dt className="text-ink-soft">Personas</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.empleados_total}
                    </dd>
                  </div>
                  {sede.equipos_por_revisar > 0 && (
                    <div className="flex items-center gap-1.5 col-span-2 pt-1 border-t border-line">
                      <AlertTriangle className="w-4 h-4 text-warn shrink-0" />
                      <dt className="text-ink-soft">Pendientes de revisar</dt>
                      <dd className="font-medium text-ink tabular-nums ml-auto">
                        {sede.equipos_por_revisar}
                      </dd>
                    </div>
                  )}
                </dl>

                {(sede.responsable || sede.contacto_email) && (
                  <footer className="pt-3 border-t border-line text-xs text-ink-soft space-y-0.5">
                    {sede.responsable && <p>{sede.responsable}</p>}
                    {sede.contacto_email && <p>{sede.contacto_email}</p>}
                  </footer>
                )}
              </article>
            ))}
          </div>

          {sinSede > 0 && (
            <div className="bg-warn/10 border border-warn/40 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-ink">
                  {sinSede} equipo{sinSede === 1 ? '' : 's'} sin sede asignada
                </p>
                <p className="text-ink-soft">
                  Vienen del Excel sin ubicación legible, o con una que no corresponde a ninguna
                  sede registrada. Están en la bandeja de revisión.
                </p>
              </div>
            </div>
          )}

          {/* TODO(5): los traslados abiertos son movimientos de tipo 'Traslado'
              con fecha_confirmacion NULL. Ver docs/pendientes.md, etapa 5. */}
        </>
      )}
    </div>
  );
};
