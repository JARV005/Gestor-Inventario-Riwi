import React, { useState } from 'react';
import { Employee, Device, LogisticsTicket } from '../types';
import { PackageCheck, Truck, CheckCircle2, ChevronRight, X, Sparkles, Building, UserCheck, ShieldCheck } from 'lucide-react';
import confetti from 'canvas-confetti';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  devices: Device[];
  onAddLogisticsTicket: (ticket: LogisticsTicket) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  employees,
  devices,
  onAddLogisticsTicket,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedEmpId, setSelectedEmpId] = useState(employees[0]?.id || '');
  const [selectedLaptopId, setSelectedLaptopId] = useState(
    devices.find((d) => d.category === 'Laptop' && d.status === 'Available')?.id || devices[0]?.id || ''
  );
  const [includeMonitor, setIncludeMonitor] = useState(true);
  const [includePeripherals, setIncludePeripherals] = useState(true);
  const [courier, setCourier] = useState<LogisticsTicket['courier']>('DHL Express');

  if (!isOpen) return null;

  const selectedEmp = employees.find((e) => e.id === selectedEmpId) || employees[0];
  const selectedLaptop = devices.find((d) => d.id === selectedLaptopId) || devices[0];

  const handleFinishOnboardingKit = () => {
    const includedItems = [selectedLaptop?.name || 'MacBook Pro'];
    if (includeMonitor) includedItems.push('Monitor Dell UltraSharp 27" 4K');
    if (includePeripherals) includedItems.push('Kit Ergonómico (Logitech MX Master + Teclado)');

    const newTicket: LogisticsTicket = {
      id: `LOG-ONB-${Math.floor(1000 + Math.random() * 9000)}`,
      type: 'Onboarding Ship',
      status: 'In Transit',
      employeeName: selectedEmp.name,
      employeeAddress: `${selectedEmp.address}, ${selectedEmp.city}, ${selectedEmp.country}`,
      deviceNames: includedItems,
      courier,
      trackingNumber: `DHL-MX-${Math.floor(10000000 + Math.random() * 90000000)}`,
      estimatedDelivery: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      createdDate: new Date().toISOString().slice(0, 10),
      hubOrigin: `FirstPlug Hub ${selectedEmp.country}`,
    };

    onAddLogisticsTicket(newTicket);
    confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
        
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
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.role} ({e.city}, {e.country})
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-900 text-sm">{selectedEmp?.name}</div>
              <p className="text-slate-500">{selectedEmp?.role} • {selectedEmp?.department}</p>
              <p className="text-blue-600 font-medium">Dirección de envío: {selectedEmp?.address}, {selectedEmp?.city}, {selectedEmp?.country}</p>
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
                {devices.filter(d => d.category === 'Laptop').map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.assetTag} — Ubicación: {d.location})
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
              <p className="text-blue-600 font-medium">Destinatario: {selectedEmp?.name}</p>
              <p className="text-slate-600">Dirección: {selectedEmp?.address}, {selectedEmp?.city}</p>
              <div className="pt-2 border-t border-slate-200 text-slate-600">
                <strong className="text-slate-900 block mb-1">Contenido de la Caja:</strong>
                <ul className="list-disc pl-4 space-y-0.5 text-slate-500">
                  <li>{selectedLaptop?.name} ({selectedLaptop?.serialNumber})</li>
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
