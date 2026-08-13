import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, FileSignature, Printer, User, Laptop } from 'lucide-react';

import type {
  ActaEmitida,
  ActaResumen,
  EmpleadoConConteo,
  EquipoConMotivos,
  EquipoFirmable,
  EquipoResumen,
  ModoActa,
  Sede,
  TipoActa,
} from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * El acta de entrega: se consulta, se emite y se descarga.
 *
 * Hasta la etapa 4b el cuerpo lo redactaba Gemini contra
 * `POST /api/gemini/handover-act`, y cuando no había clave de API caía a una
 * plantilla fija. Ya no hay IA en el proyecto (`docs/decisiones-03.md`), así
 * que el acta pasa a plantilla fija siempre — que es lo que debió ser desde el
 * principio: un documento legal tiene formato estable, y una redacción distinta
 * cada vez es un defecto, no una función.
 *
 * La 5a le dio el registro —consecutivo, instantánea, atadura al movimiento— y
 * la 5b el documento: `db/acta-pdf.ts` genera el PDF, reproducible byte a byte,
 * y aquí se descarga. Lo que sigue sin estar cerrado no es código: **el texto
 * de las cláusulas no lo ha revisado nadie de la organización**, y eso se avisa
 * en pantalla y en el pie del propio PDF.
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
  /** En modo «entregar ahora» el acta mueve equipos: los conteos de fuera cambian. */
  onActaEmitida?: () => void;
}

/** El tope que acepta la API. Ver `porPagina` en `server/rutas/equipos.ts`. */
const TOPE = 200;

/**
 * Cómo se llaman los dos modos **en pantalla**.
 *
 * «Firmar» y «ejecutar» son palabras del sistema. Quien entrega un portátil
 * piensa en «se lo estoy dando ahora» o «se lo di el lunes y falta el papel», y
 * esa es la elección que tiene que ver. El nombre técnico no aparece.
 */
const ETIQUETA_MODO: Record<TipoActa, Record<ModoActa, { titulo: string; detalle: string }>> = {
  Entrega: {
    ejecutar: {
      titulo: 'Entregar ahora',
      detalle: 'Registra la entrega y emite el acta a la vez.',
    },
    firmar: {
      titulo: 'Registrar una entrega ya hecha',
      detalle: 'El equipo ya está a su nombre y falta el papel.',
    },
  },
  Devolución: {
    ejecutar: {
      titulo: 'Recibir ahora',
      detalle: 'Registra la devolución y emite el acta a la vez.',
    },
    firmar: {
      titulo: 'Registrar una devolución ya hecha',
      detalle: 'El equipo ya volvió y falta el papel.',
    },
  },
};

