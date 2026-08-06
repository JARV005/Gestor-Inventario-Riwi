import React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';

import { ErrorApi } from '../lib/api';

/**
 * Los tres estados que toda vista conectada tiene que saber pintar, en un solo
 * sitio.
 *
 * Estaban dentro de `InventoryView`. Al conectar la segunda vista habrían
 * quedado dos copias, y una copia de un estado de error es una copia que se
 * queda atrás justo cuando alguien mejora la otra. Los textos importan: son lo
 * único que ve la persona cuando algo se rompe.
 */

export const Cargando: React.FC<{ que: string }> = ({ que }) => (
  <div className="border border-line rounded-xl bg-surface p-12 flex flex-col items-center gap-3 text-ink-soft">
    <Loader2 className="w-6 h-6 animate-spin text-brand" />
    <p className="text-sm">Cargando {que}…</p>
  </div>
);

/**
 * El estado vacío.
 *
 * Es el que ninguna vista tenía, y el más traicionero: una tabla sin filas que
 * enseña solo los encabezados es indistinguible de una que falló en silencio.
 * Decir «no hay ninguno todavía» es una afirmación; no decir nada no lo es.
 */
export const Vacio: React.FC<{ titulo: string; detalle?: string }> = ({ titulo, detalle }) => (
  <div className="border border-line rounded-xl bg-surface p-12 flex flex-col items-center gap-2 text-center">
    <Inbox className="w-6 h-6 text-ink-soft" />
    <p className="text-sm font-medium text-ink">{titulo}</p>
    {detalle && <p className="text-xs text-ink-soft max-w-sm">{detalle}</p>}
  </div>
);

/**
 * El estado de error, con sus cuatro causas separadas porque lo que la persona
 * puede hacer es distinto en cada una.
 *
 * Las cuatro se han visto en pantalla provocándolas: apagando Postgres,
 * bloqueando una tabla con LOCK TABLE, y desactivando al usuario con la vista
 * abierta.
 */
export const ErrorDeCarga: React.FC<{
  error: ErrorApi;
  que: string;
  onReintentar: () => void;
}> = ({ error, que, onReintentar }) => {
  const sinConexion = error.esSinConexion;
  const caducada = error.esSesionCaducada;
  const ocupada = error.estado === 503;
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
              : ocupada
                ? 'La base de datos está ocupada'
                : falloServidor
                  ? `El servidor no pudo consultar ${que}`
                  : `No se pudo cargar ${que}`}
        </p>
        <p className="text-sm text-ink-soft max-w-md">
          {sinConexion
            ? 'No se ha perdido nada: los datos están en el servidor y volverán a verse en cuanto responda.'
            : caducada
              ? 'Por seguridad la sesión se cierra tras un rato de inactividad, y también si alguien desactiva la cuenta o cambia la contraseña. Hay que volver a iniciar sesión.'
              : ocupada
                ? 'Otra operación la tiene ocupada y no pudo responder a tiempo. Suele durar segundos.'
                : falloServidor
                  ? 'No se ha perdido nada y no hace falta hacer nada más que reintentar en un momento. Si sigue igual, avisar a TI.'
                  : error.message}
        </p>
        {!sinConexion && !caducada && (
          <p className="text-xs text-ink-soft font-mono pt-1">Código {error.estado}</p>
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
