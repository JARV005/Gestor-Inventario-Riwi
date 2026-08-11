import React, { useEffect, useState } from 'react';
import type { EmpleadoConConteo, EquipoConMotivos } from '../types';
import { PackageCheck, Truck, ChevronRight, X, AlertTriangle, Check } from 'lucide-react';
import confetti from 'canvas-confetti';

import { api, ErrorApi } from '../lib/api';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Asignar mueve conteos que se pintan fuera del modal (badge y dashboard). */
  onAsignado?: () => void;
}

/**
 * El asistente de entrega. Etapa 5: **ya escribe**.
 *
 * Lo que produce es lo que dice D1: una `Asignación` por equipo, y además un
 * `Traslado` cuando el equipo no está en la sede de quien lo recibe. Cada una
 * es una llamada a `POST /api/equipos/:id/{asignar,trasladar}`, y cada llamada
 * escribe `equipos`, `movimientos` y `auditoria` en una sola transacción.
 *
 * **No hay una transacción que abarque los tres equipos de un kit.** Se manda
 * uno detrás de otro y se enseña el resultado de cada uno. Un endpoint de lote
 * haría el kit atómico, pero hoy no existe y fingirlo —confeti pase lo que
 * pase— es peor que decir «2 de 3»: el portátil que no se asignó sigue
 * disponible para otra persona y alguien tiene que enterarse.
 *
 * Lo que se fue del prototipo: el monitor Dell UltraSharp y el kit Logitech MX
 * estaban escritos a mano en el JSX, con stickers y tarjeta de bienvenida. No
 * existían en ninguna parte. Ahora los extras se eligen del inventario real, y
 * si no hay monitores disponibles la lista está vacía y lo dice.
 */
const TOPE = 200;

/** Lo que se puede entregar: lo que no está en manos de nadie. */
const ASIGNABLE = (e: EquipoConMotivos) => e.estado === 'Disponible' || e.estado === 'Reservado';

const PERIFERICOS = ['Teclado', 'Mouse', 'Diadema'] as const;

