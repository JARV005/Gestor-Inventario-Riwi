import React, { useState } from 'react';
import {
  Laptop,
  Search,
  Bell,
  Sparkles,
  Building2,
  ChevronDown,
  Plus,
  Globe2,
  CheckCircle2,
  PackageCheck,
  Zap
} from 'lucide-react';

interface HeaderProps {
  onOpenAiCopilot: () => void;
  onOpenNewDeviceModal: () => void;
  onOpenOnboardingModal: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAiCopilot,
  onOpenNewDeviceModal,
  onOpenOnboardingModal,
  activeTab,
  setActiveTab,
  searchTerm,
  setSearchTerm,
}) => {
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="bg-surface text-ink border-b border-line sticky top-0 z-40 shadow-sm">
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Brand Logo & Organization Selector */}
          <div className="flex items-center gap-6">
            <div
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-2.5 cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center font-black text-sm shadow-sm group-hover:bg-brand-hover transition-colors">
                FP
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold tracking-tight text-ink flex items-center gap-1.5">
                  FirstPlug <span className="text-brand-hover font-semibold text-xs px-1.5 py-0.5 rounded bg-brand-subtle border border-line">ITAM</span>
                </span>
                <span className="text-[10px] text-ink-muted tracking-wider uppercase font-semibold">
                  Gestión de Activos TI
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden md:block h-6 w-px bg-line" />

            {/* Org Switcher */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-surface-alt hover:bg-brand-subtle text-ink-muted rounded-lg border border-line transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 text-brand" />
                <span className="max-w-[140px] truncate">TechCorp Global Inc.</span>
                <ChevronDown className="w-3.5 h-3.5 text-ink-muted" />
              </button>

              {showOrgDropdown && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-surface border border-line rounded-xl shadow-xl py-2 z-50 text-xs">
                  <div className="px-3 py-1.5 font-semibold text-ink-muted uppercase tracking-wider text-[10px]">
                    Organizaciones Activas
                  </div>
                  <button
                    onClick={() => setShowOrgDropdown(false)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface-alt text-ink font-medium"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-ok" />
                      TechCorp Global Inc.
                    </span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand" />
                  </button>
                  <button
                    onClick={() => setShowOrgDropdown(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-alt text-ink-muted"
                  >
                    <span className="w-2 h-2 rounded-full bg-ink-faint" />
                    Innovate LatAm Labs
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-md hidden sm:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                placeholder="Buscar equipo, serie, serie C02..., empleado o hub..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-surface-alt border border-line rounded-lg pl-9 pr-4 py-1.5 text-xs text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand focus:bg-surface transition-all"
              />
            </div>
          </div>

          {/* Quick Actions & Copilot Button */}
          <div className="flex items-center gap-2.5">
            {/* AI Copilot Button */}
            <button
              onClick={onOpenAiCopilot}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-medium rounded-lg shadow-sm transition-all"
            >
              <Sparkles className="w-3.5 h-3.5 text-brand-subtle animate-pulse" />
              <span className="hidden md:inline">Copilot IA</span>
            </button>

            {/* Quick Action: Send Onboarding Kit */}
            <button
              onClick={onOpenOnboardingModal}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-alt text-ink-muted text-xs font-medium rounded-lg border border-line transition-colors"
            >
              <PackageCheck className="w-3.5 h-3.5 text-brand" />
              <span>Enviar Kit</span>
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
                      <p className="font-medium text-ink">Garantía por vencer</p>
                      <p className="text-[11px] text-ink-muted">3 Laptops Dell en Hub CDMX cumplen 3 años en agosto.</p>
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
