import React, { useState } from 'react';
import type { CategoriaEquipo, Empleado, Equipo, Sede } from '../types';
import { CATEGORIAS_EQUIPO } from '../types';
import { Laptop, Plus, X } from 'lucide-react';
import confetti from 'canvas-confetti';

interface NewDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  empleados: Empleado[];
  sedes: Sede[];
  onAddEquipo: (equipo: Equipo) => void;
}

/**
 * TODO(4b): sin conectar. Construye el equipo en memoria y se lo pasa a `App`.
 * Debe hacer `POST /api/equipos` y refrescar el listado.
 */
export const NewDeviceModal: React.FC<NewDeviceModalProps> = ({
  isOpen,
  onClose,
  empleados,
  sedes,
  onAddEquipo,
}) => {
  const [nombreEquipo, setNombreEquipo] = useState('');
  const [categoria, setCategoria] = useState<CategoriaEquipo>('Portátil');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [serial, setSerial] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [empleadoId, setEmpleadoId] = useState('');
  const [costo, setCosto] = useState('');
  const [procesador, setProcesador] = useState('');
  const [ram, setRam] = useState('');
  const [disco, setDisco] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const ahora = new Date().toISOString();
    // El invariante del §2: 'Asignado' si y solo si hay responsable.
    const estado = empleadoId ? 'Asignado' : 'Disponible';

    const nuevo: Equipo = {
      id: `nuevo-${Date.now().toString().slice(-6)}`,
      categoria,
      etiqueta: etiqueta || null,
      nombre_equipo: nombreEquipo || null,
      marca: marca || null,
      modelo: modelo || null,
      serial: serial || null,
      serial_cargador: null,
      propiedad: 'Empresa',
      sistema_operativo: null,
      licencia_tipo: null,
      tamano_pantalla: null,
      procesador: procesador || null,
      disco: disco || null,
      ram: ram || null,
      estado,
      condicion: 'Nuevo',
      sede_id: sedeId || null,
      empleado_id: empleadoId || null,
      empleado_mencionado_id: null,
      importacion_id: null,
      sesion_usuario: null,
      fecha_compra: ahora.slice(0, 10),
      garantia_vence: null,
      costo: costo || null,
      notas: null,
      // Un alta manual la escribe una persona que tiene el equipo delante: no
      // nace en la bandeja de revisión, a diferencia de las 83 del Excel.
      requiere_revision: false,
      created_at: ahora,
      updated_at: ahora,
    };

    onAddEquipo(nuevo);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-600" />
            Registrar Nuevo Activo de TI
          </h2>
          <p className="text-xs text-slate-500">
            Añade un equipo al inventario FirstPlug para seguimiento de garantía y asignaciones.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Nombre del Equipo *</label>
              <input
                type="text"
                required
                value={nombreEquipo}
                onChange={(e) => setNombreEquipo(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Categoría</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as CategoriaEquipo)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                {CATEGORIAS_EQUIPO.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Etiqueta Activo</label>
              <input
                type="text"
                required
                value={etiqueta}
                onChange={(e) => setEtiqueta(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono text-blue-600 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Marca</label>
              <input
                type="text"
                required
                value={marca}
                onChange={(e) => setMarca(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Modelo</label>
              <input
                type="text"
                required
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Número de Serie *</label>
              <input
                type="text"
                required
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Costo de adquisición (COP)</label>
              <input
                type="number"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Procesador</label>
              <input
                type="text"
                value={procesador}
                onChange={(e) => setProcesador(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">RAM</label>
              <input
                type="text"
                value={ram}
                onChange={(e) => setRam(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">SSD</label>
              <input
                type="text"
                value={disco}
                onChange={(e) => setDisco(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Sede</label>
              <select
                value={sedeId}
                onChange={(e) => setSedeId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="">Sin sede</option>
                {sedes.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Asignar a colaborador (opcional)</label>
              <select
                value={empleadoId}
                onChange={(e) => setEmpleadoId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="">Sin asignar</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre}{e.cargo ? ` (${e.cargo})` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors"
            >
              Guardar Activo en Inventario
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
