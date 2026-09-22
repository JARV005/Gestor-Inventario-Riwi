import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Wrench,
  X,
} from 'lucide-react';

import type {
  CatalogoTransiciones,
  EquipoConMotivos,
  EstadoParteAbierto,
  MantenimientoConEquipo,
} from '../types';
import { ESTADOS_PARTE_ABIERTO } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * Partes de mantenimiento. Etapa 5d: la vista deja de ser de solo lectura.
 *
 * Las dos escrituras que importan **mueven el equipo**, y por eso viven aquí y
 * no en los botones del detalle del equipo (D29):
 *
 *   - abrir un parte  = `Envío a mantenimiento`, el equipo entra al taller
 *   - cerrar un parte = `Retorno de mantenimiento` o `Baja`, el equipo sale
 *
 * Las dos van en una sola transacción del lado del servidor. Si el equipo no se
 * deja mover, el parte no se abre — nunca queda un parte abierto sobre un
 * equipo que sigue en manos de alguien.
 *
 * **Qué equipos pueden ir al taller no se decide aquí.** Sale de
 * `catalogo.operaciones[enviar_mantenimiento].desde`, que es la misma tabla que
 * decide el 409. Una lista de estados escrita en este fichero sería una segunda
 * tabla de transiciones, que es contra lo que avisa `AccionesEquipo`.
 */

const colorEstado: Record<string, string> = {
  Pendiente: 'bg-info/20 text-ink border border-info/50',
  'En taller': 'bg-warn/20 text-ink border border-warn/50',
  Completado: 'bg-ok/15 text-ink border border-ok/40',
  Devuelto: 'bg-surface-alt text-ink-muted border border-line',
  'Baja tras revisión': 'bg-danger/10 text-danger border border-danger/40',
};

const CERRADOS = ['Devuelto', 'Baja tras revisión'];
const esAbierto = (estado: string) => !CERRADOS.includes(estado);

const nombreDe = (m: MantenimientoConEquipo) =>
  m.equipo_nombre ??
  m.equipo_etiqueta ??
  ([m.equipo_marca, m.equipo_modelo].filter(Boolean).join(' ') || 'Equipo');

const nombreEquipo = (e: EquipoConMotivos) =>
  e.nombre_equipo ?? e.etiqueta ?? ([e.marca, e.modelo].filter(Boolean).join(' ') || e.categoria);

