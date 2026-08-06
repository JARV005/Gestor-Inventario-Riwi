/**
 * Cliente HTTP contra la API.
 *
 * La cookie de sesión es `httpOnly`, así que el navegador la manda sola —
 * siempre que se pida con `credentials: 'include'`. Ese es todo el manejo de
 * sesión que hay en el frontend: no hay token que guardar ni que refrescar, y
 * eso es exactamente lo que se buscaba al no usar JWT en `localStorage`.
 */

import type { EquipoConMotivos, Pagina, Sede, UsuarioSesion } from '../types';

/** Error con el estado HTTP a la vista, para que la interfaz pueda distinguir. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }

  /** 401: no hay sesión, o dejó de valer mientras la pestaña estaba abierta. */
  get esSesionCaducada() {
    return this.estado === 401;
  }

  /** 0: no hubo respuesta. Servidor caído o red cortada. */
  get esSinConexion() {
    return this.estado === 0;
  }

  /**
   * 5xx: el servidor contestó, pero no pudo. Es lo que llega cuando Postgres
   * está apagado — comprobado apagando el contenedor con la app abierta.
   * Se distingue del resto porque reintentar sí tiene sentido.
   */
  get esFalloDelServidor() {
    return this.estado >= 500;
  }
}

async function pedir<T>(camino: string, opciones: RequestInit = {}): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(camino, {
      ...opciones,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...opciones.headers },
    });
  } catch {
    // `fetch` solo rechaza cuando no hubo respuesta. Un 500 no llega aquí.
    throw new ErrorApi(0, 'No se pudo contactar con el servidor.');
  }

  if (!respuesta.ok) {
    let mensaje = `Error ${respuesta.status}`;
    try {
      const cuerpo = (await respuesta.json()) as { error?: string };
      if (cuerpo.error) mensaje = cuerpo.error;
    } catch {
      // Un error sin cuerpo JSON. El estado ya dice lo suficiente.
    }
    throw new ErrorApi(respuesta.status, mensaje);
  }

  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

export interface ConteoMotivo {
  codigo: string;
  equipos: number;
}

export interface FiltrosEquipos {
  estado?: string;
  categoria?: string;
  sede?: string;
  q?: string;
  motivo?: string;
  pagina?: number;
  porPagina?: number;
}

export const api = {
  yo: () => pedir<{ usuario: UsuarioSesion }>('/api/auth/me'),

  entrar: (email: string, password: string) =>
    pedir<{ usuario: UsuarioSesion }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  salir: () => pedir<void>('/api/auth/logout', { method: 'POST' }),

  sedes: () => pedir<{ sedes: Sede[] }>('/api/sedes'),

  /** La bandeja: además del listado, cuántos equipos tiene cada motivo. */
  revision: (f: FiltrosEquipos = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    }
    const cadena = p.toString();
    return pedir<Pagina<EquipoConMotivos> & { conteos: ConteoMotivo[] }>(
      `/api/equipos/revision${cadena ? `?${cadena}` : ''}`,
    );
  },

  equipos: (f: FiltrosEquipos = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    }
    const cadena = p.toString();
    return pedir<Pagina<EquipoConMotivos>>(`/api/equipos${cadena ? `?${cadena}` : ''}`);
  },

  equipo: (id: string) => pedir<{ equipo: EquipoConMotivos }>(`/api/equipos/${id}`),
};
