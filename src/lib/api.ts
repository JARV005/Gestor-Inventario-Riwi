/**
 * Cliente HTTP contra la API.
 *
 * La cookie de sesión es `httpOnly`, así que el navegador la manda sola —
 * siempre que se pida con `credentials: 'include'`. Ese es todo el manejo de
 * sesión que hay en el frontend: no hay token que guardar ni que refrescar, y
 * eso es exactamente lo que se buscaba al no usar JWT en `localStorage`.
 */

import type {
  ActaEmitida,
  ActaResumen,
  CatalogoTransiciones,
  EmpleadoConConteo,
  EquipoConMotivos,
  EquipoResumen,
  MantenimientoConEquipo,
  Movimiento,
  MovimientoConNombres,
  NuevoEquipo,
  Pagina,
  ResumenEquipos,
  Sede,
  SedeConConteos,
  TipoActa,
  TrasladoAbierto,
  UsuarioSesion,
} from '../types';

/** Serializa filtros a query string, saltándose los vacíos. */
function consulta(f: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

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

  sedesConConteos: () =>
    pedir<{ sedes: SedeConConteos[]; equipos_sin_sede: number }>('/api/sedes?conteos=1'),

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

  /** Los agregados del dashboard, contados en Postgres y no aquí. */
  resumenEquipos: () => pedir<ResumenEquipos>('/api/equipos/resumen'),

  /**
   * Alta de un equipo. El servidor escribe la fila y su movimiento `Alta` en
   * la misma transacción; aquí solo se manda lo que el formulario recogió.
   */
  crearEquipo: (datos: NuevoEquipo) =>
    pedir<{ equipo: EquipoConMotivos }>('/api/equipos', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  empleados: (f: { q?: string; sede?: string; activo?: boolean; pagina?: number; porPagina?: number } = {}) =>
    pedir<Pagina<EmpleadoConConteo>>(`/api/empleados${consulta(f)}`),

  equiposDe: (id: string) =>
    pedir<{ equipos: EquipoResumen[] }>(`/api/empleados/${id}/equipos`),

  mantenimientos: (f: { equipo?: string; estado?: string; porPagina?: number } = {}) =>
    pedir<Pagina<MantenimientoConEquipo>>(`/api/mantenimientos${consulta(f)}`),

  /**
   * Las mutaciones de estado. Cada una escribe `equipos`, `movimientos` y
   * `auditoria` en una sola transacción; qué transición es legal lo decide el
   * servidor (`db/transiciones.ts`) y lo explica en el 409.
   */
  asignar: (equipoId: string, empleadoId: string) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/asignar`,
      { method: 'POST', body: JSON.stringify({ empleado_id: empleadoId }) },
    ),

  devolver: (equipoId: string, observaciones?: string | null) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/devolver`,
      { method: 'POST', body: JSON.stringify({ observaciones: observaciones ?? null }) },
    ),

  trasladar: (
    equipoId: string,
    sedeDestinoId: string,
    extra: { transportadora?: string | null; guia?: string | null; fecha_estimada?: string | null } = {},
  ) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/trasladar`,
      {
        method: 'POST',
        body: JSON.stringify({
          sede_destino_id: sedeDestinoId,
          transportadora: extra.transportadora ?? null,
          guia: extra.guia ?? null,
          fecha_estimada: extra.fecha_estimada ?? null,
        }),
      },
    ),

  /**
   * Las que no necesitan más datos que el equipo. Una sola función porque la
   * diferencia entre ellas está en el servidor, no aquí: si esta capa supiera
   * qué hace cada una, sería otra copia de la tabla de transiciones.
   */
  operacionSimple: (equipoId: string, operacion: 'reservar' | 'liberar' | 'baja') =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/equipos/${equipoId}/${operacion}`,
      { method: 'POST', body: '{}' },
    ),

  /** La tabla de transiciones. Se pide una vez y vale para todos los equipos. */
  transiciones: () => pedir<CatalogoTransiciones>('/api/transiciones'),

  /** Historial con nombres resueltos, y el traslado abierto si lo hay. */
  historial: (equipoId: string) =>
    pedir<{ movimientos: MovimientoConNombres[]; traslado_abierto: TrasladoAbierto | null }>(
      `/api/equipos/${equipoId}/historial`,
    ),

  /**
   * Emitir un acta sobre operaciones **que ya ocurrieron**. El servidor busca
   * el movimiento que documenta cada equipo y responde 409 si no existe.
   */
  emitirActa: (datos: { tipo: TipoActa; empleado_id: string; equipos: string[] }) =>
    pedir<{ acta: ActaEmitida }>('/api/actas', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  acta: (id: string) => pedir<{ acta: ActaEmitida }>(`/api/actas/${id}`),

  actas: (f: { empleado?: string } = {}) =>
    pedir<{ actas: ActaResumen[] }>(`/api/actas${consulta(f)}`),

  /** Desactivar a alguien. 409 si tiene equipos a su nombre. */
  desactivarEmpleado: (id: string) =>
    pedir<{ empleado: EmpleadoConConteo }>(`/api/empleados/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false }),
    }),

  /** Los traslados en curso. La otra cara del badge del sidebar. */
  trasladosAbiertos: () => pedir<{ traslados: TrasladoAbierto[] }>('/api/traslados'),

  /**
   * Confirmar la llegada. El servidor cierra el movimiento y mueve el equipo a
   * la sede destino en la misma transacción; aquí solo se manda el id.
   */
  confirmarTraslado: (movimientoId: string) =>
    pedir<{ equipo: EquipoConMotivos; movimiento: Movimiento }>(
      `/api/movimientos/${movimientoId}/confirmar`,
      { method: 'POST', body: '{}' },
    ),
};
