import React, { useEffect, useState } from 'react';

import type { Empleado, Equipo, Sede, UsuarioSesion } from './types';
import { EMPLEADOS_DEMO, EQUIPOS_DEMO, SEDES_DEMO } from './data/mockData';
import { construirContextoIA } from './lib/contextoIA';
import { api } from './lib/api';
import { Login } from './components/Login';

import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { SedesView } from './components/SedesView';
import { EmployeesView } from './components/EmployeesView';
import { MaintenanceView } from './components/MaintenanceView';
import { HandoverDocumentView } from './components/HandoverDocumentView';

import { AiCopilotModal } from './components/AiCopilotModal';
import { OnboardingModal } from './components/OnboardingModal';
import { NewDeviceModal } from './components/NewDeviceModal';

export function App() {
  const [activeTab, setActiveTab] = useState<string>('inventory');
  const [searchTerm, setSearchTerm] = useState<string>('');

  /**
   * `undefined` mientras se pregunta quién soy. Sin ese tercer estado, la
   * aplicación parpadearía enseñando el login a alguien que ya tiene sesión.
   */
  const [usuario, setUsuario] = useState<UsuarioSesion | null | undefined>(undefined);

  useEffect(() => {
    api.yo().then(
      (r) => setUsuario(r.usuario),
      () => setUsuario(null), // 401, o el servidor no responde: a la puerta
    );
  }, []);

  /**
   * TODO(4b): estas tres listas siguen viniendo de `mockData`. Solo
   * `InventoryView` está conectada a la API, y lo hace por su cuenta: no lee de
   * aquí. El resto de vistas las usa como relleno hasta que les toque.
   */
  const [equipos, setEquipos] = useState<Equipo[]>(EQUIPOS_DEMO);
  const [empleados, setEmpleados] = useState<Empleado[]>(EMPLEADOS_DEMO);
  const [sedes] = useState<Sede[]>(SEDES_DEMO);

  const [isCopilotOpen, setIsCopilotOpen] = useState<boolean>(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState<boolean>(false);
  const [isNewDeviceModalOpen, setIsNewDeviceModalOpen] = useState<boolean>(false);
  const [equipoParaActa, setEquipoParaActa] = useState<Equipo | null>(null);

  const handleAddEquipo = (nuevo: Equipo) => setEquipos((prev) => [nuevo, ...prev]);
  const handleAddEmpleado = (nuevo: Empleado) => setEmpleados((prev) => [nuevo, ...prev]);

  const handleGenerarActa = (equipo: Equipo) => {
    setEquipoParaActa(equipo);
    setActiveTab('documents');
  };

  const handleSolicitarMantenimiento = () => setActiveTab('maintenance');
  const handleReasignar = () => setIsOnboardingModalOpen(true);

  /**
   * D1: "en tránsito" ya no es un ticket de logística, es un estado del equipo.
   * El contador del sidebar sale de ahí. El traslado en sí es un movimiento, y
   * eso llega en la etapa 5.
   */
  const enTransito = equipos.filter((e) => e.estado === 'En tránsito').length;
  const enMantenimiento = equipos.filter((e) => e.estado === 'En mantenimiento').length;

  if (usuario === undefined) {
    return <div className="min-h-screen bg-surface-alt" aria-busy="true" />;
  }
  if (usuario === null) {
    return <Login onEntrar={setUsuario} />;
  }

  return (
    <div className="min-h-screen bg-surface-alt text-ink flex flex-col font-sans antialiased selection:bg-brand selection:text-white">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        onOpenAiCopilot={() => setIsCopilotOpen(true)}
        onOpenNewDeviceModal={() => setIsNewDeviceModalOpen(true)}
        onOpenOnboardingModal={() => setIsOnboardingModalOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden max-w-[1920px] w-full mx-auto">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          enTransitoCount={enTransito}
          maintenanceCount={enMantenimiento}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-surface-alt space-y-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              equipos={equipos}
              empleados={empleados}
              sedes={sedes}
              setActiveTab={setActiveTab}
              onOpenAiCopilot={() => setIsCopilotOpen(true)}
              onOpenNewDeviceModal={() => setIsNewDeviceModalOpen(true)}
              onOpenOnboardingModal={() => setIsOnboardingModalOpen(true)}
            />
          )}

          {/* La única conectada a Postgres. Se pide sus datos ella sola. */}
          {activeTab === 'inventory' && (
            <InventoryView
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              onOpenNewDeviceModal={() => setIsNewDeviceModalOpen(true)}
              onGenerarActa={handleGenerarActa}
              onSolicitarMantenimiento={handleSolicitarMantenimiento}
              onReasignar={handleReasignar}
            />
          )}

          {activeTab === 'logistics' && <SedesView />}

          {/* Conectada: se pide sus datos ella sola. */}
          {activeTab === 'employees' && (
            <EmployeesView
              onOpenOnboardingModal={() => setIsOnboardingModalOpen(true)}
              onOpenOffboardingModal={() => setIsOnboardingModalOpen(true)}
            />
          )}

          {activeTab === 'maintenance' && <MaintenanceView />}

          {activeTab === 'documents' && (
            <HandoverDocumentView
              equipos={equipos}
              empleados={empleados}
              equipoSeleccionado={equipoParaActa}
            />
          )}
        </main>
      </div>

      <AiCopilotModal
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        inventorySummaryContext={construirContextoIA(equipos, sedes)}
      />

      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={() => setIsOnboardingModalOpen(false)}
        empleados={empleados}
        equipos={equipos}
      />

      <NewDeviceModal
        isOpen={isNewDeviceModalOpen}
        onClose={() => setIsNewDeviceModalOpen(false)}
        empleados={empleados}
        sedes={sedes}
        onAddEquipo={handleAddEquipo}
      />
    </div>
  );
}

export default App;
