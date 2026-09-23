import React, { useState } from 'react';
import { Search, Bell, Plus, PackageCheck } from 'lucide-react';

import { LogoRiwiStock } from './LogoRiwiStock';

interface HeaderProps {
  onOpenNewDeviceModal: () => void;
  onOpenOnboardingModal: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenNewDeviceModal,
  onOpenOnboardingModal,
  activeTab,
  setActiveTab,
  searchTerm,
  setSearchTerm,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="bg-surface text-ink border-b border-line sticky top-0 z-40 shadow-sm">
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* La marca.

              El selector de organizaciones que iba aquí se fue en la 5g: sus
              dos entradas —«TechCorp Global Inc.» e «Innovate LatAm Labs»—
              eran inventadas del prototipo, y esta aplicación sirve a una sola
              organización. Un desplegable que solo ofrece nombres falsos no es
              una función a medias, es una afirmación falsa con forma de menú. */}
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-2.5 cursor-pointer group rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <LogoRiwiStock tamano={32} sobre="claro" className="shrink-0" />
              <div className="flex flex-col items-start">
                <span className="text-xl font-bold tracking-tight text-ink">
                  Riwi<span className="text-brand">Stock</span>
                </span>
                {/* Era «GESTIÓN DE ACTIVOS TI», que describe la categoría de
                    producto y no lo que hace este. Lo que hace es llevar la
                    cuenta de quién tiene cada equipo. */}
                <span className="text-[10px] text-ink-muted tracking-wider uppercase font-semibold">
                  Inventario y actas de TI
                </span>
              </div>
            </button>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-md hidden sm:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                placeholder="Buscar por etiqueta, serial, marca, modelo o persona…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-surface-alt border border-line rounded-lg pl-9 pr-4 py-1.5 text-xs text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand focus:bg-surface transition-all"
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2.5">
            {/* «Enviar Kit» era lenguaje del SaaS del que venía el prototipo:
                aquí no se envía nada, se entrega. La FUNCIÓN se queda —es el
                único camino que asigna y además abre el traslado cuando el
                equipo está en otra sede, que el acta no hace (D27)—; lo que
                cambia es cómo se llama. */}
            <button
              onClick={onOpenOnboardingModal}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-alt text-ink-muted text-xs font-medium rounded-lg border border-line transition-colors"
            >
              <PackageCheck className="w-3.5 h-3.5 text-brand" />
              <span>Entregar equipos</span>
            </button>

            {/* Quick Action: Add Device */}
            <button
              onClick={onOpenNewDeviceModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white font-medium text-xs rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span className="hidden sm:inline">Nuevo Equipo</span>
            </button>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 text-ink-muted hover:text-ink bg-surface-alt hover:bg-brand-subtle rounded-lg border border-line transition-colors relative"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand ring-2 ring-surface" />
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-surface border border-line rounded-xl shadow-xl py-3 z-50 text-xs">
                  <div className="px-4 pb-2 border-b border-line flex justify-between items-center">
                    <span className="font-semibold text-ink">Notificaciones de Inventario</span>
                    <span className="text-[10px] text-brand-hover bg-brand-subtle px-2 py-0.5 rounded border border-line">3 Activas</span>
                  </div>
                  <div className="divide-y divide-line max-h-64 overflow-y-auto">
                    <div className="p-3 hover:bg-surface-alt">
                      <p className="font-medium text-ink">Envío DHL en camino</p>
                      <p className="text-[11px] text-ink-muted">Kit de Onboarding para Mateo Silva llega mañana en Guadalajara.</p>
                      <span className="text-[10px] text-ink-muted mt-1 block">Hace 25 min</span>
                    </div>
                    <div className="p-3 hover:bg-surface-alt">
                      <p className="font-medium">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-warn text-ink text-[11px] font-semibold">
                          Garantía por vencer
                        </span>
                      </p>
                      <p className="text-[11px] text-ink-muted mt-1">3 Laptops Dell en Hub CDMX cumplen 3 años en agosto.</p>
                      <span className="text-[10px] text-ink-muted mt-1 block">Hace 2 horas</span>
                    </div>
                    <div className="p-3 hover:bg-surface-alt">
                      <p className="font-medium text-ink">Retiro Solicitado</p>
                      <p className="text-[11px] text-ink-muted">Guía FedEx generada para devolución de Valeria Ortiz (Bogotá).</p>
                      <span className="text-[10px] text-ink-muted mt-1 block">Ayer</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </header>
  );
};
