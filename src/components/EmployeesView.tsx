import React, { useState } from 'react';
import type { Empleado, Equipo } from '../types';
import { 
  Users, 
  Search, 
  Plus, 
  PackageCheck, 
  Truck, 
  UserX, 
  MapPin, 
  Mail, 
  Phone, 
  Laptop, 
  Calendar, 
  CheckCircle2, 
  X,
  Sparkles,
  ShieldCheck,
  Building
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface EmployeesViewProps {
  empleados: Empleado[];
  equipos: Equipo[];
  onOpenOnboardingModal: () => void;
  onOpenOffboardingModal: (empleado: Empleado) => void;
  onAddEmpleado: (emp: Empleado) => void;
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  empleados,
  equipos,
  onOpenOnboardingModal,
  onOpenOffboardingModal,
  onAddEmpleado,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);

  // New Employee Form State
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpRole, setNewEmpRole] = useState('');
  const [newEmpDept, setNewEmpDept] = useState('Engineering');
  const [newEmpCountry, setNewEmpCountry] = useState('México');
  const [newEmpCity, setNewEmpCity] = useState('Ciudad de México');
  const [newEmpAddress, setNewEmpAddress] = useState('');
  const [newEmpPhone, setNewEmpPhone] = useState('');

  // Filter empleados
  const filteredEmployees = empleados.filter((e) => {
    const matchesSearch = 
      e.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.email_corporativo ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.cargo ?? '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesDept = selectedDept === 'All' || (e.area ?? '') === selectedDept;
    const matchesStatus = selectedStatus === 'All' || e.estado === selectedStatus;

    return matchesSearch && matchesDept && matchesStatus;
  });

  const handleCreateEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName || !newEmpEmail) return;

    const ahora = new Date().toISOString();
    const newEmp: Empleado = {
      id: `emp-${Date.now().toString().slice(-4)}`,
      nombre: newEmpName,
      cedula: null,
      email_corporativo: newEmpEmail,
      cargo: newEmpRole || null,
      area: newEmpDept || null,
      sede_id: null,
      estado: 'Onboarding',
      fecha_ingreso: ahora.slice(0, 10),
      telefono: newEmpPhone || null,
      direccion: newEmpAddress || null,
      activo: true,
      created_at: ahora,
      updated_at: ahora,
    };

    onAddEmpleado(newEmp);
    setShowAddEmployeeModal(false);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    
    // Reset form
    setNewEmpName('');
    setNewEmpEmail('');
    setNewEmpRole('');
    setNewEmpAddress('');
  };

  const getStatusBadge = (status: Empleado['estado']) => {
    switch (status) {
      case 'Activo':
        return <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Activo</span>;
      case 'Onboarding':
        return <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />Onboarding</span>;
      case 'Offboarding':
        return <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 text-[11px] px-2 py-0.5 rounded-full font-medium"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" />Offboarding</span>;
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
            Colaboradores & Asignaciones
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full font-semibold">
              {empleados.length} Integrantes
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Control de equipos de cómputo por empleado, envíos de onboarding y retiros de offboarding.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenOnboardingModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-all"
          >
            <PackageCheck className="w-4 h-4" />
            <span>Enviar Kit de Cómputo</span>
          </button>

          <button
            onClick={() => setShowAddEmployeeModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo Colaborador</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, correo o puesto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-colors"
          />
        </div>

        <div>
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-600"
          >
            <option value="All">Todos los Departamentos</option>
            <option value="Engineering">Engineering</option>
            <option value="Product">Product</option>
            <option value="Marketing">Marketing</option>
            <option value="HR & Ops">HR & Operations</option>
          </select>
        </div>

        <div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-600"
          >
            <option value="All">Todos los Estados</option>
            <option value="Active">Activos</option>
            <option value="Onboarding">Onboarding</option>
            <option value="Offboarding">Offboarding</option>
          </select>
        </div>
      </div>

      {/* Employee Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEmployees.map((emp) => {
          // D2: la relación vive solo en equipos.empleado_id. `assignedDeviceIds`
          // desaparecio del tipo; esto se recalcula desde el lado de equipos.
          const equiposAsignados = equipos.filter((d) => d.empleado_id === emp.id);

          return (
            <div
              key={emp.id}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors space-y-4 flex flex-col justify-between shadow-sm"
            >
              <div className="space-y-3">
                
                {/* Employee Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {/* D3: no hay fotos. Iniciales en lugar de un avatar de banco de imágenes. */}
                    <div className="w-12 h-12 rounded-full bg-brand/10 text-brand grid place-items-center font-bold text-sm shrink-0 border-2 border-slate-200">
                      {emp.nombre.split(" ").slice(0, 2).map((p) => p[0]).join("")}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">{emp.nombre}</h3>
                      <p className="text-[11px] text-blue-600 font-semibold">{emp.cargo ?? '—'}</p>
                      <p className="text-[10px] text-slate-500">{emp.area ?? '—'}</p>
                    </div>
                  </div>
                  {getStatusBadge(emp.estado)}
                </div>

                {/* Location & Contact Info */}
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-700 text-[11px]">
                    <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>{emp.cedula ?? 'Sin cédula'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-500 text-[11px] truncate">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{emp.email_corporativo ?? '—'}</span>
                  </div>
                </div>

                {/* Hardware Assigned list */}
                <div className="space-y-1.5">
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider flex items-center justify-between">
                    <span>Equipos Asignados ({equiposAsignados.length})</span>
                  </div>

                  {equiposAsignados.length > 0 ? (
                    <div className="space-y-1.5">
                      {equiposAsignados.map((d) => (
                        <div key={d.id} className="bg-slate-50 p-2 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 truncate">
                            <Laptop className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span className="font-medium text-slate-800 truncate">{d.nombre_equipo ?? d.etiqueta ?? ([d.marca, d.modelo].filter(Boolean).join(' ') || 'Equipo')}</span>
                          </div>
                          <span className="text-[10px] font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 shrink-0">
                            {d.etiqueta ?? d.serial ?? '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-dashed border-slate-200 text-[11px] text-slate-400 italic text-center">
                      Sin equipos asignados actualmente.
                    </div>
                  )}
                </div>

              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                <button
                  onClick={onOpenOnboardingModal}
                  className="flex-1 py-1.5 bg-white hover:bg-slate-50 text-blue-600 text-xs font-semibold rounded-lg border border-slate-200 transition-colors flex items-center justify-center gap-1 shadow-xs"
                >
                  <PackageCheck className="w-3.5 h-3.5" />
                  <span>Enviar Kit</span>
                </button>

                {emp.estado !== 'Offboarding' && (
                  <button
                    onClick={() => onOpenOffboardingModal(emp)}
                    className="py-1.5 px-3 bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-500 text-xs font-semibold rounded-lg border border-slate-200 transition-colors flex items-center justify-center gap-1 shadow-xs"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>Retiro</span>
                  </button>
                )}
              </div>

            </div>
          );
        })}
      </div>

      {/* New Employee Modal */}
      {showAddEmployeeModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
            <button
              onClick={() => setShowAddEmployeeModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Registrar Nuevo Colaborador
              </h2>
              <p className="text-xs text-slate-500">
                Agrega al nuevo integrante para asignarle equipos y preparar su Kit de Onboarding.
              </p>
            </div>

            <form onSubmit={handleCreateEmployee} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Gabriel Morales"
                  value={newEmpName}
                  onChange={(e) => setNewEmpName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Correo Electrónico *</label>
                  <input
                    type="email"
                    required
                    placeholder="gabriel@empresa.com"
                    value={newEmpEmail}
                    onChange={(e) => setNewEmpEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Puesto / Rol</label>
                  <input
                    type="text"
                    placeholder="Ej. Senior Frontend Developer"
                    value={newEmpRole}
                    onChange={(e) => setNewEmpRole(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Departamento</label>
                  <select
                    value={newEmpDept}
                    onChange={(e) => setNewEmpDept(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-blue-600"
                  >
                    <option value="Engineering">Engineering</option>
                    <option value="Product">Product</option>
                    <option value="Marketing">Marketing</option>
                    <option value="HR & Ops">HR & Operations</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">País</label>
                  <select
                    value={newEmpCountry}
                    onChange={(e) => setNewEmpCountry(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-blue-600"
                  >
                    <option value="México">México 🇲🇽</option>
                    <option value="Colombia">Colombia 🇨🇴</option>
                    <option value="Argentina">Argentina 🇦🇷</option>
                    <option value="EE.UU.">EE.UU. 🇺🇸</option>
                    <option value="España">España 🇪🇸</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Dirección Completa de Envío</label>
                <input
                  type="text"
                  placeholder="Calle, Número, Colonia, Ciudad, Código Postal"
                  value={newEmpAddress}
                  onChange={(e) => setNewEmpAddress(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddEmployeeModal(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors"
                >
                  Guardar y Continuar
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
