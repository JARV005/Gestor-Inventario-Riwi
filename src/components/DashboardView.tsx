import React from 'react';
import { Device, Employee, Hub, LogisticsTicket } from '../types';
import { 
  Laptop, 
  DollarSign, 
  Building, 
  Truck, 
  ShieldCheck, 
  Wrench, 
  Plus, 
  PackageCheck, 
  ArrowRight, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  MapPin,
  TrendingUp,
  AlertTriangle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';

interface DashboardViewProps {
  devices: Device[];
  employees: Employee[];
  hubs: Hub[];
  logisticsTickets: LogisticsTicket[];
  onOpenNewDeviceModal: () => void;
  onOpenOnboardingModal: () => void;
  onOpenAiCopilot: () => void;
  setActiveTab: (tab: string) => void;
}

const COLORS = ['#06b6d4', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6'];

export const DashboardView: React.FC<DashboardViewProps> = ({
  devices,
  employees,
  hubs,
  logisticsTickets,
  onOpenNewDeviceModal,
  onOpenOnboardingModal,
  onOpenAiCopilot,
  setActiveTab,
}) => {
  // Calculations
  const totalValueUSD = devices.reduce((sum, d) => sum + d.costUSD, 0);
  const totalCount = devices.length;
  const inUseCount = devices.filter((d) => d.status === 'In Use').length;
  const availableInHubs = devices.filter((d) => d.status === 'Available').length;
  const inTransitCount = devices.filter((d) => d.status === 'In Transit').length;
  const inMaintenanceCount = devices.filter((d) => d.status === 'In Maintenance').length;
  const pendingReturnCount = devices.filter((d) => d.status === 'Pending Return').length;

  const mdmEnrolledCount = devices.filter((d) => d.mdmEnrolled).length;
  const mdmPercentage = Math.round((mdmEnrolledCount / (totalCount || 1)) * 100);

  // Category chart data
  const categoryMap: Record<string, number> = {};
  devices.forEach((d) => {
    categoryMap[d.category] = (categoryMap[d.category] || 0) + 1;
  });
  const categoryChartData = Object.keys(categoryMap).map((cat) => ({
    name: cat,
    value: categoryMap[cat],
  }));

  // Department cost data
  const deptCostMap: Record<string, number> = {};
  devices.forEach((d) => {
    const dept = d.department || 'General';
    deptCostMap[dept] = (deptCostMap[dept] || 0) + d.costUSD;
  });
  const deptChartData = Object.keys(deptCostMap).map((dept) => ({
    department: dept,
    costUSD: deptCostMap[dept],
  }));

  // Status breakdown data
  const statusChartData = [
    { name: 'En Uso', value: inUseCount, color: '#10b981' },
    { name: 'Disponible Hub', value: availableInHubs, color: '#06b6d4' },
    { name: 'En Tránsito', value: inTransitCount, color: '#6366f1' },
    { name: 'Mantenimiento', value: inMaintenanceCount, color: '#f59e0b' },
    { name: 'Por Retirar', value: pendingReturnCount, color: '#ec4899' },
  ].filter((item) => item.value > 0);

  return (
    <div className="space-y-6">
      
      {/* Top Banner / Welcome Callout */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-900 shadow-sm relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full border border-blue-200 mb-2 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>Plataforma ITAM para equipos distribuidos</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Gestión de Inventario TI Global
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl leading-relaxed">
              Monitorea activos de hardware, envíos de onboarding/offboarding, licencias MDM y almacenamiento en hubs de LatAm, EE.UU. y Europa.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onOpenOnboardingModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-all flex items-center gap-2"
            >
              <PackageCheck className="w-4 h-4" />
              <span>Enviar Kit Onboarding</span>
            </button>
            <button
              onClick={onOpenAiCopilot}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-lg border border-slate-200 transition-colors flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Consultar Copilot IA</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Valor del Inventario */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm relative overflow-hidden transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Valor Total Inventario</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              ${totalValueUSD.toLocaleString('en-US')} <span className="text-xs font-normal text-slate-500">USD</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{totalCount} equipos valorados y en regla</span>
            </div>
          </div>
        </div>

        {/* Card 2: Equipos en Uso vs Hubs */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Distribución Activa</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Laptop className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {inUseCount} <span className="text-xs font-normal text-slate-500">Asignados</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-600 font-medium">
              <span className="text-blue-700 font-semibold">{availableInHubs} disponibles</span> en Almacén
            </div>
          </div>
        </div>

        {/* Card 3: Logística en Camino */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Envíos y Retiros</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {logisticsTickets.length} <span className="text-xs font-normal text-slate-500">Envíos DHL/FedEx</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-indigo-700 font-medium">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              <span>{inTransitCount} en tránsito hacia destino</span>
            </div>
          </div>
        </div>

        {/* Card 4: Seguridad & MDM Enrolled */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cumplimiento MDM</span>
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900">
              {mdmPercentage}% <span className="text-xs font-normal text-slate-500">Inscriptos</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-teal-700 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
              <span>Jamf, Kandji & Intune Activos</span>
            </div>
          </div>
        </div>

      </div>

      {/* Main Grid: Charts & Logistics Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Recharts Visualization (Spans 2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Chart 1: Asset Value by Department */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Inversión en Hardware por Departamento</h3>
                <p className="text-xs text-slate-500">Distribución del presupuesto de equipos acumulado en USD</p>
              </div>
              <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                Total ${totalValueUSD.toLocaleString('en-US')}
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="department" stroke="#64748b" fontSize={12} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                    formatter={(value: any) => [`$${Number(value).toLocaleString()} USD`, 'Costo Total']}
                  />
                  <Bar dataKey="costUSD" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Category & Status Breakdown (Side by Side inside left col) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Pie Chart: Equipment by Category */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-1">Equipos por Categoría</h3>
              <p className="text-xs text-slate-500 mb-4">Laptops, Monitores, Celulares y Periféricos</p>

              <div className="h-48 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {categoryChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={['#2563eb', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6'][index % 6]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#cbd5e1', borderRadius: '8px', color: '#0f172a' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100">
                {categoryChartData.map((item, idx) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ['#2563eb', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6'][idx % 6] }} />
                    <span className="text-slate-600 truncate">{item.name}:</span>
                    <span className="font-bold text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Status Breakdown List */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 mb-1">Estado Operativo</h3>
                <p className="text-xs text-slate-500 mb-4">Visibilidad en tiempo real del ciclo de vida</p>

                <div className="space-y-3">
                  {statusChartData.map((st) => (
                    <div key={st.name} className="space-y-1">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-700 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />
                          {st.name}
                        </span>
                        <span className="text-slate-900 font-bold">{st.value} equipos</span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full" 
                          style={{ 
                            width: `${Math.round((st.value / (totalCount || 1)) * 100)}%`,
                            backgroundColor: st.color 
                          }} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setActiveTab('inventory')}
                className="mt-4 w-full py-2 bg-slate-50 hover:bg-slate-100 text-blue-600 text-xs font-semibold rounded-lg border border-slate-200 transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Ver Tabla Completa de Inventario</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>

        </div>

        {/* Right Column: Active Logistics Feed & Hubs Overview (Spans 1 col) */}
        <div className="space-y-6">
          
          {/* Active Logistics Feed */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-600" />
                  Actividad de Envíos
                </h3>
                <p className="text-xs text-slate-500">Rastreo DHL & FedEx en tiempo real</p>
              </div>
              <button 
                onClick={() => setActiveTab('logistics')}
                className="text-xs text-blue-600 hover:underline font-semibold"
              >
                Ver todos
              </button>
            </div>

            <div className="space-y-3">
              {logisticsTickets.map((ticket) => (
                <div 
                  key={ticket.id}
                  className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 hover:bg-slate-100/80 transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${
                        ticket.status === 'In Transit' ? 'bg-indigo-500 animate-pulse' :
                        ticket.status === 'Delivered' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`} />
                      {ticket.type}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      {ticket.id}
                    </span>
                  </div>

                  <div className="text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">{ticket.employeeName}</span>
                    <p className="text-[11px] text-slate-500 truncate">{ticket.deviceNames.join(', ')}</p>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-200">
                    <span className="flex items-center gap-1 text-slate-700 font-medium">
                      <MapPin className="w-3 h-3 text-blue-600" />
                      {ticket.courier}
                    </span>
                    <span className="text-blue-700 font-semibold">
                      Est. {ticket.estimatedDelivery}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Regional Hubs Overview */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building className="w-4 h-4 text-emerald-600" />
                Hubs y Almacenamiento
              </h3>
              <button 
                onClick={() => setActiveTab('logistics')}
                className="text-xs text-blue-600 hover:underline font-semibold"
              >
                Gestionar Hubs
              </button>
            </div>

            <div className="space-y-3">
              {hubs.slice(0, 4).map((hub) => {
                const percentage = Math.round((hub.currentItems / hub.capacityItems) * 100);
                return (
                  <div key={hub.id} className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <span className="text-base">{hub.flag}</span>
                        {hub.city}
                      </span>
                      <span className="text-[11px] text-slate-600 font-medium">
                        {hub.currentItems} / {hub.capacityItems} ítems
                      </span>
                    </div>

                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          percentage > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
