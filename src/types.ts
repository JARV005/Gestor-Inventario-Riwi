export type DeviceCategory = 'Laptop' | 'Desktop' | 'Mobile' | 'Monitor' | 'Peripherals' | 'Audio & Accessories';

export type DeviceStatus = 'In Use' | 'Available' | 'In Transit' | 'In Maintenance' | 'Pending Return' | 'Decommissioned';

export type DeviceCondition = 'Brand New' | 'Excellent' | 'Good' | 'Needs Repair';

export type HubLocation = 
  | 'CDMX Hub (México)' 
  | 'Bogotá Hub (Colombia)' 
  | 'Buenos Aires Hub (Argentina)' 
  | 'Miami Hub (EE.UU.)' 
  | 'Madrid Hub (España)' 
  | 'Empleado Remoto';

export interface DeviceSpecs {
  cpu: string;
  ram: string;
  storage: string;
  os: string;
  screenSize?: string;
}

export interface Device {
  id: string;
  assetTag: string;
  name: string;
  category: DeviceCategory;
  brand: string;
  model: string;
  serialNumber: string;
  status: DeviceStatus;
  condition: DeviceCondition;
  location: HubLocation;
  department: string;
  assignedTo: string | null; // Employee ID
  assignedDate: string | null;
  purchaseDate: string;
  costUSD: number;
  specs: DeviceSpecs;
  warrantyExpiry: string;
  mdmEnrolled: boolean;
  mdmProvider: string;
  encrypted: boolean;
  healthScore: number; // 0-100
  batteryHealth?: number;
  notes?: string;
  imageUrl: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  country: string;
  city: string;
  status: 'Active' | 'Onboarding' | 'Offboarding' | 'Inactive';
  startDate: string;
  assignedDeviceIds: string[];
  address: string;
  phone: string;
  avatarUrl: string;
}

export interface Hub {
  id: string;
  name: string;
  city: string;
  country: string;
  flag: string;
  address: string;
  capacityItems: number;
  currentItems: number;
  managerName: string;
  contactEmail: string;
  contactPhone: string;
}

export interface LogisticsTicket {
  id: string;
  type: 'Onboarding Ship' | 'Offboarding Retrieve' | 'Maintenance / Repair' | 'Hub Transfer';
  status: 'Scheduled' | 'In Transit' | 'In Warehouse' | 'Delivered' | 'Completed';
  employeeName: string;
  employeeAddress: string;
  deviceNames: string[];
  courier: 'DHL Express' | 'FedEx' | 'FirstPlug Direct' | 'Estafeta';
  trackingNumber: string;
  estimatedDelivery: string;
  createdDate: string;
  hubOrigin: string;
  hubDestination?: string;
}

export interface SoftwareLicense {
  id: string;
  name: string;
  provider: string;
  category: 'Productivity' | 'Development' | 'Design' | 'Security / MDM' | 'Communication';
  totalSeats: number;
  usedSeats: number;
  costPerSeatMonthly: number;
  renewalDate: string;
  complianceRate: number;
  iconName: string;
}

export interface MaintenanceRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  issue: string;
  type: 'Battery Replacement' | 'Screen Repair' | 'OS Reinstall & Wipe' | 'Keyboard Repair' | 'Diagnostic';
  status: 'Pending Approval' | 'In Repair Shop' | 'Completed' | 'Returned';
  reportedDate: string;
  completionDate?: string;
  costUSD: number;
  technician: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: DeviceCategory;
  brand: string;
  specs: string;
  priceUSD: number;
  monthlyLeaseUSD: number;
  leadTimeDays: number;
  stockAvailable: number;
  imageUrl: string;
  tags: string[];
}
