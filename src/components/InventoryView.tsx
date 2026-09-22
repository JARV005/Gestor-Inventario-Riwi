import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Laptop,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  WifiOff,
  X,
} from 'lucide-react';

import type {
  CategoriaEquipo,
  CierreEnBloque,
  EquipoConMotivos,
  EstadoEquipo,
  Sede,
} from '../types';
import { CATEGORIAS_EQUIPO, ESTADOS_EQUIPO, MOTIVOS } from '../types';
import { api, ErrorApi, type ConteoMotivo } from '../lib/api';
import { AccionesEquipo } from './AccionesEquipo';
import { NotasEquipo } from './NotasEquipo';
import { ResolverMotivos } from './ResolverMotivos';

/**
 * La primera vista con datos reales.
 *
 * Habla directamente con la API en vez de recibir un array por props: es lo que
 * permite paginar, filtrar y buscar en el servidor sobre 186 filas sin
 * traérselas todas al navegador. `App` ya no le pasa `equipos`.
 *
 * Y es la primera con estados de carga y de error, que hasta ahora no existían
 * en ninguna parte de la aplicación porque los datos ya estaban en memoria y no
 * podían fallar.
 */

interface InventoryViewProps {
  searchTerm: string;
  setSearchTerm: (t: string) => void;
  onOpenNewDeviceModal: () => void;
  onGenerarActa: (equipo: EquipoConMotivos) => void;
  onSolicitarMantenimiento: () => void;
  /** Una mutación mueve los contadores del sidebar, que se pintan fuera. */
  onEquipoMutado?: () => void;
}

type Pestana = 'todos' | 'revision';

const colorEstado: Record<EstadoEquipo, string> = {
  Asignado: 'bg-brand text-white',
  Disponible: 'bg-ok/15 text-ink border border-ok/40',
  'En mantenimiento': 'bg-warn/20 text-ink border border-warn/50',
  Reservado: 'bg-surface-alt text-ink-muted border border-line',
  'De baja': 'bg-danger/15 text-ink border border-danger/40',
  Prestado: 'bg-info/20 text-ink border border-info/50',
};

const nombreDe = (e: EquipoConMotivos) =>
  e.nombre_equipo ?? e.etiqueta ?? ([e.marca, e.modelo].filter(Boolean).join(' ') || 'Equipo');

