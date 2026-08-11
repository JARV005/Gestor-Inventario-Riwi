import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, PackageOpen, UserMinus, X } from 'lucide-react';

import type { EmpleadoConConteo, EquipoResumen } from '../types';
import { api, ErrorApi } from '../lib/api';

/**
 * Recoger los equipos de alguien que se va. **Es la operación contraria a
 * `OnboardingModal`, y hasta ahora hacía lo mismo que él.**
 *
 * El botón «Offboarding» de `EmployeesView` abría el asistente de entrega, que
 * asigna. Offboarding devuelve: pone `empleado_id` a NULL y el equipo vuelve a
 * `Disponible`. Una operación ponía el responsable y la otra abría la misma
 * pantalla para ponerlo otra vez — un bug heredado del prototipo, donde ninguno
 * de los dos escribía nada y por eso daba igual.
 *
 * Mismo tratamiento por equipo que en la entrega y por el mismo motivo (D20):
 * no hay endpoint de lote, así que se manda uno detrás de otro y se enseña el
 * resultado de cada uno. Aquí importa aún más — si una devolución falla y se
 * diera por buena, quedaría un equipo a nombre de alguien que ya no está.
 *
 * Al final enlaza con el bloqueo de la etapa 3: un empleado sin equipos a su
 * nombre ya se puede desactivar, y desactivarlo es lo que cierra el
 * offboarding. Con equipos todavía a su nombre, el `PATCH` responde 409 y aquí
 * ni se ofrece.
 */

interface OffboardingModalProps {
  isOpen: boolean;
  empleado: EmpleadoConConteo | null;
  onClose: () => void;
  /** Devolver mueve conteos que se pintan fuera del modal. */
  onCambio?: () => void;
}

interface Resultado {
  equipo: EquipoResumen;
  ok: boolean;
  detalle: string;
}

