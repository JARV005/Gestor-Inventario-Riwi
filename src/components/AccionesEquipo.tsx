import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import type {
  CatalogoTransiciones,
  EmpleadoConConteo,
  EquipoConMotivos,
  Operacion,
  Prestatario,
  Sede,
} from '../types';
import { PRESTATARIOS } from '../types';
import { api, ErrorApi } from '../lib/api';

/**
 * Los botones de las mutaciones, en el detalle de un equipo.
 *
 * ============================================================================
 * ESTE COMPONENTE NO SABE QUÉ TRANSICIONES SON LEGALES, Y NO DEBE SABERLO.
 * ============================================================================
 *
 * Qué se puede hacer con un equipo en estado X es `catalogo.por_estado[X]`, que
 * viene de `GET /api/transiciones` y sale de la misma tabla que decide el 409:
 * `db/transiciones.ts`. Un `if (equipo.estado === 'Disponible')` aquí sería una
 * segunda tabla de transiciones, y las dos se separarían sin que nadie lo note
 * —un botón que siempre da 409, o una operación sin botón.
 *
 * Existe porque las seis operaciones se construyeron en la etapa 5 y ninguna
 * tenía punto de entrada: solo se podían ejecutar por `curl`. Es el mismo
 * patrón que el estado de error de `InventoryView`, código correcto e
 * inalcanzable. Y con consecuencia: quien no encuentra cómo dar de baja un
 * equipo termina pidiendo que se lo cambien en la base a mano.
 */

interface AccionesEquipoProps {
  equipo: EquipoConMotivos;
  /** Para refrescar el listado y los conteos de fuera. */
  onHecho: (equipo: EquipoConMotivos) => void;
}

