import React from 'react';
import { Search, Plus, PackageCheck } from 'lucide-react';

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

            {/* La campana de notificaciones se retiró en la 5g.
                ============================================================
                NO SE QUITÓ POR SER UNA FUNCIÓN A MEDIAS, SINO POR MENTIR.
                ============================================================

                Sus tres avisos eran inventados del prototipo: dos personas que
                no existen en la base, envíos de DHL y FedEx que este sistema no
                gestiona, un «Hub CDMX» que no es ninguna de las seis sedes, y
                un contador de «3 Activas» fijo en el código.

                Lo peligroso no era el texto, era el punto rojo permanente
                encima: invitaba a actuar sobre cosas que no habían pasado. Un
                aviso falso es peor que ningún aviso, porque el que no está no
                engaña a nadie.

                Cuando haya qué notificar de verdad —garantías por vencer,
                traslados sin confirmar, partes de mantenimiento abiertos— vuelve
                con datos. Es la etapa 6 y está anotado en pendientes. */}
          </div>

        </div>
      </div>
    </header>
  );
};
