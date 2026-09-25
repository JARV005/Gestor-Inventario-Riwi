import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, KeyRound, Link2, Link2Off, RefreshCw, Search } from 'lucide-react';

import type { EquipoResumen, Licencia, ResumenLicencias } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * El inventario de licencias de software (D43, etapa 8e).
 *
 * ============================================================================
 * NO ES EL MÓDULO SaaS DEL PROTOTIPO.
 * ============================================================================
 *
 * `LicensesMdmView` se retiró en la etapa 0 porque hablaba de asientos,
 * renovaciones, proveedores y costes por puesto: un producto de gestión de
 * suscripciones que esta organización no tiene. Lo que sí tiene son treinta
 * llaves de producto, y la pregunta que se hace de ellas es una sola: **¿dónde
 * está activada esta key?**
 *
 * Por eso la pantalla es un listado con su estado y su equipo, y no un panel de
 * métricas.
 *
 * ---------------------------------------------------------------------------
 * La key no se pinta nunca sin pedirla
 *
 * El listado trae `tiene_key`, un booleano. La clave en claro se pide de una en
 * una, exige rol admin y **deja su fila en `auditoria` antes de responder**. Por
 * eso el botón del ojo hace una petición en vez de revelar algo que ya
 * estuviera en memoria: si estuviera, habría viajado en el listado.
 *
 * Y se oculta al cambiar de página o al recargar: una clave visible en pantalla
 * mientras alguien se levanta del sitio es la misma fuga por otro camino.
 */

const COLOR_ESTADO: Record<string, string> = {
  Activada: 'bg-ok text-ink',
  Disponible: 'bg-brand-subtle text-brand border border-brand/30',
  Vencida: 'bg-warn text-ink',
  Retirada: 'bg-ink-faint text-ink',
};

