import React, { useCallback, useEffect, useState } from 'react';
import { CircleDashed, Printer, User, Laptop } from 'lucide-react';

import type { EmpleadoConConteo, EquipoConMotivos, Sede } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * El acta de entrega, en modo lectura.
 *
 * Hasta la etapa 4b el cuerpo lo redactaba Gemini contra
 * `POST /api/gemini/handover-act`, y cuando no había clave de API caía a una
 * plantilla fija. Ya no hay IA en el proyecto (`docs/decisiones-03.md`), así
 * que el acta pasa a plantilla fija siempre — que es lo que debió ser desde el
 * principio: un documento legal tiene formato estable, y una redacción distinta
 * cada vez es un defecto, no una función.
 *
 * **Esa plantilla es trabajo de la etapa 5.** Lo que hace esta vista hoy es
 * leer de la base los datos que el acta necesita, que es la mitad que sí
 * pertenece a la 4b. El cuerpo —cláusulas, número de acta, firmante de la
 * empresa— queda como hueco declarado: ver `docs/pendientes.md`.
 *
 * Lo que traía el prototipo en su lugar no era un borrador, era relleno:
 * razón social de otra empresa, un número de acta inventado, una firmante que
 * no existe y una cláusula sobre el agente MDM, que D3 retiró del proyecto. Un
 * acta con datos inventados es peor que un acta a medias, porque la de a medias
 * no se puede firmar por error.
 */

interface HandoverDocumentViewProps {
  /** Llega desde `InventoryView` al pulsar «generar acta» en una fila. */
  equipoSeleccionado?: EquipoConMotivos | null;
}

/** El tope que acepta la API. Ver `porPagina` en `server/rutas/equipos.ts`. */
const TOPE = 200;

