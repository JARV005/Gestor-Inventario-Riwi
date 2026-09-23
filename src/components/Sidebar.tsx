import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Laptop,
  Users,
  Truck,
  Wrench,
  FileText,
  Building,
  ArrowRightLeft
} from 'lucide-react';

import type { Sede } from '../types';
import { api } from '../lib/api';
import { LogoRiwiStock } from './LogoRiwiStock';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  /**
   * D13: equipos con un traslado sin confirmar. Ya no es un estado del equipo.
   *
   * `null` es «todavia no se sabe» —o no se pudo consultar—, y es distinto de
   * cero. Los dos ocultan el badge, pero un `0` puesto por defecto cuando la
   * consulta falla es un numero afirmado sin haberlo contado.
   */
  enTransitoCount: number | null;
  maintenanceCount: number | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  enTransitoCount,
  maintenanceCount,
}) => {
  /**
   * Las sedes, pedidas aquí y no recibidas por props.
   *
   * Es el patrón del resto de vistas conectadas: cada una pide lo suyo. Y son
   * seis filas que no cambian casi nunca, así que no justifica subir el estado
   * a `App` solo para este widget.
   *
   * Si la petición falla se queda vacío y el bloque lo dice. Antes había una
   * lista escrita a mano —cinco nombres y un «5 sembradas»— que ya mentía: se
   * escribió con cinco sedes y nadie la tocó al añadir Boyacá.
   */
  const [sedes, setSedes] = useState<Sede[]>([]);

  useEffect(() => {
    api.sedes().then(
      (r) => setSedes(r.sedes),
      () => setSedes([]),
    );
  }, []);

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
      label: 'Sedes',
      icon: Truck,
      badge: enTransitoCount && enTransitoCount > 0 ? `${enTransitoCount} en tránsito` : null,
      badgeColor: 'bg-info text-ink border-transparent',
    },
    {
      id: 'maintenance',
      label: 'Mantenimiento',
      icon: Wrench,
      badge: maintenanceCount && maintenanceCount > 0 ? `${maintenanceCount}` : null,
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
        {/* La marca. El cuadro llevaba un cuadrado blanco de relleno, que era
            lo que el prototipo puso donde iría un logo. */}
        <div className="pb-2 flex items-center gap-3 px-2">
          <LogoRiwiStock tamano={32} sobre="nav" className="shrink-0" />
          <span className="text-nav-ink font-bold text-xl tracking-tight">
            Riwi<span className="text-brand-light">Stock</span>
          </span>
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

      {/* Las sedes.

          Decía «5 sembradas» y son SEIS: el texto se escribió cuando eran
          cinco y no se movió al añadir Boyacá. Un conteo escrito a mano al lado
          de una lista escrita a mano se desincroniza a la primera, así que
          ahora los dos salen de `sedes`, que ya llega por props. */}
      <div className="pt-4 border-t border-nav-line px-2 space-y-3">
        <div className="bg-nav-deep p-3 rounded-xl border border-nav-line space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-nav-ink flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-brand-light" />
              Sedes
            </span>
            <span className="text-[10px] text-ink font-bold bg-ok px-1.5 py-0.5 rounded border border-transparent">
              {sedes.length}
            </span>
          </div>
          <p className="text-[11px] text-nav-muted leading-relaxed">
            {sedes.length > 0
              ? sedes.map((s) => s.nombre).join(', ')
              : 'Sin sedes registradas.'}
          </p>
          <button
            onClick={() => setActiveTab('logistics')}
            className="w-full text-center py-1.5 bg-nav-hover hover:bg-nav-line text-nav-ink text-[11px] font-medium rounded-md border border-nav-line transition-colors flex items-center justify-center gap-1"
          >
            <ArrowRightLeft className="w-3 h-3 text-brand-light" />
            <span>Ver sedes</span>
          </button>
        </div>

        <div className="text-[10px] text-nav-muted text-center px-1">
          RiwiStock · Inventario de TI
        </div>
      </div>
    </aside>
  );
};
