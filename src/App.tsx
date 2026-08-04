import React, { useState } from 'react';
import { 
  Device, 
  Employee, 
  Hub, 
  LogisticsTicket, 
  CatalogItem 
} from './types';
import { 
  INITIAL_DEVICES, 
  INITIAL_EMPLOYEES, 
  INITIAL_HUBS, 
  INITIAL_LOGISTICS_TICKETS 
} from './data/mockData';

import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { LogisticsHubsView } from './components/LogisticsHubsView';
import { EmployeesView } from './components/EmployeesView';
import { ProcurementCatalogView } from './components/ProcurementCatalogView';
import { LicensesMdmView } from './components/LicensesMdmView';
import { MaintenanceView } from './components/MaintenanceView';
import { HandoverDocumentView } from './components/HandoverDocumentView';

import { AiCopilotModal } from './components/AiCopilotModal';
import { OnboardingModal } from './components/OnboardingModal';
import { NewDeviceModal } from './components/NewDeviceModal';

export function App() {
  // Main State
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedOrg, setSelectedOrg] = useState<string>('Acme LatAm Tech');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Domain Datasets
  const [devices, setDevices] = useState<Device[]>(INITIAL_DEVICES);
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [hubs, setHubs] = useState<Hub[]>(INITIAL_HUBS);
  const [logisticsTickets, setLogisticsTickets] = useState<LogisticsTicket[]>(INITIAL_LOGISTICS_TICKETS);

  // Modals state
  const [isCopilotOpen, setIsCopilotOpen] = useState<boolean>(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState<boolean>(false);
  const [isNewDeviceModalOpen, setIsNewDeviceModalOpen] = useState<boolean>(false);
  const [selectedDeviceForDoc, setSelectedDeviceForDoc] = useState<Device | null>(null);

  // Handlers
  const handleAddDevice = (newDevice: Device) => {
    setDevices((prev) => [newDevice, ...prev]);
  };

  const handleAddEmployee = (newEmp: Employee) => {
    setEmployees((prev) => [newEmp, ...prev]);
  };

  const handleAddLogisticsTicket = (ticket: LogisticsTicket) => {
    setLogisticsTickets((prev) => [ticket, ...prev]);
  };

  const handleCatalogOrderSuccess = (item: CatalogItem, mode: 'buy' | 'lease') => {
    const newDev: Device = {
      id: `dev-${Date.now().toString().slice(-4)}`,
      assetTag: `FP-CAT-${Math.floor(1000 + Math.random() * 9000)}`,
      name: item.name,
      category: item.category,
      brand: item.brand,
      model: 'Model 2026',
      serialNumber: `SN-${Math.floor(100000 + Math.random() * 900000)}`,
      status: 'Available',
      condition: 'Brand New',
      location: 'CDMX Hub (México)',
      department: 'Engineering',
      assignedTo: null,
      assignedDate: null,
      purchaseDate: new Date().toISOString().slice(0, 10),
      warrantyExpiry: '2028-12-31',
      costUSD: item.priceUSD,
      specs: {
        cpu: item.specs,
        ram: 'Standard Enterprise',
        storage: 'Enterprise SSD',
        os: item.category === 'Laptop' ? 'macOS / Windows Pro' : 'N/A',
      },
      mdmEnrolled: true,
      mdmProvider: 'Jamf Pro Enterprise',
      encrypted: true,
      healthScore: 100,
      batteryHealth: 100,
      imageUrl: item.imageUrl,
    };

    setDevices((prev) => [newDev, ...prev]);
  };

  // Navigate to Handover Document view with pre-selected device
  const handleGenerateHandoverDoc = (device: Device) => {
    setSelectedDeviceForDoc(device);
    setActiveTab('documents');
  };

  const handleRequestMaintenance = (device: Device) => {
    setActiveTab('maintenance');
  };

  const handleReassignDevice = (device: Device) => {
    setIsOnboardingModalOpen(true);
  };

  // Inventory context string for AI Copilot
  const inventorySummaryContext = `
    Organización: ${selectedOrg}
    Total Equipos: ${devices.length} (${devices.filter(d => d.status === 'In Use').length} en uso, ${devices.filter(d => d.status === 'Available').length} disponibles en Hub, ${devices.filter(d => d.status === 'In Transit').length} en tránsito).
    Valor Total Estimado: $${devices.reduce((acc, d) => acc + d.costUSD, 0).toLocaleString('en-US')} USD.
    Hubs Activos: ${hubs.map(h => h.name).join(', ')}.
    Colaboradores Totales: ${employees.length}.
    Envíos Activos DHL/FedEx: ${logisticsTickets.filter(t => t.status === 'In Transit').length}.
  `;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans antialiased selection:bg-blue-600 selection:text-white">
      
      {/* Top Header */}
      <Header
        selectedOrg={selectedOrg}
        setSelectedOrg={setSelectedOrg}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onOpenNewDeviceModal={() => setIsNewDeviceModalOpen(true)}
      />

      {/* Main Body with Left Sidebar & Content View */}
      <div className="flex-1 flex overflow-hidden max-w-[1920px] w-full mx-auto">
        
        {/* Navigation Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          inTransitCount={logisticsTickets.filter((t) => t.status === 'In Transit').length}
          inventoryCount={devices.length}
        />

        {/* Dynamic View Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[#F8FAFC] space-y-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              devices={devices}
              employees={employees}
              hubs={hubs}
              logisticsTickets={logisticsTickets}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenCopilot={() => setIsCopilotOpen(true)}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryView
              devices={devices}
              employees={employees}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              onOpenNewDeviceModal={() => setIsNewDeviceModalOpen(true)}
              onGenerateHandoverDoc={handleGenerateHandoverDoc}
              onRequestMaintenance={handleRequestMaintenance}
              onReassignDevice={handleReassignDevice}
            />
          )}

          {activeTab === 'logistics' && (
            <LogisticsHubsView
              hubs={hubs}
              logisticsTickets={logisticsTickets}
              devices={devices}
              onAddLogisticsTicket={handleAddLogisticsTicket}
            />
          )}

          {activeTab === 'employees' && (
            <EmployeesView
              employees={employees}
              devices={devices}
              onOpenOnboardingModal={() => setIsOnboardingModalOpen(true)}
              onOpenOffboardingModal={(emp) => setIsOnboardingModalOpen(true)}
              onAddEmployee={handleAddEmployee}
            />
          )}

          {activeTab === 'catalog' && (
            <ProcurementCatalogView
              onOrderSuccess={handleCatalogOrderSuccess}
            />
          )}

          {activeTab === 'licenses' && (
            <LicensesMdmView
              devices={devices}
            />
          )}

          {activeTab === 'maintenance' && (
            <MaintenanceView
              devices={devices}
            />
          )}

          {activeTab === 'documents' && (
            <HandoverDocumentView
              devices={devices}
              employees={employees}
              selectedDeviceForDoc={selectedDeviceForDoc}
            />
          )}
        </main>

      </div>

      {/* Global Modals */}
      <AiCopilotModal
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        inventorySummaryContext={inventorySummaryContext}
      />

      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        onClose={() => setIsOnboardingModalOpen(false)}
        employees={employees}
        devices={devices}
        onAddLogisticsTicket={handleAddLogisticsTicket}
      />

      <NewDeviceModal
        isOpen={isNewDeviceModalOpen}
        onClose={() => setIsNewDeviceModalOpen(false)}
        employees={employees}
        onAddDevice={handleAddDevice}
      />

    </div>
  );
}

export default App;
