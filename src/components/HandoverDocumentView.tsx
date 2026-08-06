import React, { useState } from 'react';
import type { Empleado, Equipo } from '../types';
import { FileText, Printer, Sparkles, CheckCircle2, User, Laptop, MapPin, Download, PenTool, X } from 'lucide-react';

interface HandoverDocumentViewProps {
  equipos: Equipo[];
  empleados: Empleado[];
  equipoSeleccionado?: Equipo | null;
}

export const HandoverDocumentView: React.FC<HandoverDocumentViewProps> = ({
  equipos,
  empleados,
  equipoSeleccionado,
}) => {
  const [selectedEmpId, setSelectedEmpId] = useState<string>(
    equipoSeleccionado?.empleado_id || empleados[0]?.id || ''
  );
  const [selectedDevId, setSelectedDevId] = useState<string>(
    equipoSeleccionado?.id || equipos[0]?.id || ''
  );

  const [loadingAi, setLoadingAi] = useState(false);
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  const currentEmp = empleados.find((e) => e.id === selectedEmpId) || empleados[0];
  const currentDev = equipos.find((d) => d.id === selectedDevId) || equipos[0];

  /** Ya no hay `name` ni `specs`: el nombre se compone y las specs son columnas. */
  const nombreEquipo = (e: Equipo) =>
    e.nombre_equipo ?? e.etiqueta ?? ([e.marca, e.modelo].filter(Boolean).join(' ') || 'Equipo');

  const especificaciones = (e: Equipo) =>
    [e.procesador, e.ram, e.disco, e.sistema_operativo].filter(Boolean).join(', ') || '—';

  const handleGenerateActWithAi = async () => {
    if (!currentEmp || !currentDev) return;
    setLoadingAi(true);

    try {
      const response = await fetch('/api/gemini/handover-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName: currentEmp.nombre,
          employeeRole: currentEmp.cargo ?? '',
          employeeDocId: `ID-${currentEmp.id.toUpperCase()}`,
          deviceName: nombreEquipo(currentDev),
          serialNumber: currentDev.serial ?? '',
          specs: especificaciones(currentDev),
          location: currentDev.sede_id ?? null,
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
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}{e.cargo ? ` (${e.cargo})` : ''}
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
            {equipos.map((d) => (
              <option key={d.id} value={d.id}>
                {nombreEquipo(d)} [{d.etiqueta ?? '—'} - {d.serial ?? '—'}]
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
                <div>Nombre: <strong>{currentEmp?.nombre}</strong></div>
                <div>Puesto: <strong>{currentEmp?.cargo ?? '—'}</strong></div>
                <div>Área: <strong>{currentEmp?.area ?? '—'}</strong></div>
                {/* TODO(4b): la sede se resuelve con GET /api/sedes; aquí solo hay el id. */}
                <div>Cédula: <strong>{currentEmp?.cedula ?? '—'}</strong></div>
              </div>
            </div>

            {/* Device Box */}
            <div className="bg-slate-100 p-3 rounded-lg border border-slate-300 space-y-1">
              <div className="font-bold uppercase text-[10px] text-slate-500">Detalles del Equipo Tecnológico</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Equipo / Modelo: <strong>{currentDev ? nombreEquipo(currentDev) : '—'}</strong></div>
                <div>Etiqueta Activo: <strong>{currentDev?.etiqueta ?? '—'}</strong></div>
                <div>Número de Serie: <strong>{currentDev?.serial ?? '—'}</strong></div>
                {/* El enrolamiento MDM se fue con D3: no hay MDM, y el acta no
                    puede afirmar algo que nadie comprobó. La licencia de
                    Windows sí es un dato real del equipo. */}
                <div>Licencia: <strong>{currentDev?.licencia_tipo ?? '—'}</strong></div>
                <div className="col-span-2">Especificaciones: <strong>{currentDev ? especificaciones(currentDev) : '—'}</strong></div>
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
                Firmado Digitalmente por {currentEmp?.nombre}
              </div>
            ) : (
              <div className="h-16 border-b border-dashed border-slate-400 flex items-center justify-center text-slate-400">
                Firma del Colaborador
              </div>
            )}
            <p className="font-bold text-slate-900">{currentEmp?.nombre}</p>
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
