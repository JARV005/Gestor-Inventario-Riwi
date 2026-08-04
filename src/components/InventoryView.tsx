import React, { useState } from 'react';
import { Device, Employee, HubLocation, DeviceStatus, DeviceCategory } from '../types';
import { 
  Laptop, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  QrCode, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Clock, 
  MapPin, 
  UserCheck, 
  Wrench, 
  FileText, 
  ExternalLink,
  ChevronRight,
  X,
  BatteryCharging,
  Cpu,
  HardDrive,
  Copy,
  Check
} from 'lucide-react';

interface InventoryViewProps {
  devices: Device[];
  employees: Employee[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  onOpenNewDeviceModal: () => void;
  onGenerateHandoverDoc: (device: Device) => void;
  onRequestMaintenance: (device: Device) => void;
  onReassignDevice: (device: Device) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  devices,
  employees,
  searchTerm,
  setSearchTerm,
  onOpenNewDeviceModal,
  onGenerateHandoverDoc,
  onRequestMaintenance,
  onReassignDevice,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedLocation, setSelectedLocation] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [copiedSerial, setCopiedSerial] = useState(false);

  // Filter logic
  const filteredDevices = devices.filter((device) => {
    const matchesSearch = 
      device.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.assetTag.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.serialNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.model.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = selectedCategory === 'All' || device.category === selectedCategory;
    const matchesStatus = selectedStatus === 'All' || device.status === selectedStatus;
    const matchesLocation = selectedLocation === 'All' || device.location.includes(selectedLocation);

    return matchesSearch && matchesCategory && matchesStatus && matchesLocation;
  });

