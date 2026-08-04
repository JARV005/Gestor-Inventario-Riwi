import React, { useState } from 'react';
import { Hub, LogisticsTicket, Device } from '../types';
import { 
  Building, 
  Truck, 
  Package, 
  MapPin, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  Plus, 
  Mail, 
  Phone, 
  ShieldCheck, 
  Search,
  ExternalLink,
  ChevronRight,
  Zap,
  X
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface LogisticsHubsViewProps {
  hubs: Hub[];
  logisticsTickets: LogisticsTicket[];
  devices: Device[];
  onAddLogisticsTicket: (ticket: LogisticsTicket) => void;
}

export const LogisticsHubsView: React.FC<LogisticsHubsViewProps> = ({
  hubs,
  logisticsTickets,
  devices,
  onAddLogisticsTicket,
}) => {
  const [selectedHub, setSelectedHub] = useState<Hub | null>(null);
  const [ticketFilter, setTicketFilter] = useState<'All' | 'In Transit' | 'Delivered' | 'Scheduled'>('All');
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);

  // New Ticket Form State
  const [employeeName, setEmployeeName] = useState('');
  const [employeeAddress, setEmployeeAddress] = useState('');
  const [ticketType, setTicketType] = useState<LogisticsTicket['type']>('Onboarding Ship');
  const [courier, setCourier] = useState<LogisticsTicket['courier']>('DHL Express');
  const [originHub, setOriginHub] = useState('FirstPlug Hub Ciudad de México');
  const [selectedDeviceName, setSelectedDeviceName] = useState('MacBook Pro 16" M3');

  const filteredTickets = logisticsTickets.filter((t) => {
    if (ticketFilter === 'All') return true;
    return t.status === ticketFilter;
  });

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeName || !employeeAddress) return;

    const newTicket: LogisticsTicket = {
      id: `LOG-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      type: ticketType,
      status: 'In Transit',
      employeeName,
      employeeAddress,
      deviceNames: [selectedDeviceName],
      courier,
      trackingNumber: `${courier.slice(0,3).toUpperCase()}-${Math.floor(10000000 + Math.random() * 90000000)}`,
      estimatedDelivery: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      createdDate: new Date().toISOString().slice(0, 10),
      hubOrigin: originHub,
    };

    onAddLogisticsTicket(newTicket);
    setShowNewTicketModal(false);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });

    // Reset
    setEmployeeName('');
    setEmployeeAddress('');
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Main Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Logística Global & Hubs de Almacenamiento
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full font-semibold">
              5 Hubs Activos
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Almacenes físicos en México, Colombia, Argentina, EE.UU. y España para almacenamiento, sanitización y distribución de hardware.
          </p>
        </div>

        <button
          onClick={() => setShowNewTicketModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Solicitar Envío / Depósito</span>
        </button>
      </div>

      {/* Warehouses / Hubs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {hubs.map((hub) => {
          const occupancy = Math.round((hub.currentItems / hub.capacityItems) * 100);
          const storedDevices = devices.filter((d) => d.location.includes(hub.city));

          return (
            <div
              key={hub.id}
              onClick={() => setSelectedHub(hub)}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-500/50 transition-all cursor-pointer space-y-4 shadow-sm group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-3xl p-2 bg-slate-50 rounded-xl border border-slate-200">{hub.flag}</div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm group-hover:text-blue-600 transition-colors">
                      {hub.name}
                    </h3>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-blue-600" />
                      {hub.city}, {hub.country}
                    </p>
                  </div>
                </div>
              </div>

              {/* Address & Contact */}
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs space-y-1">
                <p className="text-[11px] text-slate-700 truncate">{hub.address}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-200">
                  <span>Manager: <strong className="text-slate-800">{hub.managerName}</strong></span>
                  <span className="text-blue-600 font-medium">{hub.contactPhone}</span>
                </div>
              </div>

              {/* Storage Occupancy Meter */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-500">Ocupación de Almacén</span>
                  <span className="text-slate-900 font-bold">{hub.currentItems} / {hub.capacityItems} Ítems ({occupancy}%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${occupancy > 80 ? 'bg-amber-500' : 'bg-blue-600'}`}
                    style={{ width: `${occupancy}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-blue-600 font-semibold pt-1">
                <span>{storedDevices.length} equipos listos para entrega</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Shipping & Pickup Tickets Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-4 h-4 text-blue-600" />
              Guías y Envíos Activos (DHL / FedEx)
            </h2>
            <p className="text-xs text-slate-500">
              Rastreo en tiempo real de kits de onboarding y solicitudes de retiro por offboarding.
            </p>
          </div>

          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200 text-xs">
            {(['All', 'In Transit', 'Scheduled', 'Delivered'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setTicketFilter(st)}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  ticketFilter === st ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {st === 'All' ? 'Todos' : st === 'In Transit' ? 'En Tránsito' : st === 'Scheduled' ? 'Programados' : 'Entregados'}
              </button>
            ))}
          </div>
        </div>

        {/* Tickets Table / List */}
        <div className="space-y-3">
          {filteredTickets.map((ticket) => (
            <div 
              key={ticket.id}
              className="bg-slate-50 p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors space-y-3"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {ticket.id}
                  </span>
                  <span className="font-bold text-slate-900 text-sm">{ticket.type}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    ticket.status === 'In Transit' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                    ticket.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {ticket.status === 'In Transit' ? 'En Camino (DHL/FedEx)' : ticket.status}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-slate-500 text-[11px]">
                  <span>Courier: <strong className="text-slate-800">{ticket.courier}</strong></span>
                  <span>Guía: <strong className="text-blue-700 font-mono">{ticket.trackingNumber}</strong></span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-white p-3 rounded-lg border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold block">Destinatario</span>
                  <span className="font-bold text-slate-900">{ticket.employeeName}</span>
                  <p className="text-[11px] text-slate-500 truncate">{ticket.employeeAddress}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold block">Equipos Incluidos</span>
                  <span className="font-semibold text-slate-800">{ticket.deviceNames.join(', ')}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold block">Origen & Entrega Estimada</span>
                  <span className="text-slate-700 block">{ticket.hubOrigin}</span>
                  <span className="text-emerald-600 font-bold">Entrega: {ticket.estimatedDelivery}</span>
                </div>
              </div>

              {/* Visual Step Tracker Progress */}
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>1. Sanitizado en Hub</span>
                  <span>→</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>2. Empacado Kit FirstPlug</span>
                  <span>→</span>
                  <span className={`w-2 h-2 rounded-full ${ticket.status === 'In Transit' ? 'bg-indigo-600 animate-pulse' : 'bg-emerald-500'}`} />
                  <span className={ticket.status === 'In Transit' ? 'text-indigo-700 font-bold' : ''}>3. En Tránsito</span>
                  <span>→</span>
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                  <span>4. Entregado</span>
                </div>
              </div>

            </div>
          ))}
        </div>
      </div>

      {/* Hub Detail Modal */}
      {selectedHub && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
            <button
              onClick={() => setSelectedHub(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="text-4xl p-2 bg-slate-50 rounded-xl border border-slate-200">{selectedHub.flag}</div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedHub.name}</h2>
                <p className="text-xs text-slate-500">{selectedHub.address}</p>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Responsable de Hub:</span>
                <span className="font-bold text-slate-900">{selectedHub.managerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Email Contacto:</span>
                <span className="text-blue-600 font-medium">{selectedHub.contactEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Teléfono:</span>
                <span className="text-slate-800">{selectedHub.contactPhone}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Equipos Almacenados en esta Sede ({devices.filter(d => d.location.includes(selectedHub.city)).length})
              </h3>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {devices.filter(d => d.location.includes(selectedHub.city)).map((d) => (
                  <div key={d.id} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-slate-900 block">{d.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{d.assetTag} • {d.serialNumber}</span>
                    </div>
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 font-medium">
                      {d.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedHub(null)}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Logistics Ticket Modal */}
      {showNewTicketModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
            <button
              onClick={() => setShowNewTicketModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                Crear Orden de Envío o Depósito
              </h2>
              <p className="text-xs text-slate-500">
                Coordina la entrega de equipos mediante courier o depósito en almacén FirstPlug.
              </p>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Tipo de Operación</label>
                  <select
                    value={ticketType}
                    onChange={(e: any) => setTicketType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    <option value="Onboarding Ship">Envío de Onboarding</option>
                    <option value="Offboarding Retrieve">Retiro de Offboarding</option>
                    <option value="Maintenance / Repair">Envío a Mantenimiento</option>
                    <option value="Hub Transfer">Transferencia entre Hubs</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Courier / Transporte</label>
                  <select
                    value={courier}
                    onChange={(e: any) => setCourier(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    <option value="DHL Express">DHL Express</option>
                    <option value="FedEx">FedEx International</option>
                    <option value="Estafeta">Estafeta</option>
                    <option value="FirstPlug Direct">FirstPlug Direct Logistics</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Nombre del Colaborador / Destinatario *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Lucas Fernández"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Dirección Completa de Envío *</label>
                <input
                  type="text"
                  required
                  placeholder="Av. Reforma 402, Apt 5B, CDMX"
                  value={employeeAddress}
                  onChange={(e) => setEmployeeAddress(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Hub de Origen</label>
                  <select
                    value={originHub}
                    onChange={(e) => setOriginHub(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    <option value="FirstPlug Hub Ciudad de México">Hub Ciudad de México 🇲🇽</option>
                    <option value="FirstPlug Hub Bogotá">Hub Bogotá 🇨🇴</option>
                    <option value="FirstPlug Hub Buenos Aires">Hub Buenos Aires 🇦🇷</option>
                    <option value="FirstPlug Hub North America">Hub Miami 🇺🇸</option>
                    <option value="FirstPlug Hub Europa">Hub Madrid 🇪🇸</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Equipo Incluido</label>
                  <input
                    type="text"
                    value={selectedDeviceName}
                    onChange={(e) => setSelectedDeviceName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors"
                >
                  Generar Guía de Envío
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
