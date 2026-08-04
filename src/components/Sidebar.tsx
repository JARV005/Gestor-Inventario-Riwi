import React from 'react';
import { 
  LayoutDashboard, 
  Laptop, 
  Users, 
  Truck, 
  ShoppingBag, 
  ShieldCheck, 
  Wrench, 
  FileText,
  Building,
  Sparkles,
  ArrowRightLeft
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  pendingLogisticsCount: number;
  maintenanceCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  pendingLogisticsCount,
  maintenanceCount,
}) => {
  const menuItems = [
    {
      id: 'dashboard',
      label: 'Vista General',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'inventory',
      label: 'Inventario de Equipos',
      icon: Laptop,
      badge: null,
    },
    {
      id: 'employees',
      label: 'Colaboradores',
      icon: Users,
      badge: null,
    },
    {
      id: 'logistics',
      label: 'Logística y Hubs',
      icon: Truck,
      badge: pendingLogisticsCount > 0 ? `${pendingLogisticsCount} activos` : null,
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    },
    {
      id: 'catalog',
      label: 'Catálogo & Tienda TI',
      icon: ShoppingBag,
      badge: 'Nuevo',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    },
    {
      id: 'licenses',
      label: 'Licencias & MDM',
      icon: ShieldCheck,
      badge: null,
    },
    {
      id: 'maintenance',
      label: 'Mantenimiento',
      icon: Wrench,
      badge: maintenanceCount > 0 ? `${maintenanceCount}` : null,
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    },
    {
      id: 'documents',
      label: 'Generador de Actas',
      icon: FileText,
      badge: null,
    },
  ];

  return (
    <aside className="w-64 bg-[#0F172A] border-r border-slate-800 flex flex-col justify-between shrink-0 min-h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        {/* Brand Header */}
        <div className="pb-2 flex items-center gap-3 px-2">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shadow-sm">
            <div className="w-4 h-4 bg-white rounded-sm"></div>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">FirstPlug</span>
        </div>

        <div className="space-y-1">
          <div className="px-3 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Navegación
          </div>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Warehouse Hub Status Widget */}
      <div className="pt-4 border-t border-slate-800 px-2 space-y-3">
        <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-blue-400" />
              Hubs Regionales
            </span>
            <span className="text-[10px] text-emerald-300 font-bold bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30">
              5 Operativos
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            México, Colombia, Argentina, EE.UU. y España.
          </p>
          <button
            onClick={() => setActiveTab('logistics')}
            className="w-full text-center py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded-md border border-slate-700 transition-colors flex items-center justify-center gap-1"
          >
            <ArrowRightLeft className="w-3 h-3 text-blue-400" />
            <span>Ver Inventario en Hubs</span>
          </button>
        </div>

        {/* FirstPlug Support Footer */}
        <div className="text-[10px] text-slate-500 text-center px-1">
          FirstPlug Platform • Global ITAM
        </div>
      </div>
    </aside>
  );
};
