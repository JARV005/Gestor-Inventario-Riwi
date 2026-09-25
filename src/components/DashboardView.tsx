import React, { useCallback, useEffect, useState } from 'react';
import type { CategoriaEquipo, EstadoEquipo, ResumenEquipos } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga } from './EstadoCarga';
import { 
  Laptop, 
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

/**
 * Un color por estado, **de `docs/paleta.md`**.
 *
 * Están los seis del enum: si mañana entra un séptimo, cae en el color por
 * defecto y se ve gris en vez de desaparecer del gráfico, que es lo que hacía
 * la lista anterior.
 */
const COLOR_ESTADO: Record<string, string> = {
  Disponible: '#57C99B', // ok
  Asignado: '#5B4FE0', // brand
  'En mantenimiento': '#E5C84B', // warn
  Reservado: '#DDA5F2', // info
  Prestado: '#7C71F0', // brand-light
  'De baja': '#9B9AB0', // ink-faint
};
const COLOR_ESTADO_POR_DEFECTO = '#9B9AB0';

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
   * devuelve grupos vacíos. Hoy es el caso de 'En mantenimiento', a cero.
   * Leerlo con un `.find()?.equipos` a secas daría `undefined`, que en la
   * barra de progreso sale como `NaN%` y en el texto como «undefined equipos».
   */
  const conteoDe = (estado: EstadoEquipo) =>
    resumen.por_estado.find((e) => e.estado === estado)?.equipos ?? 0;

  // TODO(6): sustituir estas cuentas por los 7 widgets de D3.
  const totalCount = resumen.total;
  const inUseCount = conteoDe('Asignado');
  const disponiblesCount = conteoDe('Disponible');
  const inMaintenanceCount = conteoDe('En mantenimiento');
  const pendingReturnCount = conteoDe('Reservado');

  // D13: no es un estado, es un traslado sin confirmar. Por eso NO entra en el
  // desglose de estados de abajo: un equipo que viaja ya está contado como
  // Asignado o Disponible, y sumarlo otra vez haría que las barras pasaran
  // del total.
  const inTransitCount = resumen.traslados_abiertos;

  const categoryChartData = resumen.por_categoria.map((c: { categoria: CategoriaEquipo; equipos: number }) => ({
    name: c.categoria,
    value: c.equipos,
  }));

  /**
   * El desglose sale del ENUM y de lo que devuelve la API, no de una lista
   * escrita a mano.
   *
   * ==========================================================================
   * LA LISTA A MANO SE DEJABA 24 EQUIPOS FUERA.
   * ==========================================================================
   *
   * Nombraba cuatro estados —«En Uso», «Disponible Hub», «Mantenimiento» y
   * «Reservado»— y el enum tiene SEIS. Los 15 equipos `De baja` y los 9
   * `Prestado` no aparecían en ninguna barra, y como las barras se dibujan
   * como porcentaje sobre el total, el gráfico ni siquiera llegaba al 100 %
   * sin que nada lo delatara.
   *
   * Además dos de esos nombres no eran del enum: «En Uso» es `Asignado` y
   * «Disponible Hub» es `Disponible` —lo de «hub» venía del SaaS del que salió
   * el prototipo—. Un estado que en pantalla se llama distinto que en la base
   * obliga a traducir de memoria cada vez que alguien compara las dos.
   *
   * Recorriendo `por_estado`, un estado nuevo en el enum aparece solo.
   */
  const statusChartData = resumen.por_estado
    .map((e: { estado: EstadoEquipo; equipos: number }) => ({
      name: e.estado,
      value: e.equipos,
      color: COLOR_ESTADO[e.estado] ?? COLOR_ESTADO_POR_DEFECTO,
    }))
    // Los estados a cero se filtran: una barra de longitud cero con su etiqueta
    // ocupa sitio para decir nada. El total de arriba ya los incluye.
    //
    // 'En Tránsito' NO entra: ya no es un estado (D13), y un equipo que viaja
    // sigue contado en el suyo. Sumarlo haría que las barras pasaran del total.
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      
      {/* Top Banner / Welcome Callout */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-900 shadow-sm relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full border border-blue-200 mb-2 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>Inventario de TI de RIWI y BBL Labs</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Gestión de inventario de TI
            </h1>
            {/* La frase llevaba pegado un comentario de trabajo entre
                paréntesis —«El texto anterior hablaba de licencias MDM…»— que
                se veía EN PANTALLA. Y enumeraba cinco sedes cuando son seis.
                Ahora el reparto lo cuenta el propio gráfico de abajo. */}
            <p className="text-sm text-slate-600 mt-1 max-w-2xl leading-relaxed">
              {totalCount} equipos registrados. El desglose por estado y por categoría sale de
              la base, no de un cálculo aparte.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onOpenOnboardingModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-all flex items-center gap-2"
            >
              <PackageCheck className="w-4 h-4" />
              <span>Entregar equipos</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Row */}
      {/* Una sola tarjeta desde que se retiraron las de valor, envíos y
          cumplimiento: sin datos que las llenaran, eran tres recuadros diciendo
          que faltaba algo. Con `lg:grid-cols-4` esta quedaba encogida en un
          cuarto de ancho con tres huecos al lado, que es peor que el hueco que
          se quitó. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Card 2: asignados frente a disponibles */}
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
              <span className="text-blue-700 font-semibold">{disponiblesCount} disponibles</span> sin asignar
            </div>
          </div>
        </div>

      </div>

      {/* Main Grid: Charts & Logistics Feed */}
      {/* Una columna, no tres.

          La derecha llevaba «Actividad de Envíos» y «Ocupación por sede», y las
          dos se retiraron: los traslados en curso ya se ven en Sedes, y la
          ocupación necesita una capacidad que ninguna sede tiene declarada.
          Dejar la rejilla de tres con la columna vacía encogería los dos
          gráficos que sí tienen datos a dos tercios del ancho, por hacer sitio
          a nada. */}
      <div className="grid grid-cols-1 gap-6">
        
        {/* Left Column: Recharts Visualization (Spans 2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Antes: inversión en hardware por departamento, en USD.
              Perdió las dos mitades a la vez — `costo` está vacío en las 186
              filas y `department` pasó a `empleados.area` (D3). */}

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

      </div>

    </div>
  );
};