  // Export CSV function
  const handleExportCSV = () => {
    const headers = ['Etiqueta Activo', 'Nombre', 'Categoría', 'Marca', 'Modelo', 'Número Serie', 'Estado', 'Ubicación', 'Asignado A', 'Costo USD', 'Garantía'];
    const rows = filteredDevices.map(d => {
      const emp = employees.find(e => e.id === d.assignedTo);
      return [
        d.assetTag,
        `"${d.name}"`,
        d.category,
        d.brand,
        d.model,
        d.serialNumber,
        d.status,
        `"${d.location}"`,
        emp ? `"${emp.name}"` : 'N/A',
        d.costUSD,
        d.warrantyExpiry
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Inventario_TI_FirstPlug_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSerial(true);
    setTimeout(() => setCopiedSerial(false), 2000);
  };

  const getStatusBadge = (status: DeviceStatus) => {
    switch (status) {
      case 'In Use':
        return <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />En Uso</span>;
      case 'Available':
        return <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-blue-600" />Disponible</span>;
      case 'In Transit':
        return <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />En Tránsito</span>;
      case 'In Maintenance':
        return <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Mantenimiento</span>;
      case 'Pending Return':
        return <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" />Por Retirar</span>;
      default:
        return <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 text-[11px] px-2 py-0.5 rounded-full font-medium">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Main Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Inventario de Equipos TI
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full font-semibold">
              {filteredDevices.length} Equipos
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Control de hardware, especificaciones técnicas, MDM y asignación por colaborador.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
          <button
            onClick={onOpenNewDeviceModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Registrar Equipo</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar activo, serie, marca..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
            />
          </div>

          {/* Category Select */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-600"
            >
              <option value="All">Todas las Categorías</option>
              <option value="Laptop">Laptops</option>
              <option value="Monitor">Monitores</option>
              <option value="Mobile">Celulares / Móviles</option>
              <option value="Peripherals">Periféricos y Ergonomía</option>
            </select>
          </div>

          {/* Status Select */}
          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-600"
            >
              <option value="All">Todos los Estados</option>
              <option value="In Use">En Uso (Asignado)</option>
              <option value="Available">Disponible en Hub</option>
              <option value="In Transit">En Tránsito (Envío)</option>
              <option value="In Maintenance">En Mantenimiento</option>
              <option value="Pending Return">Por Retirar (Baja)</option>
            </select>
          </div>

          {/* Location / Hub Select */}
          <div>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-600"
            >
              <option value="All">Todas las Ubicaciones / Hubs</option>
              <option value="CDMX">Hub Ciudad de México 🇲🇽</option>
              <option value="Bogotá">Hub Bogotá 🇨🇴</option>
              <option value="Buenos Aires">Hub Buenos Aires 🇦🇷</option>
              <option value="Miami">Hub Miami 🇺🇸</option>
              <option value="Madrid">Hub Madrid 🇪🇸</option>
              <option value="Empleado Remoto">Empleado Remoto 🏠</option>
            </select>
          </div>

        </div>

        {/* View mode toggle */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
          <span>
            Mostrando <strong className="text-slate-900">{filteredDevices.length}</strong> de {devices.length} equipos
          </span>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-white text-blue-600 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Tabla
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-white text-blue-600 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Tarjetas
            </button>
          </div>
        </div>
      </div>

      {/* Main Table View */}
      {viewMode === 'table' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">Activo / Equipo</th>
                  <th className="px-4 py-3">Categoría</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Asignado A</th>
                  <th className="px-4 py-3">Ubicación / Hub</th>
                  <th className="px-4 py-3">MDM / Salud</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredDevices.map((device) => {
                  const assignedEmployee = employees.find((e) => e.id === device.assignedTo);
                  return (
                    <tr 
                      key={device.id} 
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      onClick={() => setSelectedDevice(device)}
                    >
                      {/* Name & Tag */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <img 
                            src={device.imageUrl} 
                            alt={device.name}
                            className="w-10 h-10 rounded-lg object-cover bg-slate-100 border border-slate-200 shrink-0" 
                          />
                          <div>
                            <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                              {device.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5 mt-0.5">
                              <span className="text-blue-600 font-semibold">{device.assetTag}</span>
                              <span>•</span>
                              <span>{device.serialNumber}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5">
                        <span className="font-medium text-slate-900">{device.category}</span>
                        <div className="text-[10px] text-slate-500">{device.brand}</div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        {getStatusBadge(device.status)}
                      </td>

                      {/* Assigned Employee */}
                      <td className="px-4 py-3.5">
                        {assignedEmployee ? (
                          <div className="flex items-center gap-2">
                            <img 
                              src={assignedEmployee.avatarUrl} 
                              alt={assignedEmployee.name}
                              className="w-6 h-6 rounded-full object-cover shrink-0 border border-slate-200" 
                            />
                            <div>
                              <div className="font-semibold text-slate-900">{assignedEmployee.name}</div>
                              <div className="text-[10px] text-slate-500">{assignedEmployee.department}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Sin asignación (En Hub)</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="px-4 py-3.5 text-slate-700">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span className="truncate max-w-[150px]">{device.location}</span>
                        </div>
                      </td>

                      {/* MDM / Health */}
                      <td className="px-4 py-3.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-[11px]">
                            <ShieldCheck className={`w-3.5 h-3.5 ${device.mdmEnrolled ? 'text-teal-600' : 'text-slate-400'}`} />
                            <span className={device.mdmEnrolled ? 'text-teal-700 font-medium' : 'text-slate-400'}>
                              {device.mdmEnrolled ? device.mdmProvider : 'No Enrolled'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-emerald-500 h-full rounded-full" 
                                style={{ width: `${device.healthScore}%` }} 
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 font-medium">{device.healthScore}%</span>
                          </div>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setSelectedDevice(device)}
                          className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-blue-600 rounded-lg text-[11px] font-semibold border border-slate-200 transition-colors inline-flex items-center gap-1"
                        >
                          <span>Ficha</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Cards View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDevices.map((device) => {
            const assignedEmployee = employees.find((e) => e.id === device.assignedTo);
            return (
              <div
                key={device.id}
                onClick={() => setSelectedDevice(device)}
                className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-500 transition-all cursor-pointer space-y-3 shadow-sm group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <img 
                      src={device.imageUrl} 
                      alt={device.name}
                      className="w-12 h-12 rounded-xl object-cover bg-slate-100 border border-slate-200 shrink-0" 
                    />
                    <div>
                      <span className="text-[10px] text-blue-700 font-mono font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                        {device.assetTag}
                      </span>
                      <h3 className="font-bold text-slate-900 text-sm mt-1 group-hover:text-blue-600 transition-colors">
                        {device.name}
                      </h3>
                      <p className="text-[11px] text-slate-500">{device.brand} • {device.model}</p>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  {getStatusBadge(device.status)}
                  <span className="font-bold text-slate-900">${device.costUSD} USD</span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Asignación Actual</div>
                  {assignedEmployee ? (
                    <div className="flex items-center gap-2">
                      <img src={assignedEmployee.avatarUrl} className="w-5 h-5 rounded-full object-cover" />
                      <span className="font-medium text-slate-800">{assignedEmployee.name}</span>
                    </div>
                  ) : (
                    <span className="text-slate-500 italic">Almacenado en {device.location}</span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span className="flex items-center gap-1 text-slate-700">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                    {device.mdmEnrolled ? device.mdmProvider : 'Sin MDM'}
                  </span>
                  <span className="text-blue-600 font-semibold hover:underline">Ver detalles →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Device Detail Drawer / Modal */}
      {selectedDevice && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-end p-2 sm:p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl h-full max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl relative text-slate-900">
            
            {/* Close Button */}
            <button
              onClick={() => setSelectedDevice(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Top Device Header */}
            <div className="flex items-start gap-4">
              <img 
                src={selectedDevice.imageUrl} 
                alt={selectedDevice.name} 
                className="w-20 h-20 rounded-2xl object-cover bg-slate-100 border border-slate-200 shrink-0"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                    {selectedDevice.assetTag}
                  </span>
                  {getStatusBadge(selectedDevice.status)}
                </div>
                <h2 className="text-xl font-bold text-slate-900">{selectedDevice.name}</h2>
                <p className="text-xs text-slate-500">{selectedDevice.brand} • {selectedDevice.model}</p>
              </div>
            </div>

            {/* Serial Number & Copy */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-semibold block">Número de Serie Oficial</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{selectedDevice.serialNumber}</span>
              </div>
              <button
                onClick={() => copyToClipboard(selectedDevice.serialNumber)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-colors text-xs font-medium shadow-xs"
              >
                {copiedSerial ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-blue-600" />}
                <span>{copiedSerial ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>

            {/* Spec Breakdown */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-blue-600" />
                Especificaciones Técnicas
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Procesador / CPU</span>
                  <span className="font-medium text-slate-800">{selectedDevice.specs.cpu}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Memoria RAM</span>
                  <span className="font-medium text-slate-800">{selectedDevice.specs.ram}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Almacenamiento SSD</span>
                  <span className="font-medium text-slate-800">{selectedDevice.specs.storage}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Sistema Operativo</span>
                  <span className="font-medium text-slate-800">{selectedDevice.specs.os}</span>
                </div>
              </div>
            </div>

            {/* Security & MDM Status */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-teal-600" />
                Seguridad & MDM Compliance
              </h3>
              <div className="grid grid-cols-3 gap-2 text-xs text-center">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">MDM Enrolled</span>
                  <span className={`font-bold ${selectedDevice.mdmEnrolled ? 'text-teal-700' : 'text-slate-400'}`}>
                    {selectedDevice.mdmEnrolled ? selectedDevice.mdmProvider : 'Inactivo'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Encriptación</span>
                  <span className={`font-bold ${selectedDevice.encrypted ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {selectedDevice.encrypted ? 'FileVault OK' : 'Desactivada'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Salud Batería</span>
                  <span className="font-bold text-blue-600">
                    {selectedDevice.batteryHealth ? `${selectedDevice.batteryHealth}%` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Assigned Employee Details */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-blue-600" />
                Asignación & Custodia
              </h3>
              {selectedDevice.assignedTo ? (
                (() => {
                  const emp = employees.find((e) => e.id === selectedDevice.assignedTo);
                  return (
                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3">
                        <img src={emp?.avatarUrl} className="w-10 h-10 rounded-full object-cover border border-slate-200" />
                        <div>
                          <div className="font-bold text-slate-900">{emp?.name}</div>
                          <div className="text-[11px] text-slate-500">{emp?.role} • {emp?.department}</div>
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500">Desde {selectedDevice.assignedDate}</span>
                    </div>
                  );
                })()
              ) : (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs text-slate-500 text-center">
                  Equipo actualmente disponible en <strong className="text-slate-900">{selectedDevice.location}</strong>.
                </div>
              )}
            </div>

            {/* Actions for this device */}
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <button
                onClick={() => {
                  onGenerateHandoverDoc(selectedDevice);
                  setSelectedDevice(null);
                }}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-xl shadow transition-all flex items-center justify-center gap-2"
              >
                <FileText className="w-4 h-4" />
                <span>Generar Acta de Entrega (PDF / Firma)</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    onReassignDevice(selectedDevice);
                    setSelectedDevice(null);
                  }}
                  className="py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                  <span>Reasignar Equipo</span>
                </button>

                <button
                  onClick={() => {
                    onRequestMaintenance(selectedDevice);
                    setSelectedDevice(null);
                  }}
                  className="py-2 bg-white hover:bg-slate-50 text-amber-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Wrench className="w-3.5 h-3.5 text-amber-600" />
                  <span>Solicitar Mantenimiento</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
