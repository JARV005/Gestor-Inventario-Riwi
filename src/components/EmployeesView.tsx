import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building,
  ChevronLeft,
  ChevronRight,
  Laptop,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react';

import type { DatosEmpleado, EmpleadoConConteo, Empresa, EquipoResumen, Sede } from '../types';
import { EMPRESAS, ESTADOS_EMPLEADO } from '../types';
import { api, ErrorApi } from '../lib/api';
import { Cargando, ErrorDeCarga, Vacio } from './EstadoCarga';

/**
 * Los 113 colaboradores reales, desde Postgres.
 *
 * Es la vista que demuestra que la relación se recalcula bien desde el lado de
 * equipos ahora que `assignedDeviceIds[]` no existe (D2): el número de equipos
 * de cada tarjeta lo cuenta el servidor con una subconsulta sobre
 * `equipos.empleado_id`, y la lista completa se pide al desplegar la tarjeta.
 *
 * La 5d le añade tres cosas que BBL pidió: el filtro por empresa **con el
 * conteo de «Sin clasificar» a la vista** (D28), el alta y la edición de la
 * ficha, y el aviso de dirección para quien no tiene oficina (D30).
 *
 * El conteo se pinta arriba y no se deja para el desplegable a propósito. Es el
 * mismo mecanismo que la bandeja de revisión de equipos: 37 equipos se
 * quedaron en «licencia OK» hasta que un número delante los puso en la
 * conversación. Un valor más en un `<select>` no cuenta nada.
 */

interface EmployeesViewProps {
  onOpenOnboardingModal: () => void;
  onOpenOffboardingModal: (empleado: EmpleadoConConteo) => void;
}

const iniciales = (nombre: string) =>
  nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();

