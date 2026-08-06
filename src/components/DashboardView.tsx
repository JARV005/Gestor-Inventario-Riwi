import React, { useCallback, useEffect, useState } from 'react';
import type { CategoriaEquipo, EstadoEquipo, ResumenEquipos } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga } from './EstadoCarga';
import { PendienteEtapa6 } from './PendienteEtapa6';
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
  onOpenNewDeviceModal: () => void;
  onOpenOnboardingModal: () => void;
  setActiveTab: (tab: string) => void;
}

const COLORS = ['#06b6d4', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6'];

export const DashboardView: React.FC<DashboardViewProps> = ({
  onOpenNewDeviceModal,
  onOpenOnboardingModal,
  setActiveTab,
}) => {
  const [resumen, setResumen] = useState<ResumenEquipos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setResumen(await api.resumenEquipos());
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, String(e)));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando) return <Cargando que="el resumen del inventario" />;
  if (error) {
    return <ErrorDeCarga error={error} que="el resumen del inventario" onReintentar={cargar} />;
  }
  if (!resumen) return null;

  /**
   * Un estado sin ninguna fila **no viene** en la respuesta: `GROUP BY` no
   * devuelve grupos vacíos. Hoy es el caso de 'En tránsito' y 'En
   * mantenimiento', las dos a cero. Leerlo con un `.find()?.equipos` a secas
   * daría `undefined`, que en la barra de progreso sale como `NaN%` y en el
   * texto como «undefined equipos».
   */
  const conteoDe = (estado: EstadoEquipo) =>
    resumen.por_estado.find((e) => e.estado === estado)?.equipos ?? 0;

  // TODO(6): sustituir estas cuentas por los 7 widgets de D3.
  const totalCount = resumen.total;
  const inUseCount = conteoDe('Asignado');
  const availableInHubs = conteoDe('Disponible');
  const inTransitCount = conteoDe('En tránsito');
  const inMaintenanceCount = conteoDe('En mantenimiento');
  const pendingReturnCount = conteoDe('Reservado');

  const categoryChartData = resumen.por_categoria.map((c: { categoria: CategoriaEquipo; equipos: number }) => ({
    name: c.categoria,
    value: c.equipos,
  }));

  // Los estados a cero se filtran: una barra de longitud cero con su etiqueta
  // ocupa sitio para decir nada. El total de arriba ya los incluye.
  const statusChartData = [
    { name: 'En Uso', value: inUseCount, color: '#10b981' },
    { name: 'Disponible Hub', value: availableInHubs, color: '#06b6d4' },
    { name: 'En Tránsito', value: inTransitCount, color: '#6366f1' },
    { name: 'Mantenimiento', value: inMaintenanceCount, color: '#f59e0b' },
    { name: 'Reservado', value: pendingReturnCount, color: '#ec4899' },
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
              Inventario de {totalCount} equipos repartidos entre Medellín, Barranquilla, Cartagena, Bogotá y remoto. (El texto anterior hablaba de licencias MDM y de sedes en EE.UU. y Europa: ninguna de las dos cosas existe.)
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
            <PendienteEtapa6
              clase="pendiente"
              motivo="El Excel no trae ni un costo cargado. El campo existe en la BD; el widget vuelve cuando haya datos (D3)."
            />
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
              {inTransitCount} <span className="text-xs font-normal text-slate-500">en tránsito</span>
            </div>
            <PendienteEtapa6
              clase="pendiente"
              motivo="El detalle del traslado —transportadora, guía, origen y destino— es un movimiento y llega en la etapa 5 (D1)."
            />
          </div>
        </div>

        {/* Card 4: Seguridad & MDM Enrolled */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cumplimiento</span>
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <PendienteEtapa6
              clase="retirado"
              motivo="No hay MDM. El widget graficaba un dato inventado, y eso es peor que no tener widget (D3). No vuelve."
            />
          </div>
        </div>

      </div>

      {/* Main Grid: Charts & Logistics Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Recharts Visualization (Spans 2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Antes: inversión en hardware por departamento, en USD.
              Perdió las dos mitades a la vez — `costo` está vacío en las 186
              filas y `department` pasó a `empleados.area` (D3). */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="text-sm font-bold text-slate-900">Inversión en hardware por área</h3>
              <p className="text-xs text-slate-500">Distribución del costo de los equipos</p>
            </div>
            <PendienteEtapa6
              clase="pendiente"
              motivo="Ninguna de las 186 filas del Excel trae costo. El campo existe en la BD y el gráfico vuelve cuando haya datos que graficar (D3)."
            />
          </div>

          {/* Chart 2: Category & Status Breakdown (Side by Side inside left col) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Pie Chart: Equipment by Category */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-1">Equipos por Categoría</h3>
              <p className="text-xs text-slate-500 mb-4">Reparto real de las {totalCount} filas del inventario</p>

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
                <p className="text-xs text-slate-500">Traslados de equipos entre sedes</p>
              </div>
              <button 
                onClick={() => setActiveTab('logistics')}
                className="text-xs text-blue-600 hover:underline font-semibold"
              >
                Ver todos
              </button>
            </div>

            {/* Antes: lista de envíos con transportadora, guía y fecha estimada,
                toda inventada por el prototipo. */}
            <PendienteEtapa6
              clase="pendiente"
              motivo="Un traslado en curso es un movimiento de tipo 'Traslado' sin fecha de confirmación (D1). La tabla ya tiene transportadora, guía y fecha estimada desde la migración 0000; los endpoints llegan en la etapa 5."
            />
          </div>

          {/* Regional Hubs Overview */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building className="w-4 h-4 text-emerald-600" />
                Ocupación por sede
              </h3>
              <button
                onClick={() => setActiveTab('logistics')}
                className="text-xs text-blue-600 hover:underline font-semibold"
              >
                Ver sedes
              </button>
            </div>

            {/* Antes: barra de ocupación por hub, sobre una capacidad inventada.
                Ninguna sede tiene capacidad declarada: no existía el dato. El
                conteo de equipos por sede sí es real y es el widget 3 de D3,
                que llega en la etapa 6. Mientras tanto está en SedesView. */}
            <PendienteEtapa6
              clase="pendiente"
              motivo="Las sedes no tienen capacidad declarada, así que no hay porcentaje que calcular. El conteo de equipos por sede es el widget 3 de D3 y llega en la etapa 6."
            />
          </div>

        </div>

      </div>

    </div>
  );
};