export const OffboardingModal: React.FC<OffboardingModalProps> = ({
  isOpen,
  empleado,
  onClose,
  onCambio,
}) => {
  const [equipos, setEquipos] = useState<EquipoResumen[]>([]);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);

  const [desactivando, setDesactivando] = useState(false);
  const [desactivado, setDesactivado] = useState(false);
  const [errorDesactivar, setErrorDesactivar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!empleado) return;
    setCargando(true);
    setError(null);
    try {
      const r = await api.equiposDe(empleado.id);
      setEquipos(r.equipos);
      // Marcados todos por defecto: quien se va normalmente entrega todo, y
      // desmarcar lo que se queda es menos trabajo que marcar lo que entrega.
      setMarcados(r.equipos.map((e) => e.id));
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudieron cargar sus equipos.');
      setEquipos([]);
    } finally {
      setCargando(false);
    }
  }, [empleado]);

  useEffect(() => {
    if (!isOpen) return;
    setResultados(null);
    setDesactivado(false);
    setErrorDesactivar(null);
    void cargar();
  }, [isOpen, cargar]);

  if (!isOpen || !empleado) return null;

  const alternar = (id: string) =>
    setMarcados((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  /** Los que quedan a su nombre después de esta ronda. */
  const pendientes = resultados
    ? equipos.filter((e) => !resultados.some((r) => r.equipo.id === e.id && r.ok)).length
    : equipos.length;

  const devolver = async () => {
    setEnviando(true);
    const hechos: Resultado[] = [];

    for (const equipo of equipos.filter((e) => marcados.includes(e.id))) {
      try {
        await api.devolver(equipo.id, `Offboarding de ${empleado.nombre}`);
        hechos.push({ equipo, ok: true, detalle: 'Devuelto · vuelve a Disponible' });
      } catch (e) {
        hechos.push({
          equipo,
          ok: false,
          detalle: e instanceof ErrorApi ? e.message : 'Error desconocido',
        });
      }
    }

    setResultados(hechos);
    setEnviando(false);
    onCambio?.();
  };

  const desactivar = async () => {
    setDesactivando(true);
    setErrorDesactivar(null);
    try {
      await api.desactivarEmpleado(empleado.id);
      setDesactivado(true);
      onCambio?.();
    } catch (e) {
      // El 409 del servidor dice exactamente qué falta ("tiene equipos a su
      // nombre. Devolverlos primero"). Se enseña tal cual.
      setErrorDesactivar(e instanceof ErrorApi ? e.message : 'No se pudo desactivar.');
    } finally {
      setDesactivando(false);
    }
  };

  const nombreEquipo = (e: EquipoResumen) =>
    [e.marca, e.modelo].filter(Boolean).join(' ') || e.etiqueta || e.categoria;

  return (
    <div className="fixed inset-0 bg-ink/30 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-xl w-full max-w-xl p-6 space-y-4 shadow-xl relative max-h-[85vh] overflow-y-auto animate-aparecer">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-ink-muted hover:text-ink"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-1">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <PackageOpen className="w-5 h-5 text-brand" />
            Recogida de equipos
          </h2>
          <p className="text-sm text-ink-muted">
            {empleado.nombre}
            {empleado.cargo ? ` — ${empleado.cargo}` : ''}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {cargando ? (
          <p className="text-sm text-ink-muted">Cargando sus equipos…</p>
        ) : resultados ? (
          <div className="space-y-3 text-sm">
            <ul className="space-y-2">
              {resultados.map((r) => (
                <li
                  key={r.equipo.id}
                  className={`p-3 rounded-lg border flex items-start gap-2 ${
                    r.ok ? 'bg-surface-alt border-line' : 'bg-danger/5 border-danger/40'
                  }`}
                >
                  {r.ok ? (
                    <Check className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-medium text-ink block">
                      {nombreEquipo(r.equipo)}
                      {r.equipo.etiqueta ? ` (${r.equipo.etiqueta})` : ''}
                    </span>
                    <span className={r.ok ? 'text-ink-muted' : 'text-danger'}>{r.detalle}</span>
                  </div>
                </li>
              ))}
            </ul>

            {/* El cierre: si no le queda nada, ya se puede desactivar. Es el
                bloqueo de la etapa 3 visto desde el otro lado. */}
            {desactivado ? (
              <p className="text-sm text-ink bg-ok/10 border border-ok/40 rounded-lg px-3 py-2">
                {empleado.nombre} queda inactivo. No aparecerá en asignaciones nuevas, y su
                historial se conserva entero.
              </p>
            ) : pendientes === 0 ? (
              <div className="bg-surface-alt border border-line rounded-lg p-3 space-y-2">
                <p className="text-ink">
                  No le queda ningún equipo a su nombre. Ya se puede desactivar su ficha.
                </p>
                <p className="text-xs text-ink-muted">
                  Desactivar no borra nada: la persona deja de aparecer en asignaciones nuevas y
                  su historial sigue completo. Las cuentas y las fichas no se borran nunca.
                </p>
                {errorDesactivar && (
                  <p role="alert" className="text-sm text-danger">{errorDesactivar}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={onClose}
                    className="px-3 py-1.5 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface"
                  >
                    Ahora no
                  </button>
                  <button
                    onClick={() => void desactivar()}
                    disabled={desactivando}
                    className="px-3 py-1.5 text-sm bg-brand text-white rounded-lg font-medium hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {desactivando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                    Desactivar a {empleado.nombre.split(' ')[0]}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink bg-warn/10 border border-warn/40 rounded-lg px-3 py-2">
                Le quedan {pendientes} equipo{pendientes === 1 ? '' : 's'} a su nombre, así que
                todavía no se puede desactivar. Lo que falló no se devolvió: esos equipos siguen
                como estaban.
              </p>
            )}

            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-line rounded-lg text-ink hover:bg-surface-alt"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : equipos.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p className="text-ink-muted border border-dashed border-line rounded-lg p-4">
              No tiene ningún equipo a su nombre. No hay nada que recoger.
            </p>
            {!desactivado && empleado.activo && (
              <>
                {errorDesactivar && <p role="alert" className="text-sm text-danger">{errorDesactivar}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={onClose}
                    className="px-3 py-1.5 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface-alt"
                  >
                    Cerrar
                  </button>
                  <button
                    onClick={() => void desactivar()}
                    disabled={desactivando}
                    className="px-3 py-1.5 text-sm bg-brand text-white rounded-lg font-medium hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {desactivando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                    Desactivar ficha
                  </button>
                </div>
              </>
            )}
            {desactivado && (
              <p className="text-sm text-ink bg-ok/10 border border-ok/40 rounded-lg px-3 py-2">
                {empleado.nombre} queda inactivo.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-ink-muted">
              Marcar lo que entrega. Cada equipo marcado vuelve a <strong className="text-ink">Disponible</strong> y
              deja su movimiento de devolución.
            </p>

            <ul className="space-y-2">
              {equipos.map((e) => (
                <li key={e.id}>
                  <label className="flex items-center gap-3 bg-surface-alt p-3 rounded-lg border border-line cursor-pointer">
                    <input
                      type="checkbox"
                      checked={marcados.includes(e.id)}
                      onChange={() => alternar(e.id)}
                      className="w-4 h-4 rounded border-line text-brand"
                    />
                    <div>
                      <span className="font-medium text-ink block">{nombreEquipo(e)}</span>
                      <span className="text-xs text-ink-muted">
                        {e.categoria} · {e.etiqueta ?? 'sin etiqueta'} · {e.serial ?? 'sin serial'}
                      </span>
                    </div>
                  </label>
                </li>
              ))}
            </ul>

            {marcados.length < equipos.length && (
              <p className="text-xs text-ink-muted">
                {equipos.length - marcados.length} equipo
                {equipos.length - marcados.length === 1 ? '' : 's'} sin marcar: seguirán a su
                nombre y no se podrá desactivar su ficha.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={enviando}
                className="px-4 py-2 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface-alt disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void devolver()}
                disabled={enviando || marcados.length === 0}
                className="px-4 py-2 text-sm bg-brand text-white rounded-lg font-medium hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5"
              >
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageOpen className="w-4 h-4" />}
                Registrar devolución de {marcados.length}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