export const InventoryView: React.FC<InventoryViewProps> = ({
  searchTerm,
  setSearchTerm,
  onOpenNewDeviceModal,
  onEquipoMutado,
}) => {
  const [pestana, setPestana] = useState<Pestana>('todos');
  const [estado, setEstado] = useState<EstadoEquipo | ''>('');
  const [categoria, setCategoria] = useState<CategoriaEquipo | ''>('');
  const [sede, setSede] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pagina, setPagina] = useState(1);

  const [filas, setFilas] = useState<EquipoConMotivos[]>([]);
  const [total, setTotal] = useState(0);
  const [conteos, setConteos] = useState<ConteoMotivo[]>([]);
  /**
   * Cuántos equipos ve cada empresa. Las tres claves de `empresa` siempre —lo
   * de D28— y además ISF si tiene algo prestado.
   *
   * Los tres números suman más que el total y eso es correcto: un equipo
   * prestado cuenta en la lista del dueño Y en la de quien lo tiene. Es lo que
   * D31 compró al meter cada máquina en una sola fila, y el texto de abajo lo
   * dice para que nadie lo lea como un error de cuentas.
   */
  const [conteosEmpresa, setConteosEmpresa] = useState<Record<string, number> | null>(null);
  const [sedes, setSedes] = useState<Sede[]>([]);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ErrorApi | null>(null);
  const [seleccionado, setSeleccionado] = useState<EquipoConMotivos | null>(null);

  /**
   * El cierre en bloque del motivo filtrado.
   *
   * `null` = el panel está cerrado. No hay botón que cierre 37 filas de un
   * clic: primero se abre, se lee qué va a pasar y se escribe la constancia.
   */
  const [enBloque, setEnBloque] = useState<{ nota: string } | null>(null);
  const [cerrandoBloque, setCerrandoBloque] = useState(false);
  const [resultadoBloque, setResultadoBloque] = useState<CierreEnBloque | null>(null);

  const porPagina = 25;

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const filtros = { estado, categoria, sede, empresa, q: searchTerm, pagina, porPagina };
      const datos =
        pestana === 'revision'
          ? await api.revision({ ...filtros, motivo })
          : await api.equipos(filtros);
      setFilas(datos.filas);
      setTotal(datos.total);
      // Solo la bandeja trae los conteos por motivo; el listado general no.
      if ('conteos' in datos) setConteos(datos.conteos as ConteoMotivo[]);
      setConteosEmpresa(datos.conteos_empresa);
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
      setFilas([]);
      setTotal(0);
    } finally {
      setCargando(false);
    }
  }, [pestana, estado, categoria, sede, empresa, motivo, searchTerm, pagina]);

  const cerrarBloque = async () => {
    if (!motivo || !enBloque) return;
    setCerrandoBloque(true);
    setError(null);
    try {
      const r = await api.cerrarMotivoEnBloque(motivo, enBloque.nota.trim() || null);
      setResultadoBloque(r);
      setEnBloque(null);
      // Si entraron todas, el bloque desaparece y el filtro ya no apunta a
      // nada: se vuelve a «todos los motivos» para no dejar una pantalla vacía
      // sin explicación.
      if (r.fallidos.length === 0) setMotivo('');
      await cargar();
      onEquipoMutado?.();
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi(0, 'Error desconocido'));
    } finally {
      setCerrandoBloque(false);
    }
  };

  // La búsqueda va al servidor: se espera a que la persona deje de escribir
  // para no lanzar una consulta por tecla.
  useEffect(() => {
    const t = setTimeout(cargar, searchTerm ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, searchTerm]);

  useEffect(() => {
    api.sedes().then(
      (d) => setSedes(d.sedes),
      () => setSedes([]), // el listado funciona sin el filtro de sede
    );
  }, []);

  // Cualquier cambio de filtro vuelve a la primera página: si no, filtrar
  // estando en la página 4 puede dejar la tabla vacía sin explicación.
  useEffect(() => setPagina(1), [pestana, estado, categoria, sede, empresa, motivo, searchTerm]);

  const nombreSede = (id: string | null) =>
    id ? (sedes.find((s) => s.id === id)?.nombre ?? '—') : '—';

  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Laptop className="w-6 h-6 text-brand" />
            Inventario
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {cargando && filas.length === 0
              ? 'Cargando…'
              : `${total} equipo${total === 1 ? '' : 's'}${pestana === 'revision' ? ' por revisar' : ''}`}
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
          <button
            onClick={onOpenNewDeviceModal}
            className="px-3 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Nuevo equipo
          </button>
        </div>
      </header>

      {/* Las empresas, como bloques y no como un desplegable más.
          Mismo mecanismo que la bandeja de motivos y que el de colaboradores
          (D28): un número delante es lo que hace que «Sin clasificar» se vea
          sin ir a buscarlo. */}
      {conteosEmpresa && (
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(conteosEmpresa).map(([nombre, n]) => {
            const activa = empresa === nombre;
            const pendiente = nombre === 'Sin clasificar' && n > 0;
            return (
              <button
                key={nombre}
                onClick={() => setEmpresa(activa ? '' : nombre)}
                className={`px-3 py-1.5 text-xs rounded-lg border flex items-center gap-2 transition-colors ${
                  activa
                    ? 'bg-brand text-white border-brand'
                    : pendiente
                      ? 'border-warn/50 bg-warn/10 text-ink hover:bg-warn/20'
                      : 'border-line text-ink-muted hover:bg-surface-alt'
                }`}
              >
                {pendiente && <AlertTriangle className="w-3.5 h-3.5 text-warn" />}
                {nombre}
                <span className="font-semibold tabular-nums">{n}</span>
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
          <span className="text-[11px] text-ink-muted">
            Un equipo prestado cuenta en las dos: en la de su dueño y en la de quien lo tiene.
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-line">
        {(['todos', 'revision'] as const).map((p) => (
          <button
            key={p}
            onClick={() => {
              setPestana(p);
              if (p === 'todos') setMotivo('');
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              pestana === p
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {p === 'todos' ? 'Todos' : 'Bandeja de revisión'}
            {p === 'revision' && conteos.length > 0 && (
              <span className="ml-2 text-xs bg-warn/20 text-ink px-1.5 py-0.5 rounded-full">
                {conteos.reduce((a, c) => a + c.equipos, 0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Los motivos, como bloques. La bandeja se ataca por bloque y no fila a
          fila: "los 37 de licencia" es una tarde de trabajo con una sola cabeza
          puesta; los mismos 37 repartidos entre otros casos no se terminan. */}
      {pestana === 'revision' && conteos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMotivo('')}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              motivo === ''
                ? 'bg-brand text-white border-brand'
                : 'border-line text-ink-muted hover:bg-surface-alt'
            }`}
          >
            Todos los motivos
          </button>
          {conteos.map((c) => (
            <button
              key={c.codigo}
              onClick={() => setMotivo(c.codigo)}
              title={MOTIVOS[c.codigo as keyof typeof MOTIVOS]?.descripcion}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                motivo === c.codigo
                  ? 'bg-brand text-white border-brand'
                  : 'border-line text-ink-muted hover:bg-surface-alt'
              }`}
            >
              {c.codigo}
              <span className="ml-1.5 font-semibold tabular-nums">{c.equipos}</span>
            </button>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------------------
          Cerrar el bloque entero.

          La bandeja se filtra por motivo desde la 5e, pero cerrarlos era de uno
          en uno y desde el panel de cada equipo: los 37 de `LICENCIA_OK` eran
          37 aperturas. Una bandeja que cuesta 37 clics por bloque no se vacía,
          se abandona — el mismo final que cuando solo se leía.

          Solo aparece con un motivo seleccionado: «cerrar todos los motivos de
          todo» no es una acción que nadie quiera de verdad.
          --------------------------------------------------------------------- */}
      {pestana === 'revision' && motivo !== '' && (
        <div className="border border-line rounded-lg p-3 space-y-2 bg-surface">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {MOTIVOS[motivo as keyof typeof MOTIVOS]?.descripcion ?? motivo}
              </p>
              <p className="text-xs text-ink-muted">
                Recomendación: {MOTIVOS[motivo as keyof typeof MOTIVOS]?.recomendacion ?? '—'}
              </p>
            </div>
            {enBloque === null && (
              <button
                onClick={() => {
                  setEnBloque({ nota: '' });
                  setResultadoBloque(null);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-line text-ink hover:bg-surface-alt shrink-0"
              >
                Cerrar este motivo en las {total} filas
              </button>
            )}
          </div>

          {enBloque !== null && (
            <div className="space-y-2 border-t border-line pt-2">
              <label className="block text-xs text-ink-muted space-y-1">
                <span>
                  Constancia que se añade a las notas de cada equipo{' '}
                  <span className="text-ink-muted">(opcional, pero recomendada)</span>
                </span>
                <input
                  value={enBloque.nota}
                  onChange={(e) => setEnBloque({ nota: e.target.value })}
                  placeholder="Qué se comprobó, cuándo y quién lo confirmó"
                  className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
                />
              </label>
              {/* Por qué la constancia importa, donde se escribe y no en un
                  documento que nadie abrirá: un campo vacío y un campo vacío
                  con constancia de que se revisó se leen igual dentro de un
                  año, y no son lo mismo. */}
              <p className="text-xs text-ink-muted">
                Se añade a lo que ya haya en notas, sin borrarlo. Cerrar un motivo no rellena
                ningún campo: si el dato sigue sin saberse, queda vacío — y la nota es lo que
                distingue «no se sabe» de «nadie lo miró».
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void cerrarBloque()}
                  disabled={cerrandoBloque}
                  className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {cerrandoBloque ? 'Cerrando…' : `Cerrar ${total} y anotar`}
                </button>
                <button
                  onClick={() => setEnBloque(null)}
                  disabled={cerrandoBloque}
                  className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* El resultado sobrevive a la recarga: si quedaron filas sin cerrar hay
          que poder leer cuáles, y se van a haber movido de sitio en el listado. */}
      {resultadoBloque && (
        <div
          className={`border rounded-lg p-3 space-y-2 text-xs ${
            resultadoBloque.fallidos.length === 0
              ? 'bg-ok/10 border-ok/40'
              : 'bg-warn/10 border-warn/40'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-ink font-semibold">
              {resultadoBloque.cerrados} cerradas en {resultadoBloque.motivo}
              {resultadoBloque.fallidos.length > 0 &&
                ` · ${resultadoBloque.fallidos.length} sin cerrar`}
            </p>
            <button
              onClick={() => setResultadoBloque(null)}
              className="text-ink-muted hover:text-ink"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {resultadoBloque.fallidos.length > 0 && (
            <>
              <p className="text-ink-muted">
                Estas necesitan una decisión antes: al bajarles la marca vuelve a exigirse que
                su serial y su etiqueta sean únicos, y el duplicado sigue ahí.
              </p>
              <ul className="space-y-0.5 text-ink">
                {resultadoBloque.fallidos.map((f: CierreEnBloque['fallidos'][number]) => (
                  <li key={f.equipo_id}>
                    <span className="font-mono">{f.etiqueta ?? f.serial ?? f.equipo_id}</span>
                    {f.problema ? ` — ${f.problema}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Etiqueta, serial, nombre, marca o modelo…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
          />
        </div>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value as EstadoEquipo | '')}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_EQUIPO.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value as CategoriaEquipo | '')}
          className="px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink"
        >
          <option value="">Todas las categorías</option>
          {CATEGORIAS_EQUIPO.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
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
        {(estado || categoria || sede || searchTerm || motivo) && (
          <button
            onClick={() => {
              setEstado('');
              setCategoria('');
              setSede('');
              setMotivo('');
              setSearchTerm('');
            }}
            className="px-3 py-2 text-sm text-ink-muted hover:text-ink flex items-center gap-1"
          >
            <X className="w-4 h-4" />
            Limpiar
          </button>
        )}
      </div>

      {/* --------------------------------------------------------------------
          Los tres estados. "Listo" es solo uno, y hasta esta etapa era el único
          que la aplicación sabía representar.
          -------------------------------------------------------------------- */}

      {error ? (
        <ErrorDeCarga error={error} onReintentar={cargar} />
      ) : cargando && filas.length === 0 ? (
        <div className="border border-line rounded-xl bg-surface p-12 flex flex-col items-center gap-3 text-ink-muted">
          <Loader2 className="w-6 h-6 animate-spin text-brand" />
          <p className="text-sm">Cargando el inventario…</p>
        </div>
      ) : filas.length === 0 ? (
        <div className="border border-line rounded-xl bg-surface p-12 flex flex-col items-center gap-2 text-ink-muted">
          <Filter className="w-6 h-6" />
          <p className="text-sm font-medium text-ink">Ningún equipo coincide</p>
          <p className="text-xs">Probar con menos filtros, o limpiarlos todos.</p>
        </div>
      ) : (
        <div
          className={`border border-line rounded-xl bg-surface overflow-hidden ${cargando ? 'opacity-60' : ''}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Etiqueta</th>
                  <th className="text-left font-semibold px-4 py-3">Equipo</th>
                  <th className="text-left font-semibold px-4 py-3">Serial</th>
                  <th className="text-left font-semibold px-4 py-3">Estado</th>
                  <th className="text-left font-semibold px-4 py-3">Sede</th>
                  <th className="text-left font-semibold px-4 py-3">Revisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filas.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => setSeleccionado(e)}
                    className="hover:bg-surface-alt cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-brand">{e.etiqueta ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{nombreDe(e)}</div>
                      <div className="text-xs text-ink-muted">
                        {[e.marca, e.modelo].filter(Boolean).join(' ') || e.categoria}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{e.serial ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${colorEstado[e.estado]}`}>
                        {e.estado}
                      </span>
                      {/* A quién, pegado al estado. «Prestado» a secas obliga a
                          abrir la ficha para saber lo único que importa de un
                          préstamo, y quien mira la lista de una empresa
                          necesita distinguir de un vistazo lo suyo de lo que
                          tiene en préstamo. */}
                      {e.prestado_a && (
                        <div className="text-[11px] text-ink-muted mt-0.5">
                          {e.empresa} → <strong className="text-ink">{e.prestado_a}</strong>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{nombreSede(e.sede_id)}</td>
                    <td className="px-4 py-3">
                      {e.motivos_revision.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-ink">
                          <AlertTriangle className="w-3.5 h-3.5 text-warn" />
                          {e.motivos_revision.length}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-line text-xs text-ink-muted">
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
        </div>
      )}

      {seleccionado && (
        <Detalle
          equipo={seleccionado}
          sede={nombreSede(seleccionado.sede_id)}
          onCerrar={() => setSeleccionado(null)}
          onMutado={(actualizado) => {
            // El detalle se queda abierto con el equipo ya cambiado: encadenar
            // dos operaciones —reservar y luego asignar— es lo normal, y
            // cerrar el panel obligaría a volver a buscarlo.
            setSeleccionado(actualizado);
            void cargar();
            onEquipoMutado?.();
          }}
        />
      )}
    </div>
  );
};

/**
 * El estado de error, que es el que nadie diseña porque nadie espera verlo.
 *
 * Distingue tres causas, porque lo que la persona puede hacer es distinto en
 * cada una: si la sesión caducó hay que volver a entrar, si el servidor no
 * responde hay que avisar a alguien, y si es otra cosa lo razonable es
 * reintentar. Un único "algo ha ido mal" no ayuda a ninguna de las tres.
 */
const ErrorDeCarga: React.FC<{ error: ErrorApi; onReintentar: () => void }> = ({
  error,
  onReintentar,
}) => {
  const sinConexion = error.esSinConexion;
  const caducada = error.esSesionCaducada;
  const falloServidor = error.esFalloDelServidor;

  return (
    <div className="border border-danger/40 bg-danger/5 rounded-xl p-8 flex flex-col items-center gap-3 text-center">
      {sinConexion ? (
        <WifiOff className="w-8 h-8 text-danger" />
      ) : (
        <AlertTriangle className="w-8 h-8 text-danger" />
      )}

      <div className="space-y-1">
        <p className="font-semibold text-ink">
          {sinConexion
            ? 'No se pudo contactar con el servidor'
            : caducada
              ? 'La sesión ha caducado'
              : falloServidor
                ? 'El servidor no pudo consultar el inventario'
                : 'No se pudo cargar el inventario'}
        </p>
        <p className="text-sm text-ink-muted max-w-md">
          {sinConexion
            ? 'El inventario no está disponible ahora mismo. No se ha perdido nada: los datos están en el servidor y volverán a verse en cuanto responda.'
            : caducada
              ? 'Por seguridad la sesión se cierra tras un rato de inactividad, y también si alguien desactiva la cuenta o cambia la contraseña. Hay que volver a iniciar sesión.'
              : falloServidor
                ? 'Suele ser la base de datos, que no está respondiendo. No se ha perdido nada y no hace falta hacer nada más que reintentar en un momento. Si sigue igual, avisar a TI.'
                : error.message}
        </p>
        {!sinConexion && !caducada && (
          <p className="text-xs text-ink-muted font-mono pt-1">
            Código {error.estado}
            {falloServidor ? '' : ` · ${error.message}`}
          </p>
        )}
      </div>

      {caducada ? (
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90"
        >
          Iniciar sesión
        </button>
      ) : (
        <button
          onClick={onReintentar}
          className="px-4 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 flex items-center gap-1.5"
        >
          <RefreshCw className="w-4 h-4" />
          Reintentar
        </button>
      )}
    </div>
  );
};

const Detalle: React.FC<{
  equipo: EquipoConMotivos;
  sede: string;
  onCerrar: () => void;
  /** Una mutación cambia el equipo y los conteos: hay que recargar el listado. */
  onMutado: (equipo: EquipoConMotivos) => void;
}> = ({ equipo, sede, onCerrar, onMutado }) => (
  <div
    className="fixed inset-0 bg-ink/30 z-50 flex items-center justify-center p-4"
    onClick={onCerrar}
  >
    <div
      className="bg-surface border border-line rounded-xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink">{nombreDe(equipo)}</h2>
          <p className="text-sm text-ink-muted font-mono">{equipo.etiqueta ?? 'sin etiqueta'}</p>
        </div>
        <button onClick={onCerrar} className="p-2 text-ink-muted hover:text-ink">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Antes esto solo listaba los motivos. Ahora también los cierra: ver
          `ResolverMotivos`. Una bandeja que solo se lee no se vacía nunca. */}
      <ResolverMotivos equipo={equipo} onCambiado={onMutado} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {(
          [
            ['Categoría', equipo.categoria],
            ['Estado', equipo.estado],
            ['Serial', equipo.serial],
            ['Marca', equipo.marca],
            ['Modelo', equipo.modelo],
            ['Sede', sede],
            ['Empresa', equipo.empresa],
            ['Prestado a', equipo.prestado_a],
            ['Propiedad', equipo.propiedad],
            ['Sistema operativo', equipo.sistema_operativo],
            ['Licencia', equipo.licencia_tipo],
            ['Procesador', equipo.procesador],
            ['RAM', equipo.ram],
            ['Disco', equipo.disco],
            ['Pantalla', equipo.tamano_pantalla],
            ['Condición', equipo.condicion],
          ] as const
        ).map(([etiqueta, valor]) => (
          <div key={etiqueta}>
            <dt className="text-xs text-ink-muted">{etiqueta}</dt>
            <dd className="text-ink">{valor ?? '—'}</dd>
          </div>
        ))}
      </dl>

      {/* Editables desde la 5c, con lo del importador protegido aparte. */}
      <NotasEquipo equipo={equipo} onGuardado={onMutado} />

      {/* La clave BIOS y el serial de Windows no están aquí: no salen en ningún
          listado ni detalle (§5.2). Solo por GET /api/equipos/:id/bios, con rol
          admin y dejando fila en auditoria. */}

      {/* Las seis mutaciones. Qué botones se pintan lo decide el servidor. */}
      <AccionesEquipo equipo={equipo} onHecho={onMutado} />
    </div>
  </div>
);
