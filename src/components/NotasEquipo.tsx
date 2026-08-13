import React, { useEffect, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';

import type { EquipoConMotivos } from '../types';
import { api, ErrorApi } from '../lib/api';

/**
 * Las notas de un equipo, editables.
 *
 * ============================================================================
 * PARTE DE ESTE TEXTO LO ESCRIBIÓ EL IMPORTADOR Y NO SE PUEDE PISAR EN SILENCIO.
 * ============================================================================
 *
 * Cuando el Excel traía un «USUARIO RESPONSABLE» que no era una persona —una
 * póliza de seguro, un «z No asignar»—, la etapa 2 no inventó un empleado: dejó
 * el texto crudo en `notas` con la forma
 *
 *     USUARIO RESPONSABLE de origen: "POLIZA DE SEGURO"
 *
 * y varias separadas por ` | `. Es el único rastro de lo que decía la hoja, y
 * `verificar-datos.sql` §A cuenta con él para comprobar que el importador no se
 * inventó a nadie. Un cuadro de texto normal, con todo junto, invita a
 * seleccionar y borrar: se perdería sin que nadie lo notara.
 *
 * Así que se parte en dos. Lo del importador se enseña aparte y en solo
 * lectura; lo que se edita es el resto. Al guardar se vuelven a unir en el
 * mismo orden. Borrar la parte de origen sigue siendo posible —hay un botón que
 * lo dice— pero hay que pedirlo.
 */

/** El prefijo que escribe `db/importar.ts`. Si cambia allí, cambia aquí. */
const MARCA_ORIGEN = 'USUARIO RESPONSABLE de origen:';
const SEPARADOR = ' | ';

export function partirNotas(notas: string | null): { origen: string[]; libres: string } {
  if (!notas) return { origen: [], libres: '' };
  const trozos = notas.split(SEPARADOR);
  return {
    origen: trozos.filter((t) => t.trimStart().startsWith(MARCA_ORIGEN)),
    libres: trozos
      .filter((t) => !t.trimStart().startsWith(MARCA_ORIGEN))
      .join(SEPARADOR)
      .trim(),
  };
}

export function unirNotas(origen: string[], libres: string): string | null {
  const partes = [...origen, ...(libres.trim() ? [libres.trim()] : [])];
  return partes.length ? partes.join(SEPARADOR) : null;
}

interface NotasEquipoProps {
  equipo: EquipoConMotivos;
  onGuardado: (equipo: EquipoConMotivos) => void;
}

export const NotasEquipo: React.FC<NotasEquipoProps> = ({ equipo, onGuardado }) => {
  const partido = partirNotas(equipo.notas ?? null);

  const [editando, setEditando] = useState(false);
  const [libres, setLibres] = useState(partido.libres);
  const [conservarOrigen, setConservarOrigen] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cambiar de equipo con el editor abierto dejaría el texto del anterior
  // encima del nuevo, y al guardar lo escribiría en el equipo equivocado.
  useEffect(() => {
    setEditando(false);
    setLibres(partirNotas(equipo.notas ?? null).libres);
    setConservarOrigen(true);
    setError(null);
  }, [equipo.id, equipo.notas]);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await api.actualizarEquipo(equipo.id, {
        notas: unirNotas(conservarOrigen ? partido.origen : [], libres),
      });
      setEditando(false);
      onGuardado(r.equipo);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudieron guardar las notas.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Notas</p>
        {!editando && (
          <button
            onClick={() => setEditando(true)}
            className="text-xs text-brand hover:underline flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" />
            {equipo.notas ? 'Editar' : 'Añadir'}
          </button>
        )}
      </div>

      {/* Lo que dejó el importador: visible siempre, y nunca dentro del cuadro
          de edición. */}
      {partido.origen.length > 0 && (
        <div className="bg-surface-alt border border-line rounded-lg p-2 space-y-1">
          <p className="text-[10px] uppercase font-semibold text-ink-muted">
            Del archivo de origen · no se edita
          </p>
          {partido.origen.map((t) => (
            <p key={t} className="text-xs text-ink font-mono break-words">
              {t}
            </p>
          ))}
          {editando && (
            <label className="flex items-start gap-2 text-xs text-ink-muted pt-1">
              <input
                type="checkbox"
                checked={!conservarOrigen}
                onChange={(e) => setConservarOrigen(!e.target.checked)}
                className="w-3.5 h-3.5 mt-0.5 rounded border-line text-danger"
              />
              <span>
                Borrar también esta parte. Es el único rastro de lo que decía la hoja de
                cálculo sobre este equipo.
              </span>
            </label>
          )}
        </div>
      )}

      {editando ? (
        <div className="space-y-2">
          <textarea
            value={libres}
            onChange={(e) => setLibres(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Observaciones sobre este equipo"
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setEditando(false);
                setLibres(partido.libres);
                setConservarOrigen(true);
              }}
              disabled={guardando}
              className="px-3 py-1.5 text-sm border border-line rounded-lg text-ink-muted hover:bg-surface-alt disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => void guardar()}
              disabled={guardando}
              className="px-3 py-1.5 text-sm bg-brand text-white rounded-lg font-medium hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5"
            >
              {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar
            </button>
          </div>
        </div>
      ) : partido.libres ? (
        <p className="text-sm text-ink whitespace-pre-wrap">{partido.libres}</p>
      ) : (
        <p className="text-sm text-ink-faint">Sin notas.</p>
      )}
    </div>
  );
};
