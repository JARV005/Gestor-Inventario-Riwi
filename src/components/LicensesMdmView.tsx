import React from 'react';
import { SoftwareLicense, Device } from '../types';
import { INITIAL_SOFTWARE_LICENSES } from '../data/mockData';
import { 
  ShieldCheck, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Users, 
  Lock, 
  HardDrive, 
  Cpu, 
  ExternalLink 
} from 'lucide-react';

interface LicensesMdmViewProps {
  devices: Device[];
}

export const LicensesMdmView: React.FC<LicensesMdmViewProps> = ({ devices }) => {
  const licenses = INITIAL_SOFTWARE_LICENSES;

  const totalSeatsAllocated = licenses.reduce((sum, l) => sum + l.usedSeats, 0);
  const totalMonthlyCost = licenses.reduce((sum, l) => sum + l.usedSeats * l.costPerSeatMonthly, 0);

  const mdmEnrolledCount = devices.filter((d) => d.mdmEnrolled).length;
  const encryptedCount = devices.filter((d) => d.encrypted).length;
  const totalDevices = devices.length || 1;

  const mdmComplianceRate = Math.round((mdmEnrolledCount / totalDevices) * 100);
  const encryptionRate = Math.round((encryptedCount / totalDevices) * 100);

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          Licencias SaaS, MDM & Seguridad
          <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full font-semibold">
            {mdmComplianceRate}% Cumplimiento
          </span>
        </h1>
        <p className="text-xs text-slate-500">
          Auditoría de enrolamiento Jamf/Kandji/Intune, encriptación FileVault y gestión de cuentas SaaS.
        </p>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase">Enrolamiento MDM</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {mdmEnrolledCount} / {totalDevices} <span className="text-xs font-medium text-blue-600">({mdmComplianceRate}%)</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Jamf Pro, Kandji & Microsoft Intune activos</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase">Encriptación de Disco</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {encryptedCount} / {totalDevices} <span className="text-xs font-medium text-emerald-600">({encryptionRate}%)</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">FileVault & BitLocker activados por política</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase">Gasto Mensual en Licencias</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            ${totalMonthlyCost.toLocaleString('en-US')} <span className="text-xs font-medium text-slate-500">USD / mes</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">{totalSeatsAllocated} asientos activos en 5 plataformas</p>
        </div>

      </div>

      {/* Software Licenses Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Key className="w-4 h-4 text-blue-600" />
              Suscripciones y Licencias Asignadas
            </h2>
            <p className="text-xs text-slate-500">Monitoreo de asientos y renovación anual</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Plataforma / Licencia</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3">Asientos Asignados</th>
                <th className="px-4 py-3">Costo / Asiento</th>
                <th className="px-4 py-3">Próxima Renovación</th>
                <th className="px-4 py-3 text-right">Estado Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {licenses.map((lic) => {
                const seatPercentage = Math.round((lic.usedSeats / lic.totalSeats) * 100);
                return (
                  <tr key={lic.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3.5 font-bold text-slate-900">
                      {lic.name}
                      <span className="block text-[10px] text-slate-500 font-normal">{lic.provider}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                        {lic.category}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="font-semibold text-slate-900">{lic.usedSeats} / {lic.totalSeats}</span>
                          <span className="text-slate-500">{seatPercentage}%</span>
                        </div>
                        <div className="w-24 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-blue-600 h-full rounded-full" style={{ width: `${seatPercentage}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-800">
                      ${lic.costPerSeatMonthly.toFixed(2)} USD
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {lic.renewalDate}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] px-2 py-0.5 rounded-full font-medium">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        100% Ok
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
