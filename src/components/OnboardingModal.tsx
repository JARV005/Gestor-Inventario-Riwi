import React, { useEffect, useState } from 'react';
import type { EmpleadoConConteo, EquipoConMotivos } from '../types';
import { PackageCheck, Truck, CheckCircle2, ChevronRight, X, Sparkles, Building, UserCheck, ShieldCheck } from 'lucide-react';
import confetti from 'canvas-confetti';

import { api } from '../lib/api';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Lee de la base (4b); **no escribe** (etapa 5).
 *
 * Antes creaba un `LogisticsTicket` con transportadora y número de guía
 * inventados. Según D1 lo que tiene que producir es un **movimiento**: de tipo
 * `Asignación`, o `Traslado` si además cambia de sede. Eso escribe en `equipos`
 * y `movimientos` en la misma transacción y no existe hasta la etapa 5.
 *
 * Lo que sí cambió en la 4b: los desplegables ya no salen de `mockData`, salen
 * de la API. El asistente recorre sus tres pasos sobre datos reales y sigue sin
 * persistir nada. El paso de transportadora y guía se queda porque esos campos
 * SÍ existen en `movimientos` desde la 0000; lo que no hay es a dónde mandarlos.
 */
const TOPE = 200;

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [empleados, setEmpleados] = useState<EmpleadoConConteo[]>([]);
  const [equipos, setEquipos] = useState<EquipoConMotivos[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [selectedLaptopId, setSelectedLaptopId] = useState('');
  const [includeMonitor, setIncludeMonitor] = useState(true);
  const [includePeripherals, setIncludePeripherals] = useState(true);
  const [courier, setCourier] = useState('Servientrega');

  useEffect(() => {
    if (!isOpen) return;
    let vigente = true;
    Promise.all([
      api.empleados({ porPagina: TOPE, activo: true }),
      api.equipos({ porPagina: TOPE }),
    ]).then(
      ([e, q]) => {
        if (!vigente) return;
        setEmpleados(e.filas);
        setEquipos(q.filas);
        // La preselección se hace aquí y no en el `useState`: en el primer
        // render las listas están vacías.
        setSelectedEmpId((a) => a || e.filas[0]?.id || '');
        setSelectedLaptopId(
          (a) =>
            a ||
            q.filas.find((d) => d.categoria === 'Portátil' && d.estado === 'Disponible')?.id ||
            q.filas[0]?.id ||
            '',
        );
      },
      () => {
        // Este asistente no persiste nada todavía: si la carga falla, los
        // desplegables quedan vacíos y no hay nada que se pueda perder.
      },
    );
    return () => {
      vigente = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedEmp = empleados.find((e) => e.id === selectedEmpId) ?? empleados[0];
  const selectedLaptop = equipos.find((d) => d.id === selectedLaptopId) ?? equipos[0];

  const nombreEquipo = (e: EquipoConMotivos | undefined) =>
    e?.nombre_equipo ?? e?.etiqueta ?? ([e?.marca, e?.modelo].filter(Boolean).join(' ') || 'equipo');

  const handleFinishOnboardingKit = () => {
    // TODO(5): POST /api/equipos/:id/asignar — crea el movimiento y mueve el
    // estado del equipo en la misma transacción.
    confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 space-y-5 shadow-xl relative animate-aparecer text-slate-900">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Wizard Steps Indicator */}
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-blue-600" />
            Envío de Kit de Onboarding
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
            <span className={`px-2 py-0.5 rounded font-bold ${step === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
              1. Colaborador
            </span>
            <span>→</span>
            <span className={`px-2 py-0.5 rounded font-bold ${step === 2 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
              2. Hardware & Kit
            </span>
            <span>→</span>
            <span className={`px-2 py-0.5 rounded font-bold ${step === 3 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
              3. Courier & Confirmación
            </span>
          </div>
        </div>

        {/* Step 1: Select Employee */}
        {step === 1 && (
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Selecciona el Colaborador de Onboarding</label>
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
              <div className="font-bold text-slate-900 text-sm">{selectedEmp?.nombre}</div>
              <p className="text-slate-500">{selectedEmp?.cargo ?? '—'}{selectedEmp?.area ? ` • ${selectedEmp.area}` : ''}</p>
              <p className="text-blue-600 font-medium">Dirección de envío: {selectedEmp?.direccion ?? 'sin dirección registrada'}</p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-1"
              >
                <span>Siguiente: Elegir Hardware</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Select Hardware */}
        {step === 2 && (
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Selecciona Laptop Principal (Disponible en Hub)</label>
              <select
                value={selectedLaptopId}
                onChange={(e) => setSelectedLaptopId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                {equipos.filter((d) => d.categoria === 'Portátil').map((d) => (
                  <option key={d.id} value={d.id}>
                    {nombreEquipo(d)}{d.etiqueta ? ` (${d.etiqueta})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-slate-700 font-semibold">Accesorios e Ítems Adicionales del Kit</label>

              <label className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMonitor}
                  onChange={(e) => setIncludeMonitor(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-600"
                />
                <div>
                  <span className="font-bold text-slate-900 block">Monitor Secundario Dell UltraSharp 27" 4K</span>
                  <span className="text-slate-500 text-[11px]">Empacado en caja reforzada de transporte FirstPlug</span>
                </div>
              </label>

              <label className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePeripherals}
                  onChange={(e) => setIncludePeripherals(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-600"
                />
                <div>
                  <span className="font-bold text-slate-900 block">Kit Ergonómico Logitech MX (Mouse + Teclado)</span>
                  <span className="text-slate-500 text-[11px]">Incluye stickers de la empresa y tarjeta de bienvenida</span>
                </div>
              </label>
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
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-1"
              >
                <span>Siguiente: Courier</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Courier & Confirmation */}
        {step === 3 && (
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Empresa de Logística / Courier</label>
              <select
                value={courier}
                onChange={(e: any) => setCourier(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="DHL Express">DHL Express (Entrega 24/48 hrs)</option>
                <option value="FedEx">FedEx International Priority</option>
                <option value="FirstPlug Direct">FirstPlug Direct Glove Logistics</option>
              </select>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-900 text-sm">Resumen del Kit de Onboarding</div>
              <p className="text-blue-600 font-medium">Destinatario: {selectedEmp?.nombre}</p>
              <p className="text-slate-600">Dirección: {selectedEmp?.direccion ?? 'sin dirección registrada'}</p>
              <div className="pt-2 border-t border-slate-200 text-slate-600">
                <strong className="text-slate-900 block mb-1">Contenido de la Caja:</strong>
                <ul className="list-disc pl-4 space-y-0.5 text-slate-500">
                  <li>{nombreEquipo(selectedLaptop)}{selectedLaptop?.serial ? ` (${selectedLaptop.serial})` : ''}</li>
                  {includeMonitor && <li>Monitor Dell UltraSharp 27" 4K</li>}
                  {includePeripherals && <li>Kit Ergonómico Logitech MX</li>}
                </ul>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
              >
                Atrás
              </button>
              <button
                onClick={handleFinishOnboardingKit}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Truck className="w-4 h-4 fill-white" />
                <span>Despachar Kit de Onboarding</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
