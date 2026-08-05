import React from 'react';
import {
  LayoutDashboard,
  Laptop,
  Users,
  Truck,
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
      badgeColor: 'bg-info text-ink border-transparent',
    },
    {
      id: 'maintenance',
      label: 'Mantenimiento',
      icon: Wrench,
      badge: maintenanceCount > 0 ? `${maintenanceCount}` : null,
      badgeColor: 'bg-warn text-ink border-transparent',
    },
    {
      id: 'documents',
      label: 'Generador de Actas',
      icon: FileText,
      badge: null,
    },
  ];

  return (
    <aside className="w-64 bg-nav border-r border-nav-line flex flex-col justify-between shrink-0 min-h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        {/* Brand Header */}
        <div className="pb-2 flex items-center gap-3 px-2">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center shadow-sm">
            <div className="w-4 h-4 bg-white rounded-sm"></div>
          </div>
          <span className="text-nav-ink font-bold text-xl tracking-tight">FirstPlug</span>
        </div>

        <div className="space-y-1">
          <div className="px-3 py-1 text-[11px] font-semibold text-nav-muted uppercase tracking-wider">
            Navegación
          </div>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-nav-muted hover:bg-nav-hover hover:text-nav-ink'
                }`}
              >
                {/* El bloque brand sobre nav solo alcanza 2.76:1. La barra en
                    brand-light (4.16:1) es la que marca el item activo de forma
                    accesible; el texto blanco sobre brand aporta 5.77:1. */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r bg-brand-light"
                  />
                )}
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-nav-muted'}`} />
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
      <div className="pt-4 border-t border-nav-line px-2 space-y-3">
        <div className="bg-nav-deep p-3 rounded-xl border border-nav-line space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-nav-ink flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-brand-light" />
              Hubs Regionales
            </span>
            <span className="text-[10px] text-ink font-bold bg-ok px-1.5 py-0.5 rounded border border-transparent">
              5 Operativos
            </span>
          </div>
          <p className="text-[11px] text-nav-muted leading-relaxed">
            México, Colombia, Argentina, EE.UU. y España.
          </p>
          <button
            onClick={() => setActiveTab('logistics')}
            className="w-full text-center py-1.5 bg-nav-hover hover:bg-nav-line text-nav-ink text-[11px] font-medium rounded-md border border-nav-line transition-colors flex items-center justify-center gap-1"
          >
            <ArrowRightLeft className="w-3 h-3 text-brand-light" />
            <span>Ver Inventario en Hubs</span>
          </button>
        </div>

        {/* FirstPlug Support Footer */}
        <div className="text-[10px] text-nav-muted text-center px-1">
          FirstPlug Platform • Global ITAM
        </div>
      </div>
    </aside>
  );
};
