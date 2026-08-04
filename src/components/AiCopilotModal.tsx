import React, { useState } from 'react';
import { Sparkles, Send, Bot, User, X, Check, Copy, RefreshCw, Zap } from 'lucide-react';

interface AiCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventorySummaryContext: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
}

export const AiCopilotModal: React.FC<AiCopilotModalProps> = ({
  isOpen,
  onClose,
  inventorySummaryContext,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-1',
      sender: 'bot',
      text: '¡Hola! Soy FirstPlug Copilot IA. Puedo ayudarte con auditorías de inventario, recomendaciones de hardware para contrataciones, análisis de garantías y logística de envíos. ¿En qué te ayudo hoy?',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const quickPrompts = [
    '¿Cuántos MacBook Pro tenemos disponibles en Hub CDMX?',
    'Muestra los equipos con más de 3 años de antigüedad',
    'Recomienda un kit de hardware para Senior Developer',
    'Resumen de costos de inventario por departamento',
  ];

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || input;
    if (!query.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: query,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const historyForApi = messages.map((m) => ({
        role: m.sender === 'user' ? 'user' : 'model',
        content: m.text,
      }));

      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          history: historyForApi,
          inventoryContext: inventorySummaryContext,
        }),
      });

      const data = await response.json();

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: data.text || 'Respuesta generada.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error('Error in Copilot chat:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          sender: 'bot',
          text: 'Ocurrió un inconveniente al conectar con el asistente de IA. Por favor verifica la API Key de Gemini en los secretos.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl h-[85vh] flex flex-col justify-between shadow-xl relative overflow-hidden animate-in fade-in text-slate-900">
        
        {/* Header */}
        <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-extrabold shadow-xs">
              <Sparkles className="w-5 h-5 fill-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                FirstPlug Copilot IA
                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-semibold">
                  Gemini 3.6 Flash
                </span>
              </h2>
              <p className="text-[11px] text-slate-500">Asistente Inteligente de Gestión de Inventarios & TI</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Chat Messages Body */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-3 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.sender === 'bot' && (
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[80%] p-3.5 rounded-2xl leading-relaxed whitespace-pre-wrap ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white font-medium rounded-tr-none shadow-xs'
                    : 'bg-slate-50 text-slate-800 border border-slate-200 rounded-tl-none shadow-2xs'
                }`}
              >
                {m.text}
                <span className={`block text-[9px] text-right mt-1.5 opacity-80 ${m.sender === 'user' ? 'text-blue-100' : 'text-slate-500'}`}>
                  {m.time}
                </span>
              </div>

              {m.sender === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-slate-500 text-xs italic">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
              FirstPlug Copilot está analizando el inventario...
            </div>
          )}
        </div>

        {/* Quick Prompts Bar */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="text-slate-500 shrink-0 font-semibold">Sugerencias:</span>
          {quickPrompts.map((qp, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(qp)}
              className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg shrink-0 transition-colors shadow-2xs font-medium"
            >
              {qp}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-white border-t border-slate-200">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Pregunta a Copilot sobre inventario, envíos, modelos o renovaciones..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-1.5 shrink-0"
            >
              <Send className="w-3.5 h-3.5 fill-white" />
              <span className="hidden sm:inline text-xs">Enviar</span>
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};