export const AccionesEquipo: React.FC<AccionesEquipoProps> = ({ equipo, onHecho }) => {
  const [catalogo, setCatalogo] = useState<CatalogoTransiciones | null>(null);
  const [empleados, setEmpleados] = useState<EmpleadoConConteo[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  /** La operación cuyo formulario está abierto, si alguna lo necesita. */
  const [abierta, setAbierta] = useState<Operacion | null>(null);
  const [empleadoId, setEmpleadoId] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [prestadoA, setPrestadoA] = useState<'' | Prestatario>('');
  /**
   * «¿Lo devolvió de verdad?».
   *
   * Reasignar escribe una `Devolución` en el historial, y una devolución es un
   * hecho físico: alguien tuvo que entregar el portátil. Sin esta casilla, el
   * atajo convertiría ese hecho en un paso de formulario que se pasa sin leer,
   * y el historial diría que hubo una entrega que quizá no ocurrió.
   */
  const [devuelto, setDevuelto] = useState(false);
  const [transportadora, setTransportadora] = useState('');
  const [guia, setGuia] = useState('');
  const [fechaEstimada, setFechaEstimada] = useState('');
  const [confirmando, setConfirmando] = useState<Operacion | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([api.transiciones(), api.empleados({ porPagina: 200, activo: true }), api.sedes()])
      .then(([t, e, s]) => {
        if (!vigente) return;
        setCatalogo(t);
        setEmpleados(e.filas);
        setSedes(s.sedes);
      })
      .catch((e) => {
        if (!vigente) return;
        // Sin catálogo NO se pintan los botones. Es deliberado: pintarlos
        // adivinando pondría en pantalla operaciones que van a dar 409, y una
        // interfaz que ofrece lo que no se puede hacer es peor que una que no
        // ofrece nada.
        setErrorCatalogo(e instanceof ErrorApi ? e.message : 'No se pudieron cargar las acciones.');
      });
    return () => {
      vigente = false;
    };
  }, []);

  // Al cambiar de equipo se cierra lo que hubiera abierto: el formulario de
  // traslado de otro equipo no puede quedar en pantalla apuntando a este.
  useEffect(() => {
    setAbierta(null);
    setConfirmando(null);
    setError(null);
  }, [equipo.id]);

  if (errorCatalogo) {
    return (
      <p className="text-xs text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2">
        {errorCatalogo} Sin la tabla de operaciones no se muestran los botones, para no ofrecer
        lo que quizá no se pueda hacer.
      </p>
    );
  }
  if (!catalogo) {
    return <p className="text-xs text-ink-muted">Cargando acciones…</p>;
  }

  const posibles = catalogo.por_estado[equipo.estado] ?? [];
  const de = (op: Operacion) => catalogo.operaciones.find((o) => o.operacion === op)!;

  // Las que tienen endpoint propio se pintan como botón; las que las dispara
  // el flujo de partes, no. La separación la decide el servidor con `disparo`,
  // igual que decide cuáles son legales: una lista aquí sería otra vez la
  // segunda tabla contra la que avisa el bloque de arriba.
  const directas = posibles.filter((op) => de(op).disparo === 'directa');
  const porParte = posibles.filter((op) => de(op).disparo === 'parte');

  const ejecutar = async (op: Operacion) => {
    setEnviando(true);
    setError(null);
    try {
      let r;
      if (op === 'asignar') r = await api.asignar(equipo.id, empleadoId);
      else if (op === 'devolver') r = await api.devolver(equipo.id);
      else if (op === 'trasladar')
        r = await api.trasladar(equipo.id, sedeId, {
          transportadora: transportadora.trim() || null,
          guia: guia.trim() || null,
          fecha_estimada: fechaEstimada || null,
        });
      else if (op === 'prestar') r = await api.prestar(equipo.id, prestadoA as Prestatario);
      else if (op === 'reasignar') r = await api.reasignar(equipo.id, empleadoId);
      else if (
        op === 'reservar' ||
        op === 'liberar' ||
        op === 'baja' ||
        op === 'recuperar_prestamo'
      )
        r = await api.operacionSimple(equipo.id, op);
      // No hay `else`. Una operación con `disparo: 'parte'` no llega hasta
      // aquí —no se le pinta botón— y si algún día llegara, es mejor que el
      // compilador lo diga que inventarle un endpoint que no existe.
      else throw new Error(`La operación «${op}» no se dispara desde aquí.`);

      setAbierta(null);
      setConfirmando(null);
      setEmpleadoId('');
      setSedeId('');
      setPrestadoA('');
      setDevuelto(false);
      setTransportadora('');
      setGuia('');
      setFechaEstimada('');
      onHecho(r.equipo);
    } catch (e) {
      // El 409 del servidor ya trae el porqué y la salida ("puedes"). Se
      // enseña tal cual: reescribirlo aquí sería inventar una explicación
      // distinta de la que decide la regla.
      setError(e instanceof ErrorApi ? e.message : 'No se pudo completar la operación.');
    } finally {
      setEnviando(false);
    }
  };

  const pulsar = (op: Operacion) => {
    setError(null);
    const t = de(op);
    if (t.requiere || t.irreversible) {
      setAbierta(op);
      setConfirmando(t.irreversible && !t.requiere ? op : null);
    } else {
      void ejecutar(op);
    }
  };

  return (
    <div className="space-y-3 pt-4 border-t border-line">
      <p className="text-xs text-ink-muted">
        Operaciones disponibles con el equipo <strong className="text-ink">{equipo.estado}</strong>
      </p>

      {posibles.length === 0 ? (
        <p className="text-xs text-ink-muted border border-dashed border-line rounded-lg p-3">
          Ninguna operación sale de «{equipo.estado}».
          {catalogo.sin_operacion.includes(equipo.estado) &&
            ' A ese estado no llega ninguna operación, lo cual es un hueco del modelo y no una' +
              ' propiedad del equipo: convendría decirlo.'}
        </p>
      ) : directas.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {directas.map((op) => {
            const t = de(op);
            return (
              <button
                key={op}
                onClick={() => pulsar(op)}
                disabled={enviando}
                title={t.explicacion}
                className={`px-3 py-1.5 text-sm rounded-lg border font-medium disabled:opacity-50 ${
                  t.irreversible
                    ? 'border-danger/50 text-danger hover:bg-danger/10'
                    : 'border-line text-ink hover:bg-surface-alt'
                } ${abierta === op ? 'ring-2 ring-brand/40' : ''}`}
              >
                {t.etiqueta}
              </button>
            );
          })}
        </div>
      )}

      {/* Las de mantenimiento se anuncian pero no se pulsan: enviar al taller
          es abrir un parte y volver es cerrarlo (D29). Callárselas dejaría el
          estado «En mantenimiento» sin explicación visible desde el equipo;
          pintarlas como botón daría un 404, que es lo que hacía antes. */}
      {porParte.map((op) => (
        <p
          key={op}
          className="text-xs text-ink-muted bg-surface-alt border border-line rounded-lg px-3 py-2"
        >
          <strong className="text-ink">{de(op).etiqueta}</strong> se hace desde Mantenimiento:{' '}
          {op === 'enviar_mantenimiento'
            ? 'abrir un parte manda el equipo al taller, en la misma transacción.'
            : 'cerrar el parte lo saca del taller, en la misma transacción.'}
        </p>
      ))}

      {error && (
        <p
          role="alert"
          className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}

      {/* Prestar: hace falta a quién, y no puede ser su propia empresa — la
          CHECK `equipos_prestado_a_no_es_su_empresa` lo rechazaría, y ofrecer
          en un desplegable lo que la base va a rebotar es la misma clase de
          botón inútil que el 404 de mantenimiento. */}
      {abierta === 'prestar' && (
        <div className="bg-surface-alt border border-line rounded-lg p-3 space-y-2">
          <label className="block text-xs font-medium text-ink">¿A qué empresa se le presta?</label>
          <select
            value={prestadoA}
            onChange={(e) => setPrestadoA(e.target.value as '' | Prestatario)}
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
          >
            <option value="">— elegir empresa —</option>
            {PRESTATARIOS.filter((e) => e !== equipo.empresa).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-ink-muted">
            El equipo sigue siendo de {equipo.empresa}. Aparecerá en el inventario de las dos
            hasta que se recupere.
          </p>
          <Botonera
            enviando={enviando}
            puede={Boolean(prestadoA)}
            onCancelar={() => setAbierta(null)}
            onAceptar={() => void ejecutar('prestar')}
            texto="Prestar"
          />
        </div>
      )}

      {/* Reasignar: a quién, y la pregunta que el atajo no puede saltarse.
          Va antes del desplegable a propósito: primero el hecho, después la
          decisión. */}
      {abierta === 'reasignar' && (
        <div className="bg-surface-alt border border-line rounded-lg p-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={devuelto}
              onChange={(e) => setDevuelto(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              El equipo ya volvió de{' '}
              <strong>
                {empleados.find((e) => e.id === equipo.empleado_id)?.nombre ?? 'su responsable'}
              </strong>
              . Reasignar deja una devolución en el historial, y una devolución es algo que pasó de
              verdad.
            </span>
          </label>
          <label className="block text-xs font-medium text-ink pt-1">
            ¿A quién se le entrega ahora?
          </label>
          <select
            value={empleadoId}
            onChange={(e) => setEmpleadoId(e.target.value)}
            disabled={!devuelto}
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink disabled:opacity-50"
          >
            <option value="">— elegir colaborador —</option>
            {empleados
              .filter((e) => e.id !== equipo.empleado_id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                  {e.cargo ? ` — ${e.cargo}` : ''}
                </option>
              ))}
          </select>
          <p className="text-[11px] text-ink-muted">
            Quien lo tiene ahora no está en la lista: reasignar exige un responsable distinto.
          </p>
          <Botonera
            enviando={enviando}
            puede={devuelto && Boolean(empleadoId)}
            onCancelar={() => setAbierta(null)}
            onAceptar={() => void ejecutar('reasignar')}
            texto="Devolver y reasignar"
          />
        </div>
      )}

      {/* Asignar: hace falta a quién */}
      {abierta === 'asignar' && (
        <div className="bg-surface-alt border border-line rounded-lg p-3 space-y-2">
          <label className="block text-xs font-medium text-ink">¿A quién se le entrega?</label>
          <select
            value={empleadoId}
            onChange={(e) => setEmpleadoId(e.target.value)}
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
          >
            <option value="">— elegir colaborador —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}{e.cargo ? ` — ${e.cargo}` : ''}
              </option>
            ))}
          </select>
          <Botonera
            enviando={enviando}
            puede={Boolean(empleadoId)}
            onCancelar={() => setAbierta(null)}
            onAceptar={() => void ejecutar('asignar')}
            texto="Asignar"
          />
        </div>
      )}

      {/* Trasladar: hace falta a dónde, y los datos del envío son opcionales */}
      {abierta === 'trasladar' && (
        <div className="bg-surface-alt border border-line rounded-lg p-3 space-y-2">
          <label className="block text-xs font-medium text-ink">¿A qué sede va?</label>
          <select
            value={sedeId}
            onChange={(e) => setSedeId(e.target.value)}
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
          >
            <option value="">— elegir sede —</option>
            {sedes
              .filter((s) => s.id !== equipo.sede_id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={transportadora}
              onChange={(e) => setTransportadora(e.target.value)}
              placeholder="Transportadora (opcional)"
              maxLength={120}
              className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
            />
            <input
              value={guia}
              onChange={(e) => setGuia(e.target.value)}
              placeholder="Guía (opcional)"
              maxLength={120}
              className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
            />
          </div>
          <input
            type="date"
            value={fechaEstimada}
            onChange={(e) => setFechaEstimada(e.target.value)}
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
          />
          <p className="text-xs text-ink-muted">
            El equipo no cambia de sede al abrir el traslado: sigue donde está, y se mueve al
            confirmar la llegada desde Sedes.
          </p>
          <Botonera
            enviando={enviando}
            puede={Boolean(sedeId)}
            onCancelar={() => setAbierta(null)}
            onAceptar={() => void ejecutar('trasladar')}
            texto="Abrir traslado"
          />
        </div>
      )}

      {/* Baja: no pide datos, pide confirmación */}
      {confirmando === 'baja' && (
        <div className="bg-danger/5 border border-danger/40 rounded-lg p-3 space-y-2">
          <p className="text-sm text-ink flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            Dar de baja no se deshace: no hay operación que devuelva un equipo desde «De baja».
            Quedará en el inventario con su historial completo, pero fuera de circulación.
          </p>
          <Botonera
            enviando={enviando}
            puede
            onCancelar={() => {
              setConfirmando(null);
              setAbierta(null);
            }}
            onAceptar={() => void ejecutar('baja')}
            texto="Dar de baja"
            peligro
          />
        </div>
      )}
    </div>
  );
};

const Botonera: React.FC<{
  enviando: boolean;
  puede: boolean;
  onCancelar: () => void;
  onAceptar: () => void;
  texto: string;
  peligro?: boolean;
}> = ({ enviando, puede, onCancelar, onAceptar, texto, peligro }) => (
  <div className="flex justify-end gap-2">
    <button
      onClick={onCancelar}
      disabled={enviando}
      className="px-3 py-1.5 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface disabled:opacity-50"
    >
      Cancelar
    </button>
    <button
      onClick={onAceptar}
      disabled={enviando || !puede}
      className={`px-3 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-50 flex items-center gap-1.5 ${
        peligro ? 'bg-danger hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
      }`}
    >
      {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
      {texto}
    </button>
  </div>
);
