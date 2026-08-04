import React, { useState } from 'react';
import { CatalogItem } from '../types';
import { CATALOG_ITEMS } from '../data/mockData';
import { 
  ShoppingBag, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  ShieldCheck, 
  Truck, 
  Search, 
  Plus, 
  Filter, 
  Zap,
  ArrowRight,
  X
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface ProcurementCatalogViewProps {
  onOrderSuccess: (item: CatalogItem, mode: 'buy' | 'lease') => void;
}

export const ProcurementCatalogView: React.FC<ProcurementCatalogViewProps> = ({
  onOrderSuccess,
}) => {
  const [items] = useState<CatalogItem[]>(CATALOG_ITEMS);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [orderingItem, setOrderingItem] = useState<{ item: CatalogItem; mode: 'buy' | 'lease' } | null>(null);

  // AI Kit Recommender Form State
  const [showAiRecommender, setShowAiRecommender] = useState(false);
  const [recRole, setRecRole] = useState('Senior Fullstack Engineer');
  const [recDept, setRecDept] = useState('Engineering');
  const [recSeniority, setRecSeniority] = useState('Senior / Lead');
  const [loadingAiRec, setLoadingAiRec] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  const filteredItems = items.filter((item) => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.brand.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleFetchAiRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingAiRec(true);
    setAiResult(null);

    try {
      const response = await fetch('/api/gemini/recommend-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: recRole,
          department: recDept,
          seniority: recSeniority,
          budgetLevel: 'Standard Enterprise',
        }),
      });

      const data = await response.json();
      if (data.recommendation) {
        setAiResult(data.recommendation);
      }
    } catch (err) {
      console.error('Error fetching AI recommendation:', err);
    } finally {
      setLoadingAiRec(false);
    }
  };

  const handleConfirmOrder = () => {
    if (!orderingItem) return;
    onOrderSuccess(orderingItem.item, orderingItem.mode);
    setOrderingItem(null);
    confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Main Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Catálogo de Hardware & Compra FirstPlug
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full font-semibold">
              Entrega Inmediata
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Adquiere o alquila laptops, monitores y kits ergonómicos pre-configurados para tu equipo.
          </p>
        </div>

        <button
          onClick={() => setShowAiRecommender(!showAiRecommender)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-all"
        >
          <Sparkles className="w-4 h-4 text-blue-200 animate-pulse" />
          <span>Recomendador de Kits IA</span>
        </button>
      </div>

      {/* AI Kit Recommender Drawer / Panel */}
      {showAiRecommender && (
        <div className="bg-slate-50 border border-blue-200 rounded-xl p-5 shadow-sm relative animate-in fade-in space-y-4">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Asistente IA de Selección de Kit FirstPlug</h3>
                <p className="text-xs text-slate-500">Genera la configuración óptima de hardware para el puesto que estás contratando.</p>
              </div>
            </div>
            <button
              onClick={() => setShowAiRecommender(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg bg-white border border-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleFetchAiRecommendation} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Puesto del Empleado</label>
              <input
                type="text"
                value={recRole}
                onChange={(e) => setRecRole(e.target.value)}
                placeholder="Ej. Lead Frontend Engineer"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Departamento</label>
              <select
                value={recDept}
                onChange={(e) => setRecDept(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="Engineering">Engineering</option>
                <option value="Product">Product & Design</option>
                <option value="Marketing">Marketing & Sales</option>
                <option value="HR & Ops">HR & Operations</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Nivel / Seniority</label>
              <select
                value={recSeniority}
                onChange={(e) => setRecSeniority(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="Junior / Semi-Senior">Junior / Semi-Senior</option>
                <option value="Senior / Lead">Senior / Lead</option>
                <option value="Director / C-Level">Director / C-Level</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={loadingAiRec}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                {loadingAiRec ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Analizando...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 fill-white" />
                    <span>Recomendar Kit</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* AI Result Display */}
          {aiResult && (
            <div className="bg-white p-4 rounded-xl border border-blue-200 space-y-3 text-xs animate-in fade-in">
              <div className="flex items-center justify-between text-blue-700 font-bold border-b border-slate-100 pb-2">
                <span>Kit Recomendado por FirstPlug Copilot</span>
                <span className="text-[10px] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">100% Compatibilidad</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Laptop Sugerida</span>
                  <span className="font-bold text-slate-900 block mt-0.5">{aiResult.laptop}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Monitor Sugerido</span>
                  <span className="font-bold text-slate-900 block mt-0.5">{aiResult.monitor}</span>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Periféricos Recomendados</span>
                  <span className="font-semibold text-slate-700 block mt-0.5">{aiResult.accessories?.join(', ')}</span>
                </div>
              </div>

              <p className="text-slate-600 italic text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                "{aiResult.reasoning}"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por modelo o marca..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border border-slate-200 text-xs w-full sm:w-auto overflow-x-auto">
          {['All', 'Laptop', 'Monitor', 'Peripherals'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                selectedCategory === cat ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {cat === 'All' ? 'Todos los Ítems' : cat === 'Laptop' ? 'Laptops' : cat === 'Monitor' ? 'Monitores' : 'Periféricos'}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-all flex flex-col justify-between space-y-4 shadow-sm group"
          >
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-xl bg-slate-50 border border-slate-200 aspect-video">
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <span className="absolute top-2 left-2 bg-white/90 text-slate-900 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-md backdrop-blur-xs">
                  {item.brand}
                </span>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 text-base group-hover:text-blue-600 transition-colors">{item.name}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.specs}</p>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag, idx) => (
                  <span key={idx} className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-md font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Price & Action Buttons */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-semibold block">Compra Directa</span>
                  <span className="font-extrabold text-slate-900 text-base">${item.priceUSD} USD</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-blue-600 uppercase font-semibold block">Arrendamiento</span>
                  <span className="font-extrabold text-blue-600 text-base">${item.monthlyLeaseUSD} <span className="text-xs text-slate-500 font-normal">/ mes</span></span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setOrderingItem({ item, mode: 'lease' })}
                  className="py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg transition-colors shadow-xs"
                >
                  Arrendar (${item.monthlyLeaseUSD}/mes)
                </button>
                <button
                  onClick={() => setOrderingItem({ item, mode: 'buy' })}
                  className="py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 transition-colors shadow-xs"
                >
                  Comprar (${item.priceUSD})
                </button>
              </div>
            </div>

          </div>
        ))}
      </div>

      {/* Order Modal */}
      {orderingItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-5 shadow-xl relative animate-in fade-in text-slate-900">
            <button
              onClick={() => setOrderingItem(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl border border-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-blue-600" />
                Confirmar Solicitud de Hardware
              </h2>
              <p className="text-xs text-slate-500">
                FirstPlug se encargará de la configuración, enrolamiento MDM y envío en 48 horas.
              </p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="font-bold text-slate-900 text-sm">{orderingItem.item.name}</div>
              <p className="text-slate-500">{orderingItem.item.specs}</p>
              <div className="pt-2 border-t border-slate-200 flex justify-between font-bold">
                <span className="text-slate-700">Modo de Adquisición:</span>
                <span className="text-blue-600">
                  {orderingItem.mode === 'lease' ? `Alquiler Mensual ($${orderingItem.item.monthlyLeaseUSD}/mes)` : `Compra Directa ($${orderingItem.item.priceUSD} USD)`}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setOrderingItem(null)}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmOrder}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors"
              >
                Confirmar y Añadir a Inventario
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
