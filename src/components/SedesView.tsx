import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  Laptop,
  PackageCheck,
  RefreshCw,
  Truck,
  Users,
} from 'lucide-react';

import type { SedeConConteos, TrasladoAbierto } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * Sustituye a `LogisticsHubsView` (D1).
 *
 * Los hubs con capacidad, transportadoras y números de guía se fueron con
 * `LogisticsTicket`: no había de dónde sacar esos datos. Queda lo que la base
 * sí sabe, y los conteos los calcula el servidor con subconsultas por sede.
 *
 * La lista de traslados en curso vuelve en la etapa 5, ahora con datos reales:
 * un traslado abierto es una fila de `movimientos` con `fecha_confirmacion
 * IS NULL`, y confirmarlo mueve el equipo. Es la única funcionalidad visible
 * que se había perdido en la 4a.
 */

interface SedesViewProps {
  /**
   * Confirmar un traslado cambia un número que se pinta FUERA de esta vista:
   * el badge del sidebar. Sin avisar hacia arriba, el badge seguiría diciendo
   * «3 en tránsito» con la lista ya vacía.
   */
  onTrasladoConfirmado?: () => void;
}

export const SedesView: React.FC<SedesViewProps> = ({ onTrasladoConfirmado }) => {
  const [sedes, setSedes] = useState<SedeConConteos[]>([]);
  const [sinSede, setSinSede] = useState(0);
  const [traslados, setTraslados] = useState<TrasladoAbierto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  /** El id del traslado que se está confirmando, y el fallo si lo hubo. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [errorConfirmar, setErrorConfirmar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      // Las dos a la vez: los conteos por sede y los traslados abiertos salen
      // de la misma condición y tienen que verse en el mismo instante. En
      // serie, una recarga lenta enseñaría una lista de una consulta y unos
      // conteos de la otra.
      const [d, t] = await Promise.all([api.sedesConConteos(), api.trasladosAbiertos()]);
      setSedes(d.sedes);
      setSinSede(d.equipos_sin_sede);
      setTraslados(t.traslados);
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
      setSedes([]);
      setTraslados([]);
    } finally {
      setCargando(false);
    }
  }, []);

  const confirmar = useCallback(
    async (traslado: TrasladoAbierto) => {
      setConfirmando(traslado.id);
      setErrorConfirmar(null);
      try {
        await api.confirmarTraslado(traslado.id);
        await cargar();
        onTrasladoConfirmado?.();
      } catch (e) {
        // El 409 más probable es «ya estaba confirmado»: alguien lo hizo desde
        // otra pantalla. Se recarga igualmente, porque lo que se está viendo ya
        // no es cierto.
        setErrorConfirmar(e instanceof ErrorApi ? e.message : 'No se pudo confirmar el traslado.');
        if (e instanceof ErrorApi && e.estado === 409) await cargar();
      } finally {
        setConfirmando(null);
      }
    },
    [cargar, onTrasladoConfirmado],
  );

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
          <p className="text-sm text-ink-muted mt-1">Equipos y personas por sede.</p>
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
                    {sede.ciudad && <p className="text-xs text-ink-muted">{sede.ciudad}</p>}
                  </div>
                  <span className="text-2xl font-bold text-brand tabular-nums">
                    {sede.equipos_total}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Laptop className="w-4 h-4 text-ink-muted shrink-0" />
                    <dt className="text-ink-muted">Asignados</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.equipos_asignados}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-ink-muted">Disponibles</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.equipos_disponibles}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-ink-muted shrink-0" />
                    <dt className="text-ink-muted">En tránsito</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.equipos_en_transito}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-ink-muted shrink-0" />
                    <dt className="text-ink-muted">Personas</dt>
                    <dd className="font-medium text-ink tabular-nums ml-auto">
                      {sede.empleados_total}
                    </dd>
                  </div>
                  {sede.equipos_por_revisar > 0 && (
                    <div className="flex items-center gap-1.5 col-span-2 pt-1 border-t border-line">
                      <AlertTriangle className="w-4 h-4 text-warn shrink-0" />
                      <dt className="text-ink-muted">Pendientes de revisar</dt>
                      <dd className="font-medium text-ink tabular-nums ml-auto">
                        {sede.equipos_por_revisar}
                      </dd>
                    </div>
                  )}
                </dl>

                {(sede.responsable || sede.contacto_email) && (
                  <footer className="pt-3 border-t border-line text-xs text-ink-muted space-y-0.5">
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
                <p className="text-ink-muted">
                  Vienen del Excel sin ubicación legible, o con una que no corresponde a ninguna
                  sede registrada. Están en la bandeja de revisión.
                </p>
              </div>
            </div>
          )}

          <section className="space-y-3">
            <header className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-brand" />
              <h2 className="font-semibold text-ink">Traslados en curso</h2>
              <span className="text-xs text-ink-muted tabular-nums">
                {traslados.length === 0
                  ? 'ninguno'
                  : `${traslados.length} equipo${traslados.length === 1 ? '' : 's'}`}
              </span>
            </header>

            {errorConfirmar && (
              <p
                role="alert"
                className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2"
              >
                {errorConfirmar}
              </p>
            )}

            {traslados.length === 0 ? (
              <p className="text-sm text-ink-muted border border-dashed border-line rounded-xl p-4">
                Ningún equipo está viajando. Un traslado se abre desde el equipo y se cierra
                aquí, cuando llega.
              </p>
            ) : (
              <ul className="space-y-2">
                {traslados.map((t) => (
                  <li
                    key={t.id}
                    className="bg-surface border border-line rounded-xl p-4 flex items-start justify-between gap-4 flex-wrap"
                  >
                    <div className="space-y-1 min-w-0">
                      <p className="font-medium text-ink flex items-center gap-2 flex-wrap">
                        <span>{t.etiqueta ?? t.categoria}</span>
                        <span className="text-ink-muted font-normal text-sm truncate">
                          {[t.marca, t.modelo].filter(Boolean).join(' ')}
                        </span>
                      </p>
                      <p className="text-sm text-ink-muted flex items-center gap-1.5 flex-wrap">
                        <span>{t.sede_origen ?? 'sin sede'}</span>
                        <span aria-hidden="true">→</span>
                        <span className="text-ink font-medium">{t.sede_destino}</span>
                        {/* El equipo no cambia de dueño por viajar (D13): si va
                            a nombre de alguien, se dice. */}
                        {t.responsable && <span>· a nombre de {t.responsable}</span>}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {t.transportadora ?? 'Sin transportadora'}
                        {t.guia && ` · guía ${t.guia}`}
                        {t.fecha_estimada && ` · llegada prevista ${t.fecha_estimada}`}
                        {' · '}
                        {t.dias_en_transito === 0
                          ? 'salió hoy'
                          : `${t.dias_en_transito} día${t.dias_en_transito === 1 ? '' : 's'} en tránsito`}
                      </p>
                    </div>

                    <button
                      onClick={() => void confirmar(t)}
                      disabled={confirmando !== null}
                      className="px-3 py-2 text-sm rounded-lg bg-brand text-white font-medium hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                    >
                      {confirmando === t.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      Confirmar llegada
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-ink-muted flex items-start gap-1.5">
              <PackageCheck className="w-4 h-4 shrink-0 mt-px" />
              Confirmar mueve el equipo a la sede destino y cierra el movimiento. No se puede
              deshacer: el historial no se reescribe.
            </p>
          </section>
        </>
      )}

    </div>
  );
};