export const MaintenanceView: React.FC = () => {
  const [filas, setFilas] = useState<MantenimientoConEquipo[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  const [catalogo, setCatalogo] = useState<CatalogoTransiciones | null>(null);
  const [abrirAbierto, setAbrirAbierto] = useState(false);

  /**
   * El error de una escritura, atado al parte al que se refiere.
   *
   * Va con el id por lo mismo que en `EmployeesView`: con varias filas en
   * pantalla, un mensaje global aparece lejos del botón que se pulsó y nadie
   * sabría a qué parte se refiere.
   */
  const [errorEscritura, setErrorEscritura] = useState<{ id: string; mensaje: string } | null>(
    null,
  );
  const [ocupado, setOcupado] = useState<string | null>(null);

  /** Qué parte está preguntando su desenlace. `desenlace` no tiene defecto. */
  const [cerrando, setCerrando] = useState<string | null>(null);

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

  useEffect(() => {
    api.transiciones().then(setCatalogo, () => setCatalogo(null));
  }, []);

  const escribir = useCallback(
    async (id: string, accion: () => Promise<unknown>) => {
      setOcupado(id);
      setErrorEscritura(null);
      try {
        await accion();
        setCerrando(null);
        await cargar();
      } catch (e) {
        // El 409 del servidor ya trae el porqué y la salida. Se enseña tal
        // cual: reescribirlo aquí sería inventar otra explicación.
        setErrorEscritura({
          id,
          mensaje: e instanceof ErrorApi ? e.message : 'No se pudo completar la operación.',
        });
      } finally {
        setOcupado(null);
      }
    },
    [cargar],
  );

  const abiertos = filas.filter((m) => esAbierto(m.estado)).length;

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
              : `${total} parte${total === 1 ? '' : 's'} · ${abiertos} con el equipo en el taller`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargar}
            disabled={cargando}
            className="px-3 py-2 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface-alt disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={() => {
              setAbrirAbierto((v) => !v);
              setErrorEscritura(null);
            }}
            className="px-3 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Abrir parte
          </button>
        </div>
      </header>

      {abrirAbierto && (
        <FormularioParte
          catalogo={catalogo}
          onCancelar={() => setAbrirAbierto(false)}
          onAbierto={async () => {
            setAbrirAbierto(false);
            await cargar();
          }}
        />
      )}

      {error ? (
        <ErrorDeCarga error={error} que="los partes de mantenimiento" onReintentar={cargar} />
      ) : cargando && filas.length === 0 ? (
        <Cargando que="los partes de mantenimiento" />
      ) : filas.length === 0 ? (
        // El estado vacío. Una afirmación, no un hueco: dice que la consulta
        // llegó, que no hubo error, y que la respuesta es "ninguno todavía".
        <Vacio
          titulo="No hay partes de mantenimiento registrados"
          detalle="La consulta funcionó y no devolvió ninguno: todavía no se ha abierto ningún parte. «Abrir parte» manda el equipo al taller y deja el movimiento."
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
                  <th className="text-right font-semibold px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filas.map((m) => {
                  const abierto = esAbierto(m.estado);
                  return (
                    <React.Fragment key={m.id}>
                      <tr className="hover:bg-surface-alt">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink">{nombreDe(m)}</div>
                          <div className="text-xs font-mono text-ink-muted">
                            {m.equipo_etiqueta ?? m.equipo_serial ?? '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink">{m.tipo}</td>
                        <td className="px-4 py-3">
                          {abierto ? (
                            // Los tres estados abiertos se cambian aquí mismo.
                            // Mover el parte entre ellos no toca el equipo:
                            // sigue en el taller en los tres.
                            <select
                              value={m.estado}
                              disabled={ocupado === m.id}
                              onChange={(e) =>
                                void escribir(m.id, () =>
                                  api.actualizarParte(m.id, {
                                    estado: e.target.value as EstadoParteAbierto,
                                  }),
                                )
                              }
                              className={`text-xs px-2 py-1 rounded-full bg-surface ${colorEstado[m.estado] ?? 'border border-line'} disabled:opacity-50`}
                            >
                              {ESTADOS_PARTE_ABIERTO.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${colorEstado[m.estado] ?? ''}`}
                            >
                              <CheckCircle2 className="w-3 h-3 inline mr-1" />
                              {m.estado}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{m.fecha_reporte.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-ink-muted">{m.responsable ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          {abierto ? (
                            <button
                              onClick={() => {
                                setErrorEscritura(null);
                                setCerrando(cerrando === m.id ? null : m.id);
                              }}
                              disabled={ocupado === m.id}
                              className="text-xs border border-line rounded-lg px-2 py-1 text-ink hover:bg-surface-alt disabled:opacity-50"
                            >
                              {ocupado === m.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                              ) : (
                                'Cerrar parte'
                              )}
                            </button>
                          ) : (
                            <span className="text-xs text-ink-muted">
                              {/* Un parte cerrado no se reabre: si el equipo
                                  vuelve al taller, se abre otro. */}
                              Cerrado {m.fecha_cierre?.slice(0, 10) ?? ''}
                            </span>
                          )}
                        </td>
                      </tr>

                      {cerrando === m.id && (
                        <tr className="bg-surface-alt/60">
                          <td colSpan={6} className="px-4 py-3">
                            {/* Los dos desenlaces, y ninguno por defecto. La
                                pregunta «¿volvió, o no tenía arreglo?» solo la
                                contesta quien lo tiene delante; suponerla
                                dejaría un portátil muerto como disponible. */}
                            <p className="text-sm text-ink mb-2">
                              Cerrar saca el equipo del taller. ¿Qué pasó con{' '}
                              <strong>{nombreDe(m)}</strong>?
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() =>
                                  void escribir(m.id, () => api.cerrarParte(m.id, 'retorno'))
                                }
                                disabled={ocupado === m.id}
                                className="text-sm border border-line rounded-lg px-3 py-1.5 text-ink hover:bg-surface disabled:opacity-50"
                              >
                                Volvió arreglado → queda Disponible
                              </button>
                              <button
                                onClick={() =>
                                  void escribir(m.id, () => api.cerrarParte(m.id, 'baja'))
                                }
                                disabled={ocupado === m.id}
                                className="text-sm border border-danger/50 text-danger rounded-lg px-3 py-1.5 hover:bg-danger/10 disabled:opacity-50"
                              >
                                No tenía arreglo → queda De baja
                              </button>
                              <button
                                onClick={() => setCerrando(null)}
                                className="text-sm text-ink-muted px-3 py-1.5 hover:text-ink"
                              >
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {errorEscritura?.id === m.id && (
                        <tr>
                          <td colSpan={6} className="px-4 pb-3">
                            <p
                              role="alert"
                              className="text-xs text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2"
                            >
                              {errorEscritura.mensaje}
                            </p>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

interface FormularioParteProps {
  catalogo: CatalogoTransiciones | null;
  onCancelar: () => void;
  onAbierto: () => Promise<void>;
}

/**
 * Abrir un parte. El equipo se busca por nombre, etiqueta o serial.
 *
 * Los estados desde los que se puede ir al taller salen del catálogo, no de
 * una constante local. Los equipos que no están en uno de ellos **se ven igual,
 * deshabilitados y con el motivo**: ocultarlos dejaría a quien busca su
 * portátil sin saber si no aparece porque no se puede mandar o porque escribió
 * mal la etiqueta.
 */
const FormularioParte: React.FC<FormularioParteProps> = ({ catalogo, onCancelar, onAbierto }) => {
  const [q, setQ] = useState('');
  const [candidatos, setCandidatos] = useState<EquipoConMotivos[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<EquipoConMotivos | null>(null);

  const [tipo, setTipo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [responsable, setResponsable] = useState('');
  const [proveedor, setProveedor] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desde = catalogo?.operaciones.find((o) => o.operacion === 'enviar_mantenimiento')?.desde;
  const explicacion = catalogo?.operaciones.find(
    (o) => o.operacion === 'enviar_mantenimiento',
  )?.explicacion;

  useEffect(() => {
    if (q.trim().length < 2) {
      setCandidatos([]);
      return;
    }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(() => {
      api
        .equipos({ q: q.trim(), porPagina: 12 })
        .then(
          (d) => vigente && setCandidatos(d.filas),
          () => vigente && setCandidatos([]),
        )
        .finally(() => vigente && setBuscando(false));
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q]);

  const enviar = async () => {
    if (!elegido || !tipo.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await api.abrirParte({
        equipo_id: elegido.id,
        tipo: tipo.trim(),
        descripcion: descripcion.trim() || null,
        responsable: responsable.trim() || null,
        proveedor: proveedor.trim() || null,
      });
      await onAbierto();
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo abrir el parte.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="border border-line rounded-xl bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Abrir parte de mantenimiento</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Abrir el parte manda el equipo al taller y deja el movimiento, en la misma transacción.
          </p>
        </div>
        <button onClick={onCancelar} className="text-ink-muted hover:text-ink" aria-label="Cerrar">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!catalogo && (
        <p className="text-xs text-warn bg-warn/10 border border-warn/40 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          No se pudo cargar la tabla de operaciones, así que no se puede decir de antemano qué
          equipos admiten irse al taller. El servidor rechazará el que no pueda, con el motivo.
        </p>
      )}

      {elegido ? (
        <div className="flex items-center justify-between gap-3 bg-surface-alt border border-line rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm text-ink truncate">{nombreEquipo(elegido)}</p>
            <p className="text-xs font-mono text-ink-muted truncate">
              {elegido.etiqueta ?? elegido.serial ?? '—'} · {elegido.estado}
            </p>
          </div>
          <button
            onClick={() => setElegido(null)}
            className="text-xs text-ink-muted hover:text-ink shrink-0"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar el equipo por nombre, etiqueta o serial…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
            />
          </div>
          {buscando && <p className="text-xs text-ink-muted">Buscando…</p>}
          {!buscando && q.trim().length >= 2 && candidatos.length === 0 && (
            <p className="text-xs text-ink-muted">Ningún equipo coincide.</p>
          )}
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {candidatos.map((eq) => {
              // `desde === undefined` significa que no hay catálogo, no que no
              // se pueda: sin información no se bloquea, se deja probar.
              const puede = desde === undefined || desde.includes(eq.estado);
              return (
                <button
                  key={eq.id}
                  onClick={() => puede && setElegido(eq)}
                  disabled={!puede}
                  title={puede ? undefined : explicacion}
                  className="w-full text-left border border-line rounded-lg px-3 py-2 hover:bg-surface-alt disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                  <span className="text-sm text-ink block truncate">{nombreEquipo(eq)}</span>
                  <span className="text-xs font-mono text-ink-muted">
                    {eq.etiqueta ?? eq.serial ?? '—'} · {eq.estado}
                    {!puede && ' — no se puede mandar al taller desde este estado'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="text-xs text-ink-muted space-y-1">
          <span>Tipo de intervención *</span>
          <input
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            placeholder="Cambio de batería, limpieza…"
            className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </label>
        <label className="text-xs text-ink-muted space-y-1">
          <span>Responsable</span>
          <input
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </label>
        <label className="text-xs text-ink-muted space-y-1">
          <span>Proveedor</span>
          <input
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </label>
        <label className="text-xs text-ink-muted space-y-1 md:col-span-2">
          <span>Descripción</span>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => void enviar()}
          disabled={enviando || !elegido || !tipo.trim()}
          className="px-3 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          Abrir y enviar al taller
        </button>
        {!elegido && <span className="text-xs text-ink-muted">Falta elegir el equipo.</span>}
        {elegido && !tipo.trim() && (
          <span className="text-xs text-ink-muted">Falta el tipo de intervención.</span>
        )}
      </div>
    </section>
  );
};