export const LicensesView: React.FC = () => {
  const [filas, setFilas] = useState<Licencia[]>([]);
  const [resumen, setResumen] = useState<ResumenLicencias | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  const [soloSinEquipo, setSoloSinEquipo] = useState(false);

  /** Las keys reveladas en esta sesión de pantalla. Se vacía al recargar. */
  const [reveladas, setReveladas] = useState<Record<string, string>>({});
  const [revelando, setRevelando] = useState<string | null>(null);

  /** Los equipos, para poder activar una licencia contra uno. */
  const [equipos, setEquipos] = useState<EquipoResumen[]>([]);
  const [activando, setActivando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await api.licencias({
        q: busqueda.trim() || undefined,
        estado: estado || undefined,
        sin_equipo: soloSinEquipo || undefined,
        porPagina: 200,
      });
      setFilas(r.filas);
      setResumen(r.resumen);
      setTotal(r.total);
      // Las keys reveladas se olvidan en cada recarga. Ver la cabecera.
      setReveladas({});
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [busqueda, estado, soloSinEquipo]);

  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  useEffect(() => {
    api.equipos({ porPagina: 200 }).then(
      (r) => setEquipos(r.filas),
      () => setEquipos([]),
    );
  }, []);

  const revelar = async (id: string) => {
    setRevelando(id);
    setErrorAccion(null);
    try {
      const r = await api.keyLicencia(id);
      setReveladas((p) => ({ ...p, [id]: r.key ?? '(sin key registrada)' }));
    } catch (e) {
      setErrorAccion(
        e instanceof ErrorApi ? e.message : 'No se pudo leer la clave.',
      );
    } finally {
      setRevelando(null);
    }
  };

  const cambiarEquipo = async (id: string, equipoId: string | null) => {
    setActivando(id);
    setErrorAccion(null);
    try {
      await api.activarLicencia(id, equipoId);
      await cargar();
    } catch (e) {
      setErrorAccion(e instanceof ErrorApi ? e.message : 'No se pudo mover la licencia.');
    } finally {
      setActivando(null);
    }
  };

  const nombreEquipo = (id: string | null) => {
    if (!id) return null;
    const e = equipos.find((x) => x.id === id);
    if (!e) return 'equipo fuera de la lista';
    return e.etiqueta ?? e.serial ?? [e.marca, e.modelo].filter(Boolean).join(' ') ?? 'equipo';
  };

  if (cargando && filas.length === 0) return <Cargando que="las licencias" />;
  if (error) return <ErrorDeCarga error={error} que="las licencias" onReintentar={cargar} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-brand" />
            Licencias
          </h1>
          <p className="text-sm text-ink-muted">
            {total} licencia{total === 1 ? '' : 's'} de software, con la clave de producto y el
            equipo donde está activada.
          </p>
        </div>
        <button
          onClick={() => void cargar()}
          className="px-3 py-2 text-xs font-semibold rounded-lg border border-line text-ink hover:bg-surface-alt flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      {/* El número que pide los ficheros de otra sede. Va arriba y no en una
          tabla: es el único dato de esta pantalla que obliga a hacer algo fuera
          de ella. */}
      {resumen && resumen.sin_equipo_resuelto > 0 && (
        <button
          onClick={() => setSoloSinEquipo((v) => !v)}
          className={`w-full text-left text-xs rounded-lg px-3 py-2 border flex items-start gap-2 transition-colors ${
            soloSinEquipo
              ? 'bg-warn/25 border-warn'
              : 'bg-warn/10 border-warn/40 hover:bg-warn/20'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
          <span className="text-ink">
            <strong>{resumen.sin_equipo_resuelto} licencias apuntan a un equipo que no está en
            la base.</strong>{' '}
            Casi todas van a equipos de Barranquilla: se resolverán solas cuando se importe el
            inventario de esa sede. {soloSinEquipo ? 'Viendo solo esas.' : 'Pulsa para verlas.'}
          </span>
        </button>
      )}

      {/* Los estados, como bloques. Mismo patrón que la bandeja de revisión. */}
      {resumen && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setEstado('')}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              estado === ''
                ? 'bg-brand text-white border-brand'
                : 'border-line text-ink-muted hover:bg-surface-alt'
            }`}
          >
            Todas
            <span className="ml-1.5 font-semibold tabular-nums">{resumen.total}</span>
          </button>
          {resumen.por_estado.map((e) => (
            <button
              key={e.estado}
              onClick={() => setEstado(estado === e.estado ? '' : e.estado)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                estado === e.estado
                  ? 'bg-brand text-white border-brand'
                  : 'border-line text-ink-muted hover:bg-surface-alt'
              }`}
            >
              {e.estado}
              <span className="ml-1.5 font-semibold tabular-nums">{e.licencias}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Descripción, tipo, equipo o responsable…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
        />
      </div>

      {errorAccion && (
        <p
          role="alert"
          className="text-xs text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2"
        >
          {errorAccion}
        </p>
      )}

      {filas.length === 0 ? (
        <Vacio titulo="Ninguna licencia cuadra con el filtro" detalle="Prueba a quitar la búsqueda o el estado." />
      ) : (
        <div className="space-y-2">
          {filas.map((l) => (
            <div
              key={l.id}
              className={`bg-surface border rounded-xl p-4 space-y-3 ${
                l.requiere_revision ? 'border-warn/50' : 'border-line'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink">{l.descripcion}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        COLOR_ESTADO[l.estado] ?? 'bg-ink-faint text-ink'
                      }`}
                    >
                      {l.estado}
                    </span>
                    {l.requiere_revision && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-warn text-ink font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Revisar
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {l.tipo}
                    {l.usuario_responsable ? ` · ${l.usuario_responsable}` : ''}
                    {l.ubicacion ? ` · ${l.ubicacion}` : ''}
                  </p>
                </div>

                {/* La clave. Pedirla es una acción con rastro, así que es un
                    botón y no un campo que ya tuviera el valor. */}
                <div className="shrink-0">
                  {!l.tiene_key ? (
                    <span className="text-xs text-ink-muted italic">sin clave registrada</span>
                  ) : reveladas[l.id] ? (
                    <code className="text-xs font-mono bg-surface-alt border border-line rounded px-2 py-1 select-all">
                      {reveladas[l.id]}
                    </code>
                  ) : (
                    <button
                      onClick={() => void revelar(l.id)}
                      disabled={revelando === l.id}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:bg-surface-alt flex items-center gap-1.5 disabled:opacity-50"
                      title="Solo admin. La lectura queda registrada."
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {revelando === l.id ? 'Leyendo…' : 'Ver clave'}
                    </button>
                  )}
                </div>
              </div>

              {/* Dónde está activada, y cómo moverla. */}
              <div className="flex items-center gap-2 flex-wrap text-xs border-t border-line pt-3">
                {l.equipo_id ? (
                  <>
                    <span className="text-ink flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-ok" />
                      Activada en <strong>{nombreEquipo(l.equipo_id)}</strong>
                    </span>
                    <button
                      onClick={() => void cambiarEquipo(l.id, null)}
                      disabled={activando === l.id}
                      className="px-2 py-1 rounded border border-line text-ink-muted hover:text-ink hover:bg-surface-alt flex items-center gap-1 disabled:opacity-50"
                    >
                      <Link2Off className="w-3 h-3" />
                      Soltar
                    </button>
                  </>
                ) : (
                  <>
                    {l.equipo_referencia ? (
                      <span className="text-ink flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-warn" />
                        El archivo decía <code className="font-mono">{l.equipo_referencia}</code>,
                        que no está en la base
                      </span>
                    ) : (
                      <span className="text-ink-muted">Sin activar</span>
                    )}
                    <select
                      defaultValue=""
                      onChange={(e) => e.target.value && void cambiarEquipo(l.id, e.target.value)}
                      disabled={activando === l.id}
                      className="px-2 py-1 border border-line rounded bg-surface text-ink focus:outline-none focus:border-brand"
                    >
                      <option value="">Activar en un equipo…</option>
                      {equipos.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.etiqueta ?? e.serial ?? e.id.slice(0, 8)} ·{' '}
                          {[e.marca, e.modelo].filter(Boolean).join(' ')}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {l.notas && <p className="text-[11px] text-ink-muted">{l.notas}</p>}

              {l.requiere_revision && (
                <button
                  onClick={() => void api.licenciaRevisada(l.id, null).then(() => cargar())}
                  className="text-xs underline text-brand font-semibold"
                >
                  Marcar como revisada
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