export const HandoverDocumentView: React.FC<HandoverDocumentViewProps> = ({
  equipoSeleccionado,
}) => {
  const [empleados, setEmpleados] = useState<EmpleadoConConteo[]>([]);
  const [equipos, setEquipos] = useState<EquipoConMotivos[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [totales, setTotales] = useState({ empleados: 0, equipos: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  const [empleadoId, setEmpleadoId] = useState<string>('');
  const [equipoId, setEquipoId] = useState<string>('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      // En paralelo: son tres lecturas independientes y encadenarlas solo
      // triplicaría la espera.
      const [e, q, s] = await Promise.all([
        api.empleados({ porPagina: TOPE, activo: true }),
        api.equipos({ porPagina: TOPE }),
        api.sedes(),
      ]);
      setEmpleados(e.filas);
      setEquipos(q.filas);
      setSedes(s.sedes);
      setTotales({ empleados: e.total, equipos: q.total });
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, String(e)));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * La preselección se aplica **cuando llegan los datos**, no en el
   * `useState`: en el primer render las listas están vacías y cualquier valor
   * por defecto calculado ahí sería el de una lista de cero elementos.
   */
  useEffect(() => {
    if (!equipos.length) return;
    setEquipoId((actual) => actual || equipoSeleccionado?.id || equipos[0].id);
  }, [equipos, equipoSeleccionado]);

  useEffect(() => {
    if (!empleados.length) return;
    setEmpleadoId((actual) => actual || equipoSeleccionado?.empleado_id || empleados[0].id);
  }, [empleados, equipoSeleccionado]);

  if (cargando) return <Cargando que="los datos del acta" />;
  if (error) return <ErrorDeCarga error={error} que="los datos del acta" onReintentar={cargar} />;
  if (!equipos.length) {
    return (
      <Vacio
        titulo="No hay equipos que entregar"
        detalle="Un acta necesita un equipo y un colaborador. Cuando haya inventario, esta vista se llena sola."
      />
    );
  }

  const empleado = empleados.find((e) => e.id === empleadoId) ?? null;
  const equipo = equipos.find((e) => e.id === equipoId) ?? null;

  /** Ya no hay `name` ni `specs`: el nombre se compone y las specs son columnas. */
  const nombreEquipo = (e: EquipoConMotivos) =>
    e.nombre_equipo ?? e.etiqueta ?? ([e.marca, e.modelo].filter(Boolean).join(' ') || 'Equipo');

  const especificaciones = (e: EquipoConMotivos) =>
    [e.procesador, e.ram, e.disco, e.sistema_operativo].filter(Boolean).join(', ') || '—';

  /** Resuelve el `sede_id` a nombre. Cierra el TODO(4b) que había aquí. */
  const nombreSede = (id: string | null) =>
    (id && sedes.find((s) => s.id === id)?.nombre) || '—';

  // Las listas van topadas a 200. Si algún día no caben, hay que decirlo: un
  // desplegable recortado en silencio es la forma más limpia de firmar el acta
  // del equipo equivocado.
  const recortado =
    totales.equipos > equipos.length || totales.empleados > empleados.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">
            Generador de Actas de Entrega de Equipo
          </h1>
          <p className="text-xs text-ink-muted">
            Datos leídos del inventario. La redacción del acta llega en la etapa 5.
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-alt text-ink-muted text-xs font-semibold rounded-lg border border-line transition-colors"
        >
          <Printer className="w-4 h-4 text-ink-muted" />
          <span>Imprimir / PDF</span>
        </button>
      </div>

      {recortado && (
        <p className="text-xs text-ink bg-warn/25 border border-warn rounded-lg px-3 py-2">
          Los desplegables muestran los primeros {TOPE}. Hay {totales.equipos} equipos y{' '}
          {totales.empleados} colaboradores activos: falta buscador, y hasta entonces puede no
          estar el que busca.
        </p>
      )}

      {/* Selectores */}
      <div className="bg-surface border border-line rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-sm">
        <div>
          <label
            htmlFor="acta-empleado"
            className="block text-xs font-bold text-ink-muted uppercase mb-1"
          >
            Colaborador receptor
          </label>
          <select
            id="acta-empleado"
            value={empleadoId}
            onChange={(e) => setEmpleadoId(e.target.value)}
            className="w-full bg-surface-alt border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:border-brand"
          >
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
                {e.cargo ? ` (${e.cargo})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="acta-equipo"
            className="block text-xs font-bold text-ink-muted uppercase mb-1"
          >
            Equipo a entregar
          </label>
          <select
            id="acta-equipo"
            value={equipoId}
            onChange={(e) => setEquipoId(e.target.value)}
            className="w-full bg-surface-alt border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:border-brand"
          >
            {equipos.map((d) => (
              <option key={d.id} value={d.id}>
                {nombreEquipo(d)} [{d.etiqueta ?? '—'} · {d.serial ?? '—'}]
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* El documento */}
      <div className="bg-white text-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-300 max-w-3xl mx-auto space-y-6 print:m-0 print:p-0 print:shadow-none print:border-none">
        <div className="text-center font-bold text-lg tracking-wide uppercase border-b-2 border-slate-900 pb-3">
          Acta de entrega y responsabilidad de equipo tecnológico
        </div>

        {/* Datos del colaborador — reales, de `empleados` */}
        <div className="bg-slate-100 p-3 rounded-lg border border-slate-300 space-y-1">
          <div className="font-bold uppercase text-[10px] text-slate-500 flex items-center gap-1.5">
            <User className="w-3 h-3" />
            Datos del colaborador receptor
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              Nombre: <strong>{empleado?.nombre ?? '—'}</strong>
            </div>
            <div>
              Puesto: <strong>{empleado?.cargo ?? '—'}</strong>
            </div>
            <div>
              Área: <strong>{empleado?.area ?? '—'}</strong>
            </div>
            <div>
              Cédula: <strong>{empleado?.cedula ?? '—'}</strong>
            </div>
            <div className="col-span-2">
              Sede: <strong>{nombreSede(empleado?.sede_id ?? null)}</strong>
            </div>
          </div>
        </div>

        {/* Datos del equipo — reales, de `equipos` */}
        <div className="bg-slate-100 p-3 rounded-lg border border-slate-300 space-y-1">
          <div className="font-bold uppercase text-[10px] text-slate-500 flex items-center gap-1.5">
            <Laptop className="w-3 h-3" />
            Detalles del equipo tecnológico
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              Equipo / modelo: <strong>{equipo ? nombreEquipo(equipo) : '—'}</strong>
            </div>
            <div>
              Etiqueta de activo: <strong>{equipo?.etiqueta ?? '—'}</strong>
            </div>
            <div>
              Número de serie: <strong>{equipo?.serial ?? '—'}</strong>
            </div>
            {/* El enrolamiento MDM se fue con D3: no hay MDM, y el acta no puede
                afirmar algo que nadie comprobó. La licencia de Windows sí es un
                dato real del equipo. */}
            <div>
              Licencia: <strong>{equipo?.licencia_tipo ?? '—'}</strong>
            </div>
            <div>
              Sede del equipo: <strong>{nombreSede(equipo?.sede_id ?? null)}</strong>
            </div>
            <div>
              Estado: <strong>{equipo?.estado ?? '—'}</strong>
            </div>
            <div className="col-span-2">
              Especificaciones: <strong>{equipo ? especificaciones(equipo) : '—'}</strong>
            </div>
          </div>
        </div>

        {/*
          TODO(5): el cuerpo del acta.

          Va aquí: razón social, número de acta, cláusulas de custodia y uso,
          protocolo de devolución y los dos bloques de firma. El punto de
          partida está transcrito en `docs/pendientes.md`, y tiene que pasar por
          alguien de legal antes de imprimirse.

          El hueco se ve a propósito, igual que en el dashboard: un acta que se
          imprime con aspecto de completa y sin cláusulas es la que alguien
          firma sin mirar.
        */}
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-500">
            <CircleDashed className="w-4 h-4" />
            Cuerpo del acta — pendiente (etapa 5)
          </p>
          <p className="text-xs leading-relaxed text-slate-500">
            Las cláusulas de custodia y uso, el número de acta y los bloques de firma se redactan
            en la etapa 5, a partir de una plantilla fija revisada por legal. Hasta entonces este
            documento sirve para consultar los datos, <strong>no para firmarse</strong>.
          </p>
          <p className="text-xs text-slate-500">
            Ver <span className="font-mono">docs/pendientes.md</span>, etapa 5.
          </p>
        </div>
      </div>
    </div>
  );
};
