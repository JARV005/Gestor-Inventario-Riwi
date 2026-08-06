import React, { useState } from 'react';
import type { Mantenimiento, Equipo } from '../types';
import { MANTENIMIENTOS_DEMO } from '../data/mockData';
import { Wrench, Plus, CheckCircle2, Clock, AlertTriangle, BatteryCharging, Shield, X } from 'lucide-react';
import confetti from 'canvas-confetti';

interface MaintenanceViewProps {
  equipos: Equipo[];
}

/**
 * TODO(4b): sin conectar. Sigue leyendo `mockData` y guardando los partes en su
 * propio `useState`, invisible para `App` (D2). Conectar contra
 * `/api/mantenimientos`, que además no existe hasta la etapa 6.
 */
export const MaintenanceView: React.FC<MaintenanceViewProps> = ({ equipos }) => {
  const [records, setRecords] = useState<Mantenimiento[]>(MANTENIMIENTOS_DEMO);

  /** El parte guarda `equipo_id`; el nombre se resuelve contra la lista. */
  const equipoDe = (rec: Mantenimiento) => equipos.find((e) => e.id === rec.equipo_id);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);

  const [selectedDeviceId, setSelectedDeviceId] = useState(equipos[0]?.id || '');
  const [issueDescription, setIssueDescription] = useState('');
  const [repairType, setRepairType] = useState<string>('Cambio de batería');
  const [estCost, setEstCost] = useState('150');

  const handleCreateRecord = (e: React.FormEvent) => {
    e.preventDefault();
    const dev = equipos.find((d) => d.id === selectedDeviceId);
    if (!dev) return;

    const ahora = new Date().toISOString();
    const newRecord: Mantenimiento = {
      id: `mnt-${Math.floor(100 + Math.random() * 900)}`,
      equipo_id: dev.id,
      tipo: repairType,
      descripcion: issueDescription || 'Solicitud de diagnóstico preventivo.',
      estado: 'Pendiente',
      fecha_reporte: ahora,
      fecha_cierre: null,
      responsable: 'Soporte TI',
      proveedor: null,
      costo: estCost || null,
      created_at: ahora,
      updated_at: ahora,
    };

    setRecords([newRecord, ...records]);
    setShowNewTicketModal(false);
    confetti({ particleCount: 40, spread: 50, origin: { y: 0.7 } });

    setIssueDescription('');
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Mantenimiento & Soporte Técnico
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full font-semibold">
              {records.length} Incidentes
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Registro de cambio de baterías, reparación de pantallas y formateos seguros.
          </p>
        </div>

        <button
          onClick={() => setShowNewTicketModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Nuevo Ticket Mantenimiento</span>
        </button>
      </div>

      {/* Maintenance Cards */}
      <div className="space-y-3">
        {records.map((rec) => (
          <div
            key={rec.id}
            className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors space-y-3 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {rec.id}
                </span>
                <span className="font-bold text-slate-900 text-sm">{equipoDe(rec)?.nombre_equipo ?? equipoDe(rec)?.etiqueta ?? '(sin nombre)'}</span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 font-mono">
                  {equipoDe(rec)?.serial ?? '(sin serial)'}
                </span>
              </div>

              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${
                rec.estado === 'En taller' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                rec.estado === 'Completado' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                'bg-slate-100 text-slate-700 border border-slate-200'
              }`}>
                {rec.estado === 'En taller' ? 'En Taller Técnico Autorizado' : rec.estado}
              </span>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
              <div className="flex justify-between items-center text-slate-500 font-medium">
                <span>Tipo: <strong className="text-slate-900">{rec.tipo}</strong></span>
                <span>Costo Est.: <strong className="text-emerald-700">${rec.costo ?? '—'}</strong></span>
              </div>
              <p className="text-slate-700 leading-relaxed pt-1">{rec.descripcion}</p>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span>Técnico: <strong className="text-slate-800">{rec.responsable}</strong></span>
              <span>Reportado: {rec.fecha_reporte.slice(0, 10)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* New Maintenance Ticket Modal */}
      {showNewTicketModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
            <button
              onClick={() => setShowNewTicketModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-blue-600" />
                Crear Orden de Mantenimiento
              </h2>
              <p className="text-xs text-slate-500">
                Inicia un ticket de reparación o inspección física con logística FirstPlug.
              </p>
            </div>

            <form onSubmit={handleCreateRecord} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Seleccionar Equipo a Reparar *</label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  {equipos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre_equipo ?? d.etiqueta ?? d.id.slice(0, 8)} ({d.etiqueta ?? '—'} - {d.serial ?? '—'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Tipo de Incidencia</label>
                  <select
                    value={repairType}
                    onChange={(e: any) => setRepairType(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    <option value="Battery Replacement">Reemplazo Batería</option>
                    <option value="Screen Repair">Reparación Pantalla</option>
                    <option value="OS Reinstall & Wipe">Limpieza & Formateo OS</option>
                    <option value="Keyboard Repair">Teclado / Trackpad</option>
                    <option value="Diagnostic">Diagnóstico General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Costo Estimado (USD)</label>
                  <input
                    type="number"
                    value={estCost}
                    onChange={(e) => setEstCost(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Descripción del Problema *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Detalla los síntomas o fallas reportadas por el colaborador..."
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors"
                >
                  Crear Ticket Reparación
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