export const HandoverDocumentView: React.FC<HandoverDocumentViewProps> = ({
  equipoSeleccionado,
  onActaEmitida,
}) => {
  const [empleados, setEmpleados] = useState<EmpleadoConConteo[]>([]);
  const [equipos, setEquipos] = useState<EquipoConMotivos[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [totales, setTotales] = useState({ empleados: 0, equipos: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  const [empleadoId, setEmpleadoId] = useState<string>('');

  /**
   * **Varios equipos, no uno** (5c). Un onboarding entrega portátil, teclado,
   * ratón y diadema el mismo día; cuatro actas separadas son cuatro números,
   * cuatro firmas y cuatro papeles que archivar — la fricción que devuelve a la
   * gente al método anterior.
   */
  const [seleccionados, setSeleccionados] = useState<string[]>([]);

  /**
   * Qué equipos se pueden firmar hoy para esta persona. Lo calcula el servidor
   * porque el cliente no puede: hace falta saber qué movimientos suyos siguen
   * sin acta, y eso no está en la lista de equipos.
   */
  const [firmables, setFirmables] = useState<EquipoFirmable[]>([]);
  /** Los que tiene a su nombre ahora mismo. Para devolver. */
  const [suyos, setSuyos] = useState<EquipoResumen[]>([]);

  /**
   * Etapa 5a: la vista deja de ser solo lectura y **emite**.
   *
   * El acta se emite sobre un movimiento que ya ocurrió, así que aquí no se
   * elige «entregar»: se elige de qué operación pasada se firma el papel. Si no
   * ha ocurrido, el servidor responde 409 y el mensaje lo explica.
   */
  const [tipo, setTipo] = useState<TipoActa>('Entrega');
  /**
   * `ejecutar` hace la operación y la firma; `firmar` documenta una que ya
   * ocurrió. En pantalla no se llaman así — ver `ETIQUETA_MODO`.
   */
  const [modo, setModo] = useState<ModoActa>('ejecutar');
  const [emitiendo, setEmitiendo] = useState(false);
  const [errorEmitir, setErrorEmitir] = useState<string | null>(null);
  const [emitida, setEmitida] = useState<ActaEmitida | null>(null);
  const [historial, setHistorial] = useState<ActaResumen[]>([]);

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
  // El equipo que llega desde el inventario entra ya marcado. Los demás los
  // marca quien emite: preseleccionar el primero de la lista sería elegir por
  // él, y aquí lo que se elige acaba en un papel firmado.
  useEffect(() => {
    if (equipoSeleccionado?.id) setSeleccionados([equipoSeleccionado.id]);
  }, [equipoSeleccionado]);

  useEffect(() => {
    if (!empleados.length) return;
    setEmpleadoId((actual) => actual || equipoSeleccionado?.empleado_id || empleados[0].id);
  }, [empleados, equipoSeleccionado]);

  const cargarHistorial = useCallback(async (idEmpleado: string) => {
    try {
      const r = await api.actas({ empleado: idEmpleado });
      setHistorial(r.actas);
    } catch {
      // El historial es contexto, no el trabajo: si no carga, emitir sigue
      // funcionando y el acta recién emitida se enseña igual.
      setHistorial([]);
    }
  }, []);

  // Cambiar de colaborador trae sus actas y borra el acuse de la anterior: el
  // «Acta ACT-2026-0007 emitida» de otra persona junto a los datos de esta es
  // la confusión que hace firmar el papel equivocado.
  useEffect(() => {
    setEmitida(null);
    setErrorEmitir(null);
    if (empleadoId) void cargarHistorial(empleadoId);
    else setHistorial([]);
  }, [empleadoId, cargarHistorial]);

  /**
   * Lo que se puede elegir depende de **modo × tipo**, y son cuatro casos, no
   * dos:
   *
   *   ejecutar + Entrega    → los disponibles o reservados
   *   ejecutar + Devolución → los que tiene a su nombre hoy
   *   firmar   + Entrega    → los que ya tiene y cuya entrega no se firmó
   *   firmar   + Devolución → los que devolvió y cuya devolución no se firmó
   *
   * La celda que lo demuestra es `firmar + Entrega`: documentar una entrega que
   * ya ocurrió necesita los equipos que la persona **ya tiene**, no los
   * disponibles. Filtrar siempre por disponibles dejaría tres de los cuatro
   * casos sin nada que ofrecer.
   */
  useEffect(() => {
    if (!empleadoId) return;
    let vigente = true;
    setSeleccionados([]);

    if (modo === 'firmar') {
      api.actasFirmables(empleadoId, tipo).then(
        (r) => vigente && setFirmables(r.equipos),
        () => vigente && setFirmables([]),
      );
    } else if (tipo === 'Devolución') {
      api.equiposDe(empleadoId).then(
        (r) => vigente && setSuyos(r.equipos),
        () => vigente && setSuyos([]),
      );
    }
    return () => {
      vigente = false;
    };
  }, [empleadoId, modo, tipo]);

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

  /** Lo elegible ahora mismo, ya normalizado a una forma común. */
  const candidatos: {
    id: string;
    nombre: string;
    etiqueta: string | null;
    serial: string | null;
    categoria: string;
    sede_id: string | null;
  }[] =
    modo === 'firmar'
      ? firmables.map((e) => ({
          id: e.id,
          nombre: [e.marca, e.modelo].filter(Boolean).join(' ') || e.categoria,
          etiqueta: e.etiqueta,
          serial: e.serial,
          categoria: e.categoria,
          sede_id: e.sede_id,
        }))
      : tipo === 'Devolución'
        ? suyos.map((e) => ({
            id: e.id,
            nombre: [e.marca, e.modelo].filter(Boolean).join(' ') || e.categoria,
            etiqueta: e.etiqueta,
            serial: e.serial,
            categoria: e.categoria,
            sede_id: null,
          }))
        : equipos
            .filter((e) => e.estado === 'Disponible' || e.estado === 'Reservado')
            .map((e) => ({
              id: e.id,
              nombre: nombreEquipo(e),
              etiqueta: e.etiqueta,
              serial: e.serial,
              categoria: e.categoria,
              sede_id: e.sede_id ?? null,
            }));

  const elegidos = candidatos.filter((e) => seleccionados.includes(e.id));

  /**
   * Equipos elegidos que están en otra sede que la persona.
   *
   * **Avisa, no bloquea** (D27): el acta no abre un traslado —firmar la
   * recepción de algo que viaja mete en el documento un hecho que no ha
   * ocurrido— pero la persona puede haber ido a recogerlo, y eso no lo sabe el
   * sistema.
   */
  const enOtraSede =
    modo === 'ejecutar' && tipo === 'Entrega' && empleado?.sede_id
      ? elegidos.filter((e) => e.sede_id && e.sede_id !== empleado.sede_id)
      : [];

  const alternar = (id: string) =>
    setSeleccionados((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const emitir = async () => {
    if (!empleadoId || seleccionados.length === 0) return;
    setEmitiendo(true);
    setErrorEmitir(null);
    try {
      const r = await api.emitirActa({
        tipo,
        modo, // siempre explícito: el servidor asume `firmar` si falta
        empleado_id: empleadoId,
        equipos: seleccionados,
      });
      setEmitida(r.acta);
      setSeleccionados([]);
      await cargarHistorial(empleadoId);
      // Lo elegible ha cambiado: lo que se acaba de entregar ya no está
      // disponible, y lo que se acaba de firmar ya no está pendiente.
      onActaEmitida?.();
      if (modo === 'firmar') {
        await api.actasFirmables(empleadoId, tipo).then((x) => setFirmables(x.equipos), () => {});
      } else if (tipo === 'Devolución') {
        await api.equiposDe(empleadoId).then((x) => setSuyos(x.equipos), () => {});
      } else {
        await cargar();
      }
    } catch (e) {
      // El 409 del servidor explica el orden («primero la operación, después el
      // papel») y se enseña tal cual: es la frase que hay que leer.
      setErrorEmitir(e instanceof ErrorApi ? e.message : 'No se pudo emitir el acta.');
    } finally {
      setEmitiendo(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">
            Generador de Actas de Entrega de Equipo
          </h1>
          <p className="text-xs text-ink-muted">
            Datos leídos del inventario. El acta se emite sobre una operación ya registrada.
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
          <label htmlFor="acta-tipo" className="block text-xs font-bold text-ink-muted uppercase mb-1">
            Tipo de acta
          </label>
          <select
            id="acta-tipo"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as 'Entrega' | 'Devolución');
              setEmitida(null);
              setErrorEmitir(null);
            }}
            className="w-full bg-surface-alt border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:border-brand"
          >
            <option value="Entrega">Entrega — documenta la asignación</option>
            <option value="Devolución">Devolución — documenta la devolución</option>
          </select>
        </div>

        {/* El modo, con las palabras de quien entrega y no las del sistema. */}
        <div className="sm:col-span-2">
          <span className="block text-xs font-bold text-ink-muted uppercase mb-1">
            ¿Qué está pasando?
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(['ejecutar', 'firmar'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setModo(m);
                  setEmitida(null);
                  setErrorEmitir(null);
                }}
                className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                  modo === m
                    ? 'border-brand bg-brand-subtle text-ink'
                    : 'border-line bg-surface-alt text-ink-muted hover:bg-surface'
                }`}
              >
                <span className="block font-semibold">{ETIQUETA_MODO[tipo][m].titulo}</span>
                <span className="block">{ETIQUETA_MODO[tipo][m].detalle}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Los equipos: varios, y filtrados por modo × tipo. */}
        <div className="sm:col-span-2">
          <span className="block text-xs font-bold text-ink-muted uppercase mb-1">
            {tipo === 'Entrega' ? 'Equipos a entregar' : 'Equipos que devuelve'}
            {elegidos.length > 0 && (
              <span className="text-brand"> · {elegidos.length} elegido{elegidos.length === 1 ? '' : 's'}</span>
            )}
          </span>

          {candidatos.length === 0 ? (
            <p className="text-xs text-ink-muted border border-dashed border-line rounded-lg p-3">
              {modo === 'firmar'
                ? `No hay ninguna ${tipo.toLowerCase()} de ${empleado?.nombre ?? 'esta persona'} pendiente de firmar. Si la operación es ahora, usar «${ETIQUETA_MODO[tipo].ejecutar.titulo}».`
                : tipo === 'Devolución'
                  ? 'No tiene ningún equipo a su nombre.'
                  : 'No hay equipos disponibles ni reservados para entregar.'}
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {candidatos.map((e) => (
                <label
                  key={e.id}
                  className="flex items-center gap-3 bg-surface-alt p-2.5 rounded-lg border border-line cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={seleccionados.includes(e.id)}
                    onChange={() => alternar(e.id)}
                    className="w-4 h-4 rounded border-line text-brand"
                  />
                  <span className="text-xs text-ink">
                    <strong>{e.nombre}</strong>
                    <span className="text-ink-muted">
                      {' '}· {e.categoria} · {e.etiqueta ?? 'sin etiqueta'} ·{' '}
                      {e.serial ?? 'sin serial'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {enOtraSede.length > 0 && (
            <p className="mt-2 text-xs text-ink bg-warn/20 border border-warn/50 rounded-lg px-3 py-2">
              {enOtraSede.length === 1
                ? `${enOtraSede[0].nombre} está en otra sede`
                : `${enOtraSede.length} de los equipos están en otra sede`}{' '}
              y {empleado?.nombre} está en {nombreSede(empleado?.sede_id ?? null)}. El acta
              registra la entrega, <strong>no abre el traslado</strong>: si el equipo tiene que
              viajar, el acta diría que lo recibió antes de que llegue. Si fue a recogerlo, se
              puede emitir igual.
            </p>
          )}
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

        {/* Los equipos elegidos — reales, de `equipos`. Uno o varios (5c). */}
        <div className="bg-slate-100 p-3 rounded-lg border border-slate-300 space-y-2">
          <div className="font-bold uppercase text-[10px] text-slate-500 flex items-center gap-1.5">
            <Laptop className="w-3 h-3" />
            {elegidos.length === 1
              ? 'Detalles del equipo tecnológico'
              : `Equipos incluidos (${elegidos.length})`}
          </div>

          {elegidos.length === 0 ? (
            <p className="text-xs text-slate-500">
              Ningún equipo elegido todavía. El acta necesita al menos uno.
            </p>
          ) : (
            elegidos.map((sel) => {
              // La ficha completa solo la tenemos de los que vienen del listado
              // general; los de `firmables` y los de la persona traen lo justo
              // para identificarlos. Lo que falta se enseña como «—», nunca
              // inventado.
              const ficha = equipos.find((e) => e.id === sel.id) ?? null;
              return (
                <div
                  key={sel.id}
                  className="grid grid-cols-2 gap-2 text-xs border-t border-slate-300 pt-2 first:border-0 first:pt-0"
                >
                  <div>
                    Equipo / modelo: <strong>{sel.nombre}</strong>
                  </div>
                  <div>
                    Etiqueta de activo: <strong>{sel.etiqueta ?? '—'}</strong>
                  </div>
                  <div>
                    Número de serie: <strong>{sel.serial ?? '—'}</strong>
                  </div>
                  {/* El enrolamiento MDM se fue con D3: no hay MDM, y el acta no
                      puede afirmar algo que nadie comprobó. La licencia de
                      Windows sí es un dato real del equipo. */}
                  <div>
                    Licencia: <strong>{ficha?.licencia_tipo ?? '—'}</strong>
                  </div>
                  <div>
                    Sede del equipo: <strong>{nombreSede(sel.sede_id)}</strong>
                  </div>
                  <div>
                    Estado: <strong>{ficha?.estado ?? '—'}</strong>
                  </div>
                  <div className="col-span-2">
                    Especificaciones: <strong>{ficha ? especificaciones(ficha) : '—'}</strong>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ---------------------------------------------------------------
            Emitir. Etapa 5a: el acta ya se registra en la base.

            Registrar el acta y redactar su cuerpo legal son dos cosas, y esta
            es la primera. El consecutivo, la instantánea y la atadura al
            movimiento existen desde aquí; las cláusulas y el PDF, en la 5b.
            --------------------------------------------------------------- */}
        <div className="border border-line rounded-lg p-4 space-y-3 print:hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-ink">Registrar el acta</p>
              <p className="text-xs text-ink-muted">
                Toma número consecutivo y congela lo que el equipo y la persona son ahora. Se
                emite sobre la {tipo === 'Entrega' ? 'asignación' : 'devolución'} que ya está en
                el historial.
              </p>
            </div>
            <button
              onClick={() => void emitir()}
              disabled={emitiendo || !empleadoId || seleccionados.length === 0}
              className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shrink-0"
            >
              <FileSignature className="w-4 h-4" />
              {emitiendo ? 'Registrando…' : `Emitir acta de ${tipo}`}
            </button>
          </div>

          {errorEmitir && (
            <p
              role="alert"
              className="text-xs text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2"
            >
              {errorEmitir}
            </p>
          )}

          {emitida && (
            <div className="bg-ok/10 border border-ok/40 rounded-lg p-3 space-y-2 text-xs">
              <p className="font-semibold text-ink">
                Acta {emitida.consecutivo} · {emitida.tipo}
              </p>
              <p className="text-ink-muted">
                {new Date(emitida.fecha).toLocaleString('es-CO')} · emitida por{' '}
                {emitida.generada_por_nombre}
              </p>
              {/* Lo que el acta DICE, leído de su instantánea. No se vuelve a
                  consultar el equipo: si mañana se corrige su serial, este
                  bloque tiene que seguir mostrando el de hoy. */}
              <ul className="space-y-0.5 text-ink">
                <li>
                  {emitida.empleado_nombre}
                  {emitida.empleado_cargo ? ` — ${emitida.empleado_cargo}` : ''}
                  {emitida.sede_nombre ? ` · ${emitida.sede_nombre}` : ''}
                </li>
                {emitida.equipos.map((l) => (
                  <li key={l.equipo_id}>
                    {[l.marca, l.modelo].filter(Boolean).join(' ') || l.categoria}
                    {l.etiqueta ? ` (${l.etiqueta})` : ''} · serial {l.serial ?? '—'}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <a
                  href={`/api/actas/${emitida.id}/pdf`}
                  download={`${emitida.consecutivo}.pdf`}
                  className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  Descargar {emitida.consecutivo}.pdf
                </a>
                {emitida.hash_sha256 && (
                  <span className="text-ink-muted font-mono" title={emitida.hash_sha256}>
                    sha256 {emitida.hash_sha256.slice(0, 12)}…
                  </span>
                )}
              </div>
              <p className="text-ink-muted">
                El documento se generó con la instantánea de arriba y su hash queda guardado
                junto a él. Regenerarlo desde esos mismos datos da el mismo fichero.
              </p>
            </div>
          )}

          {historial.length > 0 && (
            <div className="text-xs space-y-1">
              <p className="font-semibold text-ink-muted uppercase">
                Actas de {empleado?.nombre ?? 'este colaborador'}
              </p>
              <ul className="space-y-0.5">
                {historial.map((a) => (
                  <li key={a.id} className="text-ink-muted flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-ink">{a.consecutivo}</span>
                    <span>
                      · {a.tipo} · {new Date(a.fecha).toLocaleDateString('es-CO')} · {a.equipos}{' '}
                      equipo{a.equipos === 1 ? '' : 's'}
                    </span>
                    {a.tiene_pdf ? (
                      <a
                        href={`/api/actas/${a.id}/pdf`}
                        download={`${a.consecutivo}.pdf`}
                        className="text-brand hover:underline inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        PDF
                      </a>
                    ) : (
                      // Las emitidas en la 5a, antes de que hubiera generación.
                      <span className="text-ink-faint">sin PDF</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/*
          El TODO(5) se fue: el acta se registra y su PDF se descarga.

          Lo que queda no es un hueco de implementación sino un hecho sobre el
          documento —su texto no lo ha revisado nadie de la organización—, y por
          eso se dice como hecho y no como pendiente. El propio PDF lo lleva
          impreso en el pie. Se quita de los dos sitios a la vez, cambiando
          `PLANTILLA_VERSION` en `db/acta-pdf.ts`.
        */}
        <div className="border border-warn/50 bg-warn/10 rounded-lg p-4 space-y-1 print:hidden">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <AlertTriangle className="w-4 h-4 text-warn" />
            El texto del acta está sin revisar por legal
          </p>
          <p className="text-xs leading-relaxed text-ink-muted">
            Las cláusulas son un borrador escrito a partir de la plantilla del prototipo. Quien
            decide qué debe decir un acta de entrega en esta organización no es quien la
            programa: hay que pasarla por quien vaya a firmarla. Mientras tanto el PDF lo dice
            en su pie, para que no se firme creyendo que está aprobado.
          </p>
          <p className="text-xs text-ink-muted">
            La razón social y el NIT salen de <span className="font-mono">ORGANIZACION_RAZON_SOCIAL</span>{' '}
            y <span className="font-mono">ORGANIZACION_NIT</span>. Sin ellas el acta imprime el
            hueco en blanco, nunca un nombre inventado.
          </p>
        </div>
      </div>
    </div>
  );
};
