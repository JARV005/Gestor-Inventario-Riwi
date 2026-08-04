import React, { useState } from 'react';
import { Device, Employee } from '../types';
import { FileText, Printer, Sparkles, CheckCircle2, User, Laptop, MapPin, Download, PenTool, X } from 'lucide-react';

interface HandoverDocumentViewProps {
  devices: Device[];
  employees: Employee[];
  selectedDeviceForDoc?: Device | null;
}

export const HandoverDocumentView: React.FC<HandoverDocumentViewProps> = ({
  devices,
  employees,
  selectedDeviceForDoc,
}) => {
  const [selectedEmpId, setSelectedEmpId] = useState<string>(
    selectedDeviceForDoc?.assignedTo || employees[0]?.id || ''
  );
  const [selectedDevId, setSelectedDevId] = useState<string>(
    selectedDeviceForDoc?.id || devices[0]?.id || ''
  );

  const [loadingAi, setLoadingAi] = useState(false);
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  const currentEmp = employees.find((e) => e.id === selectedEmpId) || employees[0];
  const currentDev = devices.find((d) => d.id === selectedDevId) || devices[0];

  const handleGenerateActWithAi = async () => {
    if (!currentEmp || !currentDev) return;
    setLoadingAi(true);

    try {
      const response = await fetch('/api/gemini/handover-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: currentEmp.name,
          employeeRole: currentEmp.role,
          employeeDocId: `ID-${currentEmp.id.toUpperCase()}`,
          deviceName: currentDev.name,
          serialNumber: currentDev.serialNumber,
          specs: `${currentDev.specs.cpu}, ${currentDev.specs.ram}, ${currentDev.specs.storage}`,
          location: currentDev.location,
          handoverDate: new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }),
        }),
      });

      const data = await response.json();
      if (data.documentMarkdown) {
        setGeneratedMarkdown(data.documentMarkdown);
      }
    } catch (err) {
      console.error('Error generating handover document:', err);
    } finally {
      setLoadingAi(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Generador de Actas de Entrega de Equipo
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full font-semibold">
              Legal Compliance
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Confecciona actas oficiales de responsabilidad de activos informáticos con firma digital.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateActWithAi}
            disabled={loadingAi}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-all"
          >
            <Sparkles className="w-4 h-4 text-blue-200" />
            <span>{loadingAi ? 'Redactando Acta...' : 'Redactar Acta con IA'}</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-xs transition-colors"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Imprimir / PDF</span>
          </button>
        </div>
      </div>

      {/* Selectors Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-sm">
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Colaborador Receptor</label>
          <select
            value={selectedEmpId}
            onChange={(e) => setSelectedEmpId(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.role} - {e.country})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Equipo a Entregar</label>
          <select
            value={selectedDevId}
            onChange={(e) => setSelectedDevId(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} [{d.assetTag} - {d.serialNumber}]
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Printable Document Preview Paper */}
      <div className="bg-white text-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-300 max-w-3xl mx-auto space-y-6 print:m-0 print:p-0 print:shadow-none print:border-none">
        
        {/* Document Header */}
        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-cyan-400 flex items-center justify-center font-black text-xl">
              FP
            </div>
            <div>
              <h2 className="font-black text-xl tracking-tight text-slate-900 uppercase">FirstPlug ITAM</h2>
              <p className="text-xs text-slate-600 font-medium">Plataforma de Gestión de Activos Informáticos</p>
            </div>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p className="font-bold text-slate-900">ACTA DE ENTREGA Nº FP-2026-9041</p>
            <p>Fecha: {new Date().toLocaleDateString('es-ES')}</p>
          </div>
        </div>

        <div className="text-center font-bold text-lg text-slate-900 tracking-wide uppercase border-b pb-2">
          ACTA DE ENTREGA Y RESPONSABILIDAD DE EQUIPO TECNOLÓGICO
        </div>

        {/* Formatted Markdown Content or Standard Template */}
        {generatedMarkdown ? (
          <div className="text-xs leading-relaxed space-y-3 whitespace-pre-wrap text-slate-800 font-sans">
            {generatedMarkdown}
          </div>
        ) : (
          <div className="space-y-5 text-xs text-slate-800 leading-relaxed">
            <p>
              Por medio del presente documento, la empresa <strong>FirstPlug Managed Operations / TechCorp Global Inc.</strong> hace entrega formal en calidad de resguardo y custodia del equipo de cómputo descrito a continuación:
            </p>

            {/* Employee Box */}
            <div className="bg-slate-100 p-3 rounded-lg border border-slate-300 space-y-1">
              <div className="font-bold uppercase text-[10px] text-slate-500">Datos del Colaborador Receptor</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Nombre: <strong>{currentEmp?.name}</strong></div>
                <div>Puesto: <strong>{currentEmp?.role}</strong></div>
                <div>Departamento: <strong>{currentEmp?.department}</strong></div>
                <div>Ubicación: <strong>{currentEmp?.city}, {currentEmp?.country}</strong></div>
              </div>
            </div>

            {/* Device Box */}
            <div className="bg-slate-100 p-3 rounded-lg border border-slate-300 space-y-1">
              <div className="font-bold uppercase text-[10px] text-slate-500">Detalles del Equipo Tecnológico</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Equipo / Modelo: <strong>{currentDev?.name}</strong></div>
                <div>Etiqueta Activo: <strong>{currentDev?.assetTag}</strong></div>
                <div>Número de Serie: <strong>{currentDev?.serialNumber}</strong></div>
                <div>Enrolamiento MDM: <strong>{currentDev?.mdmEnrolled ? currentDev?.mdmProvider : 'Activo'}</strong></div>
                <div className="col-span-2">Especificaciones: <strong>{currentDev?.specs.cpu}, {currentDev?.specs.ram}, {currentDev?.specs.storage}</strong></div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-bold text-slate-900 uppercase text-xs">Cláusulas de Custodia y Uso:</div>
              <ol className="list-decimal pl-5 space-y-1 text-slate-700">
                <li>El colaborador declara haber recibido el bien en perfecto estado funcional y cosmético.</li>
                <li>El equipo es de uso estrictamente profesional para el desempeño de las labores asignadas.</li>
                <li>Queda prohibida la instalación de software no autorizado o desactivar el agente MDM / FileVault.</li>
                <li>En caso de cese de relación laboral (Offboarding), el colaborador devolverá el activo utilizando el kit de recolección FirstPlug.</li>
              </ol>
            </div>
          </div>
        )}

        {/* Signature Area */}
        <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
          <div className="space-y-2">
            {signed ? (
              <div className="bg-emerald-50 border border-emerald-300 p-2 rounded text-emerald-800 font-semibold text-[11px] flex items-center justify-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Firmado Digitalmente por {currentEmp?.name}
              </div>
            ) : (
              <div className="h-16 border-b border-dashed border-slate-400 flex items-center justify-center text-slate-400">
                Firma del Colaborador
              </div>
            )}
            <p className="font-bold text-slate-900">{currentEmp?.name}</p>
            <p className="text-[10px] text-slate-500">Colaborador Receptor</p>
          </div>

          <div className="space-y-2">
            <div className="h-16 border-b border-dashed border-slate-400 flex items-center justify-center font-serif text-slate-700 italic">
              Mariana Ríos • FirstPlug IT Ops
            </div>
            <p className="font-bold text-slate-900">FirstPlug IT Operations</p>
            <p className="text-[10px] text-slate-500">Entregado por Sede Oficial</p>
          </div>
        </div>

        {/* Digital Signature Action Button */}
        {!signed && (
          <div className="pt-4 border-t flex justify-center print:hidden">
            <button
              onClick={() => {
                setSigned(true);
              }}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm flex items-center gap-2"
            >
              <PenTool className="w-4 h-4 text-white" />
              <span>Añadir Firma Digital de Conformidad</span>
            </button>
          </div>
        )}

      </div>

    </div>
  );
};
