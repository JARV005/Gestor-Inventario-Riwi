import React, { useCallback, useEffect, useState } from 'react';

import type {
  EmpleadoConConteo,
  EquipoConMotivos,
  EstadoEquipo,
  ResumenEquipos,
  UsuarioSesion,
} from './types';
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

import { OnboardingModal } from './components/OnboardingModal';
import { OffboardingModal } from './components/OffboardingModal';
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
   * Los dos contadores del sidebar, y nada más.
   *
   * Cada vista pide sus propios datos; lo único que `App` necesita saber es lo
   * que se pinta fuera de la vista activa. `null` mientras no se sepa: si la
   * consulta falla, el badge no aparece, que no es lo mismo que enseñar un
   * cero que nadie contó.
   */
  const [resumen, setResumen] = useState<ResumenEquipos | null>(null);

  const recargarResumen = useCallback(() => {
    api.resumenEquipos().then(setResumen, () => setResumen(null));
  }, []);

  useEffect(() => {
    if (usuario) recargarResumen();
  }, [usuario, recargarResumen]);

  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState<boolean>(false);
  /**
   * El offboarding necesita saber DE QUIÉN. Es la operación contraria a la
   * entrega —devuelve equipos en vez de asignarlos— y hasta ahora su botón
   * abría el asistente de entrega, que hacía justo lo contrario.
   */
  const [empleadoSaliente, setEmpleadoSaliente] = useState<EmpleadoConConteo | null>(null);
  const [isNewDeviceModalOpen, setIsNewDeviceModalOpen] = useState<boolean>(false);
  const [equipoParaActa, setEquipoParaActa] = useState<EquipoConMotivos | null>(null);

  const handleGenerarActa = (equipo: EquipoConMotivos) => {
    setEquipoParaActa(equipo);
    setActiveTab('documents');
  };

  const handleSolicitarMantenimiento = () => setActiveTab('maintenance');

  /**
   * Un estado sin filas no viene en `por_estado` —`GROUP BY` no devuelve grupos
   * vacíos—, y hoy es el caso de 'En mantenimiento'. La ausencia se lee como
   * cero; el `null` de `resumen` es «no se sabe» y se propaga tal cual.
   */
  const conteoDe = (estado: EstadoEquipo): number | null =>
    resumen ? (resumen.por_estado.find((e) => e.estado === estado)?.equipos ?? 0) : null;

  /**
   * D13: «en tránsito» dejó de ser un estado del equipo y pasó a derivarse de
   * que exista un traslado sin confirmar. No sale de `por_estado`, sale de su
   * propio conteo — un equipo que viaja sigue estando `Asignado`.
   */
  const enTransito = resumen ? resumen.traslados_abiertos : null;
  const enMantenimiento = conteoDe('En mantenimiento');

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
          {/* Conectada: pide su resumen agregado por su cuenta. */}
          {activeTab === 'dashboard' && (
            <DashboardView
              setActiveTab={setActiveTab}
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
              onEquipoMutado={recargarResumen}
            />
          )}

          {/* Confirmar un traslado cambia el badge del sidebar, que se pinta
              fuera de la vista: por eso avisa hacia arriba. */}
          {activeTab === 'logistics' && <SedesView onTrasladoConfirmado={recargarResumen} />}

          {/* Conectada: se pide sus datos ella sola. */}
          {activeTab === 'employees' && (
            <EmployeesView
              onOpenOnboardingModal={() => setIsOnboardingModalOpen(true)}
              onOpenOffboardingModal={setEmpleadoSaliente}
            />
          )}

          {activeTab === 'maintenance' && <MaintenanceView />}

          {/* Conectada: lee equipos, empleados y sedes por su cuenta. */}
          {activeTab === 'documents' && (
            <HandoverDocumentView
              equipoSeleccionado={equipoParaActa}
              onActaEmitida={recargarResumen}
            />
          )}
        </main>
      </div>

      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={() => setIsOnboardingModalOpen(false)}
        onAsignado={recargarResumen}
      />

      <OffboardingModal
        isOpen={empleadoSaliente !== null}
        empleado={empleadoSaliente}
        onClose={() => setEmpleadoSaliente(null)}
        onCambio={recargarResumen}
      />

      <NewDeviceModal
        isOpen={isNewDeviceModalOpen}
        onClose={() => setIsNewDeviceModalOpen(false)}
        onCreado={recargarResumen}
      />
    </div>
  );
}

export default App;
