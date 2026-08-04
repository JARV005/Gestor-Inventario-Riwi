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
    <header className="bg-white text-slate-900 border-b border-slate-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Brand Logo & Organization Selector */}
          <div className="flex items-center gap-6">
            <div 
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-2.5 cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-sm shadow-sm group-hover:bg-blue-700 transition-colors">
                FP
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
                  FirstPlug <span className="text-blue-700 font-semibold text-xs px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200">ITAM</span>
                </span>
                <span className="text-[10px] text-slate-500 tracking-wider uppercase font-semibold">
                  Gestión de Activos TI
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden md:block h-6 w-px bg-slate-200" />

            {/* Org Switcher */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                <span className="max-w-[140px] truncate">TechCorp Global Inc.</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showOrgDropdown && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 text-xs">
                  <div className="px-3 py-1.5 font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                    Organizaciones Activas
                  </div>
                  <button 
                    onClick={() => setShowOrgDropdown(false)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 text-slate-900 font-medium"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      TechCorp Global Inc.
                    </span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  </button>
                  <button 
                    onClick={() => setShowOrgDropdown(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 text-slate-600"
                  >
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    Innovate LatAm Labs
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-md hidden sm:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar equipo, serie, serie C02..., empleado o hub..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Quick Actions & Copilot Button */}
          <div className="flex items-center gap-2.5">
            {/* AI Copilot Button */}
            <button
              onClick={onOpenAiCopilot}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg shadow-sm transition-all"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-200 animate-pulse" />
              <span className="hidden md:inline">Copilot IA</span>
            </button>

            {/* Quick Action: Send Onboarding Kit */}
            <button
              onClick={onOpenOnboardingModal}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 transition-colors"
            >
              <PackageCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>Enviar Kit</span>
            </button>

            {/* Quick Action: Add Device */}
            <button
              onClick={onOpenNewDeviceModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span className="hidden sm:inline">Nuevo Equipo</span>
            </button>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors relative"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-2 ring-white" />
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl py-3 z-50 text-xs">
                  <div className="px-4 pb-2 border-b border-slate-100 flex justify-between items-center">
                    <span className="font-semibold text-slate-900">Notificaciones de Inventario</span>
                    <span className="text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">3 Activas</span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    <div className="p-3 hover:bg-slate-50">
                      <p className="font-medium text-slate-900">Envío DHL en camino</p>
                      <p className="text-[11px] text-slate-600">Kit de Onboarding para Mateo Silva llega mañana en Guadalajara.</p>
                      <span className="text-[10px] text-slate-400 mt-1 block">Hace 25 min</span>
                    </div>
                    <div className="p-3 hover:bg-slate-50">
                      <p className="font-medium text-amber-700">Garantía por vencer</p>
                      <p className="text-[11px] text-slate-600">3 Laptops Dell en Hub CDMX cumplen 3 años en agosto.</p>
                      <span className="text-[10px] text-slate-400 mt-1 block">Hace 2 horas</span>
                    </div>
                    <div className="p-3 hover:bg-slate-50">
                      <p className="font-medium text-slate-900">Retiro Solicitado</p>
                      <p className="text-[11px] text-slate-600">Guía FedEx generada para devolución de Valeria Ortiz (Bogotá).</p>
                      <span className="text-[10px] text-slate-400 mt-1 block">Ayer</span>
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
