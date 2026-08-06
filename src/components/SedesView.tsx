import React from 'react';
import { Building2, Laptop, Truck, AlertTriangle } from 'lucide-react';

import type { Equipo, Sede } from '../types';

/**
 * Sustituye a `LogisticsHubsView` (D1).
 *
 * Los hubs con capacidad, transportadoras y números de guía desaparecieron con
 * `LogisticsTicket`: no había de dónde sacar esos datos. Lo que queda es lo que
 * la base sí sabe — cuántos equipos hay en cada sede y en qué estado— más los
 * traslados abiertos, que son movimientos y llegan en la etapa 5.
 *
 * TODO(4b): sin conectar. Lee las sedes y los equipos que le pasa `App` desde
 * `mockData`. Conectar contra `GET /api/sedes` y `GET /api/equipos?sede=`.
 */

interface SedesViewProps {
  sedes: Sede[];
  equipos: Equipo[];
}

export const SedesView: React.FC<SedesViewProps> = ({ sedes, equipos }) => {
  const porSede = (sedeId: string) => equipos.filter((e) => e.sede_id === sedeId);
  const sinSede = equipos.filter((e) => e.sede_id === null);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Building2 className="w-6 h-6 text-brand" />
            Sedes
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            Equipos por sede y traslados en curso.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sedes.map((sede) => {
          const equiposSede = porSede(sede.id);
          const asignados = equiposSede.filter((e) => e.estado === 'Asignado').length;
          const disponibles = equiposSede.filter((e) => e.estado === 'Disponible').length;
          const enTransito = equiposSede.filter((e) => e.estado === 'En tránsito').length;
          const marcados = equiposSede.filter((e) => e.requiere_revision).length;

          return (
            <article
              key={sede.id}
              className="bg-surface border border-line rounded-xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-ink">{sede.nombre}</h2>
                  {sede.ciudad && <p className="text-xs text-ink-soft">{sede.ciudad}</p>}
                </div>
                <span className="text-2xl font-bold text-brand tabular-nums">
                  {equiposSede.length}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-ink-soft" />
                  <dt className="text-ink-soft">Asignados</dt>
                  <dd className="font-medium text-ink tabular-nums ml-auto">{asignados}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-ink-soft">Disponibles</dt>
                  <dd className="font-medium text-ink tabular-nums ml-auto">{disponibles}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-ink-soft" />
                  <dt className="text-ink-soft">En tránsito</dt>
                  <dd className="font-medium text-ink tabular-nums ml-auto">{enTransito}</dd>
                </div>
                {marcados > 0 && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-warn" />
                    <dt className="text-ink-soft">Por revisar</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">{marcados}</dd>
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
          );
        })}
      </div>

      {sinSede.length > 0 && (
        <div className="bg-warn/10 border border-warn/40 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-ink">
              {sinSede.length} equipo{sinSede.length === 1 ? '' : 's'} sin sede asignada
            </p>
            <p className="text-ink-soft">
              Vienen del Excel sin ubicación legible, o con una que no corresponde a ninguna
              sede registrada. Están en la bandeja de revisión.
            </p>
          </div>
        </div>
      )}

      {/* TODO(5): los traslados abiertos son movimientos de tipo 'Traslado' con
          fecha_confirmacion NULL. No hay endpoint todavía; llega con la etapa 5. */}
    </div>
  );
};
