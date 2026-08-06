import React, { useCallback, useEffect, useState } from 'react';
import type { CategoriaEquipo, EmpleadoConConteo, Sede } from '../types';
import { CATEGORIAS_EQUIPO } from '../types';
import { Loader2, Plus, X } from 'lucide-react';
import confetti from 'canvas-confetti';

import { api, ErrorApi } from '../lib/api';

interface NewDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Para que quien esté mirando un listado vea aparecer lo que acaba de crear. */
  onCreado: () => void;
}

/** El tope que acepta la API. Ver `porPagina` en `server/rutas/equipos.ts`. */
const TOPE = 200;

export const NewDeviceModal: React.FC<NewDeviceModalProps> = ({ isOpen, onClose, onCreado }) => {
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

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoConConteo[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Los desplegables se piden al abrir, no al montar: el modal vive montado
  // todo el rato y pedirlos al arrancar sería una consulta que casi nadie usa.
  useEffect(() => {
    if (!isOpen) return;
    let vigente = true;
    Promise.all([api.sedes(), api.empleados({ porPagina: TOPE, activo: true })]).then(
      ([s, e]) => {
        if (!vigente) return;
        setSedes(s.sedes);
        setEmpleados(e.filas);
      },
      () => {
        // Si fallan, los desplegables quedan vacíos y el alta sigue siendo
        // posible sin sede ni responsable. No se bloquea el formulario por
        // esto: los dos campos son opcionales.
        if (vigente) setError('No se pudieron cargar sedes y colaboradores.');
      },
    );
    return () => {
      vigente = false;
    };
  }, [isOpen]);

  const limpiar = useCallback(() => {
    setNombreEquipo('');
    setMarca('');
    setModelo('');
    setSerial('');
    setEtiqueta('');
    setSedeId('');
    setEmpleadoId('');
    setCosto('');
    setProcesador('');
    setRam('');
    setDisco('');
    setError(null);
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setError(null);

    try {
      await api.crearEquipo({
        categoria,
        etiqueta: etiqueta || null,
        nombre_equipo: nombreEquipo || null,
        marca: marca || null,
        modelo: modelo || null,
        serial: serial || null,
        procesador: procesador || null,
        disco: disco || null,
        ram: ram || null,
        // El invariante del §2, y un CHECK en la BD:
        // 'Asignado' si y solo si hay responsable.
        estado: empleadoId ? 'Asignado' : 'Disponible',
        sede_id: sedeId || null,
        empleado_id: empleadoId || null,
        costo: costo || null,
      });

      // Lo que ya NO se manda, y por qué:
      //
      // `condicion` iba fija a 'Nuevo'. `verificar-datos.sql` §D prohíbe que un
      // equipo de cómputo tenga condición, y la categoría por defecto de este
      // formulario es 'Portátil': cada alta habría dejado el verificador en
      // rojo. El formulario no pregunta la condición, así que no se afirma.
      //
      // `fecha_compra` se rellenaba con la fecha de hoy. Hoy es cuando se
      // registra el equipo, no cuando se compró. Inventar una fecha de compra
      // para que el campo no quede vacío es exactamente lo que la regla 3
      // prohíbe.

      confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
      limpiar();
      onCreado();
      onClose();
    } catch (err) {
      // Los choques de serial y etiqueta llegan ya traducidos al español desde
      // `server/errores-postgres.ts`. Se muestran tal cual: reescribirlos aquí
      // sería una segunda traducción que se queda atrás.
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar el equipo.');
    } finally {
      setGuardando(false);
    }
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

          {error && (
            <p
              role="alert"
              className="text-xs text-ink bg-danger/15 border border-danger rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-lg border border-slate-200 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{guardando ? 'Guardando…' : 'Guardar Activo en Inventario'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