const colorEstado: Record<string, string> = {
  Activo: 'bg-ok/15 text-ink border border-ok/40',
  Onboarding: 'bg-info/20 text-ink border border-info/50',
  Offboarding: 'bg-warn/20 text-ink border border-warn/50',
  Inactivo: 'bg-surface-alt text-ink-muted border border-line',
};

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  onOpenOnboardingModal,
  onOpenOffboardingModal,
}) => {
  const [q, setQ] = useState('');
  const [sede, setSede] = useState('');
  const [empresa, setEmpresa] = useState<'' | Empresa>('');
  const [estado, setEstado] = useState('');
  const [soloActivos, setSoloActivos] = useState<'' | 'true' | 'false'>('');
  const [pagina, setPagina] = useState(1);

  const [filas, setFilas] = useState<EmpleadoConConteo[]>([]);
  const [total, setTotal] = useState(0);
  const [sedes, setSedes] = useState<Sede[]>([]);

  /**
   * El conteo por empresa, tal y como lo manda el servidor: con las tres
   * claves siempre. Que «Sin clasificar» siga estando cuando vale cero importa
   * — `GROUP BY` no devuelve grupos vacíos, y sin rellenarla no se podría
   * distinguir «ninguna» de «no se pudo contar».
   */
  const [conteos, setConteos] = useState<Record<string, number> | null>(null);

  /** `'nuevo'` para el alta, el empleado para editarlo, `null` cerrado. */
  const [editando, setEditando] = useState<EmpleadoConConteo | 'nuevo' | null>(null);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);

  /** Equipos de cada empleado, pedidos solo al desplegar su tarjeta. */
  const [desplegado, setDesplegado] = useState<string | null>(null);
  const [equiposDe, setEquiposDe] = useState<
    Record<string, EquipoResumen[] | 'cargando' | 'error'>
  >({});

  /**
   * Desactivar: qué ficha se está desactivando, y el fallo de la última.
   *
   * El error se guarda con el id porque las tarjetas están en una rejilla: un
   * mensaje global aparecería lejos del botón que se pulsó, y con 24 fichas en
   * pantalla nadie sabría a cuál se refiere.
   */
  const [desactivandoId, setDesactivandoId] = useState<string | null>(null);
  const [errorDesactivar, setErrorDesactivar] = useState<{ id: string; mensaje: string } | null>(
    null,
  );

  const porPagina = 24;

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const datos = await api.empleados({
        q,
        sede,
        empresa: empresa || undefined,
        activo: soloActivos === '' ? undefined : soloActivos === 'true',
        pagina,
        porPagina,
      });
      setFilas(datos.filas);
      setTotal(datos.total);
      // Los conteos son del total, no de la página ni del filtro: es lo que
      // hace que «Sin clasificar: 113» siga viéndose mientras se mira RIWI.
      setConteos(datos.conteos_empresa);
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
      setFilas([]);
      setTotal(0);
      setConteos(null);
    } finally {
      setCargando(false);
    }
  }, [q, sede, empresa, soloActivos, pagina]);

  const desactivar = useCallback(
    async (emp: EmpleadoConConteo) => {
      setDesactivandoId(emp.id);
      setErrorDesactivar(null);
      try {
        await api.desactivarEmpleado(emp.id);
        await cargar();
      } catch (e) {
        // El 409 dice «No se puede desactivar a un empleado con equipos a su
        // nombre. Devolverlos primero.» Se enseña tal cual, que es lo que hay
        // que hacer, y el botón de Offboarding está justo encima.
        setErrorDesactivar({
          id: emp.id,
          mensaje: e instanceof ErrorApi ? e.message : 'No se pudo desactivar.',
        });
      } finally {
        setDesactivandoId(null);
      }
    },
    [cargar],
  );

  useEffect(() => {
    const t = setTimeout(cargar, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, q]);

  useEffect(() => {
    api.sedes().then(
      (d) => setSedes(d.sedes),
      () => setSedes([]),
    );
  }, []);

  useEffect(() => setPagina(1), [q, sede, empresa, estado, soloActivos]);

  const desplegar = async (emp: EmpleadoConConteo) => {
    if (desplegado === emp.id) {
      setDesplegado(null);
      return;
    }
    setDesplegado(emp.id);
    if (Array.isArray(equiposDe[emp.id])) return;
    setEquiposDe((p) => ({ ...p, [emp.id]: 'cargando' }));
    try {
      const d = await api.equiposDe(emp.id);
      setEquiposDe((p) => ({ ...p, [emp.id]: d.equipos }));
    } catch {
      setEquiposDe((p) => ({ ...p, [emp.id]: 'error' }));
    }
  };

  const nombreSede = (id: string | null) =>
    id ? (sedes.find((s) => s.id === id)?.nombre ?? '—') : '—';

  /**
   * Si a esta persona le falta la dirección y su sede no es un sitio.
   *
   * La condición es `ciudad === null`, no `nombre === 'Remoto'`. La semilla ya
   * dice por qué: «`Remoto` no es un lugar, por eso no lleva ciudad». Buscar el
   * nombre literal ataría el aviso a una fila concreta de una tabla que se
   * edita desde la interfaz; buscar la ciudad vacía lo ata a la propiedad que
   * lo causa, y cubre sola cualquier sede futura que tampoco sea una oficina.
   */
  const faltaDireccion = (emp: EmpleadoConConteo) => {
    if (emp.direccion && emp.direccion.trim() !== '') return false;
    const s = sedes.find((x) => x.id === emp.sede_id);
    return s !== undefined && s.ciudad === null;
  };

  const visibles = estado ? filas.filter((e) => e.estado === estado) : filas;
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="space-y-5">
      {editando && (
        <FormularioEmpleado
          empleado={editando === 'nuevo' ? null : editando}
          sedes={sedes}
          onCerrar={() => setEditando(null)}
          onGuardado={async () => {
            setEditando(null);
            await cargar();
          }}
        />
      )}

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Users className="w-6 h-6 text-brand" />
            Colaboradores
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {cargando && filas.length === 0
              ? 'Cargando…'
              : `${total} persona${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargar}
            disabled={cargando}
            className="px-3 py-2 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface-alt disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          {/* Dos altas distintas y separadas a propósito: la ficha es un dato,
              el onboarding es una entrega de equipos con sus movimientos. */}
          <button
            onClick={() => setEditando('nuevo')}
            className="px-3 py-2 text-sm border border-line rounded-lg text-ink hover:bg-surface-alt flex items-center gap-1.5"
          >
            <UserPlus className="w-4 h-4" />
            Nueva ficha
          </button>
          <button
            onClick={onOpenOnboardingModal}
            className="px-3 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Onboarding
          </button>
        </div>
      </header>

      {/* Los conteos por empresa. Cada uno filtra de un clic, y el de «Sin
          clasificar» se pinta distinto porque no es una categoría más: es una
          tarea pendiente que nadie ha hecho. */}
      {conteos && (
        <div className="flex flex-wrap items-center gap-2">
          {EMPRESAS.map((e) => {
            const n = conteos[e] ?? 0;
            const activo = empresa === e;
            const pendiente = e === 'Sin clasificar' && n > 0;
            return (
              <button
                key={e}
                onClick={() => setEmpresa(activo ? '' : e)}
                className={`px-3 py-1.5 text-xs rounded-lg border flex items-center gap-2 ${
                  activo
                    ? 'border-brand bg-brand/10 text-ink'
                    : pendiente
                      ? 'border-warn/50 bg-warn/10 text-ink hover:bg-warn/20'
                      : 'border-line text-ink-muted hover:bg-surface-alt'
                }`}
              >
                {pendiente && <AlertTriangle className="w-3.5 h-3.5 text-warn" />}
                {e}
                <strong className="tabular-nums text-ink">{n}</strong>
              </button>
            );
          })}
          {empresa && (
            <button
              onClick={() => setEmpresa('')}
              className="text-xs text-ink-muted hover:text-ink px-2"
            >
              Quitar filtro
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre, cédula o correo…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </div>
        <select
          value={sede}
          onChange={(e) => setSede(e.target.value)}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Todas las sedes</option>
          {sedes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_EMPLEADO.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value as '' | Empresa)}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Todas las empresas</option>
          {EMPRESAS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          value={soloActivos}
          onChange={(e) => setSoloActivos(e.target.value as '' | 'true' | 'false')}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Activos e inactivos</option>
          <option value="true">Solo activos</option>
          <option value="false">Solo inactivos</option>
        </select>
      </div>

      {error ? (
        <ErrorDeCarga error={error} que="los colaboradores" onReintentar={cargar} />
      ) : cargando && filas.length === 0 ? (
        <Cargando que="los colaboradores" />
      ) : visibles.length === 0 ? (
        <Vacio
          titulo="Ninguna persona coincide"
          detalle="Probar con menos filtros, o limpiarlos todos."
        />
      ) : (
        <>
          <div
            className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${cargando ? 'opacity-60' : ''}`}
          >
            {visibles.map((emp) => {
              const equipos = equiposDe[emp.id];
              const abierto = desplegado === emp.id;
              return (
                <article
                  key={emp.id}
                  className={`bg-surface border border-line rounded-xl p-4 space-y-3 ${
                    emp.activo ? '' : 'bg-surface-alt/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-brand/10 text-brand grid place-items-center font-bold text-sm shrink-0">
                        {iniciales(emp.nombre)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-ink text-sm truncate">{emp.nombre}</h3>
                        <p className="text-xs text-ink-muted truncate">{emp.cargo ?? '—'}</p>
                      </div>
                    </div>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${colorEstado[emp.estado] ?? ''}`}
                    >
                      {emp.estado}
                    </span>
                  </div>

                  {/* Los dos artefactos del Excel que la etapa 3 desactivó desde
                      la API caen aquí, y tienen que verse. */}
                  {!emp.activo && (
                    <p className="text-[11px] text-ink-muted bg-surface-alt border border-line rounded px-2 py-1 flex items-center gap-1.5">
                      <UserX className="w-3.5 h-3.5 shrink-0" />
                      Inactivo: no aparece en asignaciones nuevas
                    </p>
                  )}

                  {/* D30: quien está en una sede sin oficina necesita
                      dirección, porque no hay a dónde mandarle el equipo. Se
                      avisa, no se bloquea: hay fichas cargadas del Excel sin
                      ella, y un CHECK las dejaría sin poder editarse ni para
                      corregir otra cosa. */}
                  {faltaDireccion(emp) && (
                    <p className="text-[11px] text-ink bg-warn/10 border border-warn/40 rounded px-2 py-1 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-warn" />
                      Sin dirección, y su sede no tiene oficina: no hay a dónde enviarle un equipo.
                    </p>
                  )}

                  <dl className="text-xs text-ink-muted space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Building className="w-3.5 h-3.5 shrink-0" />
                      <dd className="truncate">
                        {nombreSede(emp.sede_id)} · {emp.empresa}
                      </dd>
                    </div>
                    {emp.email_corporativo && (
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <dd className="truncate">{emp.email_corporativo}</dd>
                      </div>
                    )}
                    {emp.telefono && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <dd className="truncate">{emp.telefono}</dd>
                      </div>
                    )}
                  </dl>

                  <button
                    onClick={() => desplegar(emp)}
                    className="w-full text-left text-xs border-t border-line pt-2 flex items-center justify-between text-ink hover:text-brand"
                  >
                    <span className="flex items-center gap-1.5">
                      <Laptop className="w-3.5 h-3.5" />
                      Equipos a su nombre
                    </span>
                    <span className="font-semibold tabular-nums">{emp.equipos_asignados}</span>
                  </button>

                  {abierto && (
                    <div className="text-xs space-y-1">
                      {equipos === 'cargando' && <p className="text-ink-muted">Cargando…</p>}
                      {equipos === 'error' && (
                        <p className="text-danger">No se pudieron cargar sus equipos.</p>
                      )}
                      {Array.isArray(equipos) &&
                        (equipos.length === 0 ? (
                          <p className="text-ink-muted">Sin equipos asignados.</p>
                        ) : (
                          equipos.map((eq) => (
                            <div
                              key={eq.id}
                              className="bg-surface-alt border border-line rounded px-2 py-1 flex items-center justify-between gap-2"
                            >
                              <span className="truncate text-ink">
                                {[eq.marca, eq.modelo].filter(Boolean).join(' ') || eq.categoria}
                              </span>
                              <span className="font-mono text-[10px] text-brand shrink-0">
                                {eq.etiqueta ?? eq.serial ?? '—'}
                              </span>
                            </div>
                          ))
                        ))}
                    </div>
                  )}

                  {/* Editar sí está disponible con la ficha inactiva: es
                      justo cuando hace falta corregir un dato mal cargado. */}
                  <button
                    onClick={() => setEditando(emp)}
                    className="w-full text-xs text-ink-muted hover:text-ink border border-line rounded-lg py-1.5 flex items-center justify-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar ficha
                  </button>

                  {emp.activo && (
                    <div className="space-y-1.5">
                      <button
                        onClick={() => onOpenOffboardingModal(emp)}
                        className="w-full text-xs text-ink-muted hover:text-ink border border-line rounded-lg py-1.5"
                      >
                        Offboarding — recoger sus equipos
                      </button>

                      {/* Desactivar sin pasar por la recogida: el caso de quien
                          nunca tuvo equipos, o de una ficha duplicada. Con
                          equipos a su nombre el servidor responde 409, y ese
                          mensaje es exactamente el que hay que enseñar. */}
                      <button
                        onClick={() => void desactivar(emp)}
                        disabled={desactivandoId === emp.id}
                        className="w-full text-xs text-ink-muted hover:text-danger border border-line rounded-lg py-1.5 disabled:opacity-50"
                      >
                        {desactivandoId === emp.id ? 'Desactivando…' : 'Desactivar ficha'}
                      </button>

                      {errorDesactivar?.id === emp.id && (
                        <p
                          role="alert"
                          className="text-xs text-danger bg-danger/10 border border-danger/40 rounded-lg px-2 py-1.5"
                        >
                          {errorDesactivar.mensaje}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>
              {(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina === 1 || cargando}
                className="p-1.5 border border-line rounded disabled:opacity-40 hover:bg-surface-alt"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 tabular-nums">
                {pagina} / {ultimaPagina}
              </span>
              <button
                onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))}
                disabled={pagina >= ultimaPagina || cargando}
                className="p-1.5 border border-line rounded disabled:opacity-40 hover:bg-surface-alt"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

export interface FormularioEmpleadoProps {
  /** `null` para el alta. */
  empleado: EmpleadoConConteo | null;
  sedes: Sede[];
  onCerrar: () => void;
  onGuardado: () => Promise<void>;
}

/**
 * Alta y edición de la ficha. **Borrar no**, por lo mismo que los usuarios
 * (D18): se desactiva, y ese botón ya existe en la tarjeta.
 *
 * `estado` y `activo` no están en el formulario a propósito. `activo` lo mueve
 * «Desactivar ficha», que tiene su 409 de equipos a cargo; ponerlo aquí como
 * una casilla más daría una segunda puerta al mismo cambio, sin la
 * comprobación.
 */
export const FormularioEmpleado: React.FC<FormularioEmpleadoProps> = ({
  empleado,
  sedes,
  onCerrar,
  onGuardado,
}) => {
  const [datos, setDatos] = useState<DatosEmpleado>({
    nombre: empleado?.nombre ?? '',
    cedula: empleado?.cedula ?? '',
    email_corporativo: empleado?.email_corporativo ?? '',
    cargo: empleado?.cargo ?? '',
    area: empleado?.area ?? '',
    sede_id: empleado?.sede_id ?? '',
    telefono: empleado?.telefono ?? '',
    direccion: empleado?.direccion ?? '',
    empresa: empleado?.empresa ?? 'Sin clasificar',
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poner = (campo: keyof DatosEmpleado, valor: string) =>
    setDatos((p) => ({ ...p, [campo]: valor }));

  // El mismo aviso que en la tarjeta, en el sitio donde se puede arreglar.
  const sedeElegida = sedes.find((s) => s.id === datos.sede_id);
  const avisarDireccion =
    sedeElegida !== undefined &&
    sedeElegida.ciudad === null &&
    (datos.direccion ?? '').trim() === '';

  const guardar = async () => {
    if (!datos.nombre.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      // Las cadenas vacías se mandan como NULL: un campo que se borra queda
      // vacío en la base, no con un '' que después se cuela en los listados.
      const limpio: DatosEmpleado = {
        ...datos,
        nombre: datos.nombre.trim(),
        cedula: datos.cedula?.trim() || null,
        email_corporativo: datos.email_corporativo?.trim() || null,
        cargo: datos.cargo?.trim() || null,
        area: datos.area?.trim() || null,
        sede_id: datos.sede_id || null,
        telefono: datos.telefono?.trim() || null,
        direccion: datos.direccion?.trim() || null,
      };
      if (empleado) await api.actualizarEmpleado(empleado.id, limpio);
      else await api.crearEmpleado(limpio);
      await onGuardado();
    } catch (e) {
      // El 409 de cédula repetida llega tal cual: `empleados.cedula` es UNIQUE
      // y ese choque es un dato real que hay que resolver, no un fallo de la
      // pantalla.
      setError(e instanceof ErrorApi ? e.message : 'No se pudo guardar la ficha.');
    } finally {
      setEnviando(false);
    }
  };

  const campo = (
    etiqueta: string,
    clave: keyof DatosEmpleado,
    extra: { tipo?: string; ancho?: boolean } = {},
  ) => (
    <label className={`text-xs text-ink-muted space-y-1 ${extra.ancho ? 'md:col-span-2' : ''}`}>
      <span>{etiqueta}</span>
      <input
        type={extra.tipo ?? 'text'}
        value={(datos[clave] as string | null) ?? ''}
        onChange={(e) => poner(clave, e.target.value)}
        className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
      />
    </label>
  );

  return (
    <section className="border border-line rounded-xl bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-ink">
          {empleado ? `Editar ficha de ${empleado.nombre}` : 'Nueva ficha de colaborador'}
        </h2>
        <button onClick={onCerrar} className="text-ink-muted hover:text-ink" aria-label="Cerrar">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="text-xs text-ink-muted space-y-1 md:col-span-2">
          <span>Nombre *</span>
          <input
            value={datos.nombre}
            onChange={(e) => poner('nombre', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </label>
        {campo('Cédula', 'cedula')}
        {campo('Correo corporativo', 'email_corporativo', { tipo: 'email' })}
        {campo('Cargo', 'cargo')}
        {campo('Área', 'area')}
        {campo('Teléfono', 'telefono')}
        <label className="text-xs text-ink-muted space-y-1">
          <span>Sede</span>
          <select
            value={datos.sede_id ?? ''}
            onChange={(e) => poner('sede_id', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
          >
            <option value="">Sin sede</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted space-y-1">
          <span>Empresa</span>
          <select
            value={datos.empresa ?? 'Sin clasificar'}
            onChange={(e) => poner('empresa', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
          >
            {EMPRESAS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        {campo('Dirección', 'direccion', { ancho: true })}
      </div>

      {avisarDireccion && (
        <p className="text-xs text-ink bg-warn/10 border border-warn/40 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn" />
          «{sedeElegida.nombre}» no es una oficina: sin dirección no hay a dónde mandarle el
          equipo. Se puede guardar igual —el dato quizá no lo sepa quien está editando— pero
          conviene completarlo antes de la primera entrega.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => void guardar()}
          disabled={enviando || !datos.nombre.trim()}
          className="px-3 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
          {empleado ? 'Guardar cambios' : 'Crear ficha'}
        </button>
        <button onClick={onCerrar} className="text-sm text-ink-muted hover:text-ink px-3 py-2">
          Cancelar
        </button>
        {!datos.nombre.trim() && <span className="text-xs text-ink-muted">Falta el nombre.</span>}
      </div>
    </section>
  );
};
