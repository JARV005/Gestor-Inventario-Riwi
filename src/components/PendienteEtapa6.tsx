import React from 'react';
import { CircleDashed } from 'lucide-react';

/**
 * Hueco declarado en el dashboard.
 *
 * Cinco widgets perdieron su fuente de datos en la etapa 4a: valor total del
 * parque, enrolamiento MDM, costo por departamento, envíos y hubs. Los sustituye
 * D3, pero los siete widgets nuevos son de la etapa 6.
 *
 * Se conserva la tarjeta —título, posición y tamaño— con el número cambiado por
 * el motivo. El dashboard se ve incompleto a propósito: es la verdad, y un
 * hueco marcado es lo que impide que la etapa 6 se olvide de rellenarlo.
 */

interface PendienteEtapa6Props {
  /** `pendiente`: vuelve cuando haya datos. `retirado`: no vuelve. */
  clase: 'pendiente' | 'retirado';
  motivo: string;
}

export const PendienteEtapa6: React.FC<PendienteEtapa6Props> = ({ clase, motivo }) => (
  <div className="space-y-1.5">
    <p className="flex items-center gap-1.5 text-sm font-medium text-ink-muted">
      <CircleDashed className="w-4 h-4" />
      {clase === 'pendiente' ? 'Pendiente' : 'Retirado'}
    </p>
    <p className="text-[11px] leading-snug text-ink-muted">{motivo}</p>
  </div>
);