interface Resultado {
  equipo: EquipoConMotivos;
  ok: boolean;
  detalle: string;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onAsignado,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [empleados, setEmpleados] = useState<EmpleadoConConteo[]>([]);
  const [equipos, setEquipos] = useState<EquipoConMotivos[]>([]);
  const [sedes, setSedes] = useState<{ id: string; nombre: string }[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [selectedLaptopId, setSelectedLaptopId] = useState('');
  const [monitorId, setMonitorId] = useState('');
  const [perifericosIds, setPerifericosIds] = useState<string[]>([]);
  const [courier, setCourier] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let vigente = true;
    setErrorCarga(null);
    Promise.all([
      api.empleados({ porPagina: TOPE, activo: true }),
      api.equipos({ porPagina: TOPE }),
      api.sedes(),
    ]).then(
      ([e, q, s]) => {
        if (!vigente) return;
        setEmpleados(e.filas);
        setEquipos(q.filas);
        setSedes(s.sedes);
        // La preselección se hace aquí y no en el `useState`: en el primer
        // render las listas están vacías.
        setSelectedEmpId((a) => a || e.filas[0]?.id || '');
        setSelectedLaptopId(
          (a) => a || q.filas.find((d) => d.categoria === 'Portátil' && ASIGNABLE(d))?.id || '',
        );
      },
      (err) => {
        if (!vigente) return;
        // Desde la etapa 5 esto sí escribe, así que una carga fallida no puede
        // pasar en silencio: con los desplegables vacíos se asignaría el equipo
        // equivocado, o ninguno.
        setErrorCarga(
          err instanceof ErrorApi ? err.message : 'No se pudieron cargar los datos.',
        );
      },
    );
    return () => {
      vigente = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedEmp = empleados.find((e) => e.id === selectedEmpId);
  const selectedLaptop = equipos.find((d) => d.id === selectedLaptopId);

  const nombreEquipo = (e: EquipoConMotivos | undefined) =>
    e?.nombre_equipo ?? e?.etiqueta ?? ([e?.marca, e?.modelo].filter(Boolean).join(' ') || 'equipo');
  const nombreSede = (id: string | null | undefined) =>
    (id && sedes.find((s) => s.id === id)?.nombre) || 'sin sede';

  const monitores = equipos.filter((d) => d.categoria === 'Monitor' && ASIGNABLE(d));
  const perifericos = equipos.filter(
    (d) => (PERIFERICOS as readonly string[]).includes(d.categoria) && ASIGNABLE(d),
  );

  /** Todo lo que se va a entregar, en orden: el portátil primero. */
  const delKit = (): EquipoConMotivos[] => {
    const ids = [selectedLaptopId, monitorId, ...perifericosIds].filter(Boolean);
    return ids
      .map((id) => equipos.find((e) => e.id === id))
      .filter((e): e is EquipoConMotivos => Boolean(e));
  };

  /** Un equipo viaja si su sede no es la de quien lo recibe. */
  const necesitaTraslado = (e: EquipoConMotivos) =>
    Boolean(selectedEmp?.sede_id) && e.sede_id !== selectedEmp?.sede_id;

  const algunoViaja = delKit().some(necesitaTraslado);

  const alternarPeriferico = (id: string) =>
    setPerifericosIds((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const cerrar = () => {
    setResultados(null);
    setStep(1);
    onClose();
  };

  const despachar = async () => {
    if (!selectedEmp) return;
    setEnviando(true);
    const hechos: Resultado[] = [];

    for (const equipo of delKit()) {
      try {
        await api.asignar(equipo.id, selectedEmp.id);
        let detalle = `Asignado a ${selectedEmp.nombre}`;

        // El traslado va DESPUÉS de la asignación y solo si aquella salió
        // bien: un traslado de un equipo que no se pudo asignar movería de
        // sede algo que sigue disponible para otra persona.
        if (necesitaTraslado(equipo)) {
          await api.trasladar(equipo.id, selectedEmp.sede_id!, {
            transportadora: courier.trim() || null,
          });
          detalle += ` · en tránsito a ${nombreSede(selectedEmp.sede_id)}`;
        }
        hechos.push({ equipo, ok: true, detalle });
      } catch (e) {
        hechos.push({
          equipo,
          ok: false,
          detalle: e instanceof ErrorApi ? e.message : 'Error desconocido',
        });
      }
    }

    setResultados(hechos);
    setEnviando(false);
    onAsignado?.();
    // Confeti solo si salió todo. Celebrar un kit a medias esconde justo lo
    // que hay que mirar.
    if (hechos.every((h) => h.ok)) confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 space-y-5 shadow-xl relative animate-aparecer text-slate-900">

        <button
          onClick={cerrar}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-blue-600" />
            Entrega de equipos
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
            <span className={`px-2 py-0.5 rounded font-bold ${step === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
              1. Colaborador
            </span>
            <span>→</span>
            <span className={`px-2 py-0.5 rounded font-bold ${step === 2 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
              2. Equipos
            </span>
            <span>→</span>
            <span className={`px-2 py-0.5 rounded font-bold ${step === 3 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
              3. Envío y confirmación
            </span>
          </div>
        </div>

        {errorCarga && (
          <p role="alert" className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
            {errorCarga} No se puede entregar nada hasta que carguen los datos.
          </p>
        )}

        {/* El resultado sustituye al asistente: una vez escrito, lo que importa
            es qué quedó escrito. */}
        {resultados ? (
          <div className="space-y-3 text-xs">
            <ul className="space-y-2">
              {resultados.map((r) => (
                <li
                  key={r.equipo.id}
                  className={`p-3 rounded-xl border flex items-start gap-2 ${
                    r.ok ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-200'
                  }`}
                >
                  {r.ok ? (
                    <Check className="w-4 h-4 text-green-600 shrink-0 mt-px" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-px" />
                  )}
                  <div>
                    <span className="font-bold text-slate-900 block">
                      {nombreEquipo(r.equipo)}
                      {r.equipo.etiqueta ? ` (${r.equipo.etiqueta})` : ''}
                    </span>
                    <span className={r.ok ? 'text-slate-600' : 'text-red-700'}>{r.detalle}</span>
                  </div>
                </li>
              ))}
            </ul>
            {resultados.some((r) => !r.ok) && (
              <p className="text-red-700">
                Lo que falló no se entregó: esos equipos siguen como estaban y hay que repetirlos.
              </p>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={cerrar}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Paso 1: el colaborador */}
            {step === 1 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Colaborador que recibe
                  </label>
                  <select
                    value={selectedEmpId}
                    onChange={(e) => setSelectedEmpId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}{e.cargo ? ` — ${e.cargo}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-900 text-sm">{selectedEmp?.nombre ?? '—'}</div>
                  <p className="text-slate-500">
                    {selectedEmp?.cargo ?? '—'}{selectedEmp?.area ? ` • ${selectedEmp.area}` : ''}
                  </p>
                  <p className="text-blue-600 font-medium">
                    Sede: {nombreSede(selectedEmp?.sede_id)}
                  </p>
                  <p className="text-slate-600">
                    Dirección: {selectedEmp?.direccion ?? 'sin dirección registrada'}
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setStep(2)}
                    disabled={!selectedEmp}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-1"
                  >
                    <span>Siguiente: elegir equipos</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Paso 2: los equipos, del inventario real */}
            {step === 2 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Portátil (solo los que están disponibles o reservados)
                  </label>
                  <select
                    value={selectedLaptopId}
                    onChange={(e) => setSelectedLaptopId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    <option value="">— ninguno —</option>
                    {equipos
                      .filter((d) => d.categoria === 'Portátil' && ASIGNABLE(d))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {nombreEquipo(d)}{d.etiqueta ? ` (${d.etiqueta})` : ''} · {nombreSede(d.sede_id)}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Monitor (opcional)</label>
                  <select
                    value={monitorId}
                    onChange={(e) => setMonitorId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    <option value="">— sin monitor —</option>
                    {monitores.map((d) => (
                      <option key={d.id} value={d.id}>
                        {nombreEquipo(d)}{d.etiqueta ? ` (${d.etiqueta})` : ''} · {nombreSede(d.sede_id)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-slate-700 font-semibold">
                    Periféricos disponibles ({perifericos.length})
                  </label>
                  {perifericos.length === 0 ? (
                    <p className="text-slate-500 border border-dashed border-slate-200 rounded-xl p-3">
                      No hay teclados, ratones ni diademas disponibles en el inventario.
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                      {perifericos.map((d) => (
                        <label
                          key={d.id}
                          className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={perifericosIds.includes(d.id)}
                            onChange={() => alternarPeriferico(d.id)}
                            className="w-4 h-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-600"
                          />
                          <div>
                            <span className="font-bold text-slate-900 block">
                              {d.categoria}: {nombreEquipo(d)}
                            </span>
                            <span className="text-slate-500 text-[11px]">
                              {d.etiqueta ?? 'sin etiqueta'} · {nombreSede(d.sede_id)}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
                  >
                    Atrás
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={delKit().length === 0}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-1"
                  >
                    <span>Siguiente: envío</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Paso 3: el envío y lo que se va a escribir */}
            {step === 3 && (
              <div className="space-y-4 text-xs">
                {algunoViaja ? (
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      Transportadora (opcional)
                    </label>
                    <input
                      value={courier}
                      onChange={(e) => setCourier(e.target.value)}
                      placeholder="Quién lo lleva"
                      maxLength={120}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                    <p className="text-slate-500 mt-1">
                      Se guarda en el traslado. El número de guía se añade después, cuando lo
                      dé la transportadora.
                    </p>
                  </div>
                ) : (
                  <p className="text-slate-500">
                    Todo el kit ya está en {nombreSede(selectedEmp?.sede_id)}: no hay envío que
                    registrar, solo la asignación.
                  </p>
                )}

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-900 text-sm">Lo que se va a registrar</div>
                  <p className="text-blue-600 font-medium">Recibe: {selectedEmp?.nombre}</p>
                  <p className="text-slate-600">Sede: {nombreSede(selectedEmp?.sede_id)}</p>
                  <ul className="pt-2 border-t border-slate-200 space-y-1 text-slate-600">
                    {delKit().map((e) => (
                      <li key={e.id}>
                        <strong className="text-slate-900">{nombreEquipo(e)}</strong>
                        {e.etiqueta ? ` (${e.etiqueta})` : ''} — asignación
                        {necesitaTraslado(e) &&
                          ` + traslado de ${nombreSede(e.sede_id)} a ${nombreSede(selectedEmp?.sede_id)}`}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setStep(2)}
                    disabled={enviando}
                    className="px-4 py-2 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
                  >
                    Atrás
                  </button>
                  <button
                    onClick={() => void despachar()}
                    disabled={enviando || delKit().length === 0}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                  >
                    <Truck className="w-4 h-4" />
                    <span>{enviando ? 'Registrando…' : 'Registrar entrega'}</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
