import React, { useState } from 'react';
import { Loader2, LogIn, ShieldAlert } from 'lucide-react';

import { api, ErrorApi } from '../lib/api';
import type { UsuarioSesion } from '../types';

/**
 * Puerta de entrada. Antes no existía: el prototipo abría directamente en el
 * dashboard porque no había nada que proteger.
 *
 * No guarda nada. La sesión vive en una cookie `httpOnly` que el navegador
 * manda sola y este código no puede ni leer — que es justo el punto de no usar
 * un token en `localStorage`.
 */

interface LoginProps {
  onEntrar: (usuario: UsuarioSesion) => void;
}

export const Login: React.FC<LoginProps> = ({ onEntrar }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const { usuario } = await api.entrar(email, password);
      onEntrar(usuario);
    } catch (err) {
      if (err instanceof ErrorApi && err.esSinConexion) {
        setError('No se pudo contactar con el servidor. Reintentar en un momento.');
      } else if (err instanceof ErrorApi && err.estado === 429) {
        setError('Demasiados intentos. Esperar unos minutos antes de volver a probar.');
      } else {
        // El servidor devuelve el mismo mensaje tanto si la cuenta no existe
        // como si la contraseña es incorrecta. Aquí se repite tal cual: matizar
        // el texto en el cliente desharía esa propiedad.
        setError(err instanceof ErrorApi ? err.message : 'No se pudo iniciar sesión.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-alt flex items-center justify-center p-4">
      <form
        onSubmit={enviar}
        className="bg-surface border border-line rounded-xl p-8 w-full max-w-sm space-y-5"
      >
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-ink">Inventario TI</h1>
          <p className="text-sm text-ink-soft">Acceso restringido al equipo de TI.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-ink-soft mb-1">
              Correo
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-ink-soft mb-1">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-ink bg-danger/10 border border-danger/40 rounded-lg px-3 py-2 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full px-4 py-2.5 bg-brand text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};
