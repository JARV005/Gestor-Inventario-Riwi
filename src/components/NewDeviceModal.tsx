import React, { useState } from 'react';
import { Device, DeviceCategory, DeviceStatus, Employee } from '../types';
import { Laptop, Plus, X } from 'lucide-react';
import confetti from 'canvas-confetti';

interface NewDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  onAddDevice: (device: Device) => void;
}

export const NewDeviceModal: React.FC<NewDeviceModalProps> = ({
  isOpen,
  onClose,
  employees,
  onAddDevice,
}) => {
  const [name, setName] = useState('MacBook Pro 16" M3 Pro');
  const [category, setCategory] = useState<DeviceCategory>('Laptop');
  const [brand, setBrand] = useState('Apple');
  const [model, setModel] = useState('A2992');
  const [serialNumber, setSerialNumber] = useState(`C02G${Math.floor(10000 + Math.random() * 90000)}FP`);
  const [assetTag, setAssetTag] = useState(`FP-MX-${Math.floor(1000 + Math.random() * 9000)}`);
  const [status, setStatus] = useState<DeviceStatus>('Available');
  const [location, setLocation] = useState('FirstPlug Hub Ciudad de México');
  const [assignedTo, setAssignedTo] = useState('');
  const [costUSD, setCostUSD] = useState(2499);
  const [cpu, setCpu] = useState('Apple M3 Pro 12-core');
  const [ram, setRam] = useState('36GB');
  const [storage, setStorage] = useState('512GB SSD');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newDevice: Device = {
      id: `dev-${Date.now().toString().slice(-4)}`,
      assetTag,
      name,
      category,
      brand,
      model,
      serialNumber,
      status,
      condition: 'Brand New',
      location: 'CDMX Hub (México)',
      department: 'Engineering',
      assignedTo: assignedTo || null,
      assignedDate: assignedTo ? new Date().toISOString().slice(0, 10) : null,
      purchaseDate: new Date().toISOString().slice(0, 10),
      warrantyExpiry: '2028-12-31',
      costUSD: Number(costUSD) || 1999,
      specs: {
        cpu,
        ram,
        storage,
        os: category === 'Laptop' ? 'macOS Sequoia 15.2' : 'N/A',
      },
      mdmEnrolled: true,
      mdmProvider: 'Jamf Pro Enterprise',
      encrypted: true,
      healthScore: 100,
      batteryHealth: 100,
      imageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&q=80&w=800',
    };

    onAddDevice(newDevice);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-600" />
            Registrar Nuevo Activo de TI
          </h2>
          <p className="text-xs text-slate-500">
            Añade un equipo al inventario FirstPlug para seguimiento de garantía y asignaciones.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Nombre del Equipo *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Categoría</label>
              <select
                value={category}
                onChange={(e: any) => setCategory(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="Laptop">Laptop</option>
                <option value="Monitor">Monitor</option>
                <option value="Mobile">Móvil / Celular</option>
                <option value="Peripherals">Periférico</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Etiqueta Activo</label>
              <input
                type="text"
                required
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono text-blue-600 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Marca</label>
              <input
                type="text"
                required
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Modelo</label>
              <input
                type="text"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Número de Serie *</label>
              <input
                type="text"
                required
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Costo Adquisición (USD)</label>
              <input
                type="number"
                value={costUSD}
                onChange={(e) => setCostUSD(Number(e.target.value))}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">CPU</label>
              <input
                type="text"
                value={cpu}
                onChange={(e) => setCpu(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">RAM</label>
              <input
                type="text"
                value={ram}
                onChange={(e) => setRam(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">SSD</label>
              <input
                type="text"
                value={storage}
                onChange={(e) => setStorage(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Ubicación / Hub Inicial</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="FirstPlug Hub Ciudad de México">Hub Ciudad de México 🇲🇽</option>
                <option value="FirstPlug Hub Bogotá">Hub Bogotá 🇨🇴</option>
                <option value="FirstPlug Hub Buenos Aires">Hub Buenos Aires 🇦🇷</option>
                <option value="FirstPlug Hub North America">Hub Miami 🇺🇸</option>
                <option value="FirstPlug Hub Europa">Hub Madrid 🇪🇸</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Asignar a Colaborador (Opcional)</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="">Sin Asignación (Guardar en Hub)</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.role})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors"
            >
              Guardar Activo en Inventario
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
