// Sin esto no hay DATABASE_URL, ni SESSION_SECRET, ni ENCRYPTION_KEY: `tsx` no
// lee .env por su cuenta y el servidor moría al construir el pool.
import "dotenv/config";

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

import { crearApp } from "./server/app.js";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

/**
 * La API de la etapa 3, montada solo para `/api`.
 *
 * Con `app.use(api)` a secas, la sesión y el parseo de JSON correrían también
 * para cada asset que sirve Vite — una consulta a Postgres por cada .tsx del
 * arranque. El filtro por prefijo lo evita.
 *
 * Las rutas que la API no conoce, como `/api/gemini/*`, caen al `next()` y las
 * atienden los manejadores de más abajo.
 */
const api = crearApp();
app.use((req, res, next) => (req.path.startsWith("/api") ? api(req, res, next) : next()));

// Lazy GoogleGenAI instance initialization helper
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is missing in environment variables.");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// `/api/health` lo sirve ahora la API de arriba.

// AI IT Inventory Chat / Copilot API
app.post("/api/gemini/chat", async (req, res) => {
  try {
    const { message, history, inventoryContext } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.status(503).json({
        error: "Servicio de IA no disponible. Configura GEMINI_API_KEY en los secretos.",
      });
    }

    const systemInstruction = `
Eres FirstPlug Copilot, un asistente virtual experto en Gestión de Inventarios de TI (ITAM), Logística para Equipos Remotos, Onboarding/Offboarding de colaboradores y Cumplimiento de Licencias.

Contexto del Inventario Actual de la Organización:
${inventoryContext || "Inventario general de Laptops, Monitores, Celulares, Hubs de Almacenamiento en CDMX, Bogotá, Buenos Aires, Miami y Madrid."}

Guía de Respuesta:
1. Responde de forma clara, profesional, concisa y estructurada en idioma ESPAÑOL.
2. Ayuda a los Gestores de TI y RRHH a tomar decisiones informadas sobre rotación de hardware, garantías, presupuestos y entregas.
3. Puedes formatear las respuestas con listas viñeteadas, negritas y tablas cuando sea útil.
4. Mantén siempre un tono corporativo moderno de apoyo al cliente de FirstPlug.
`;

    // Construct conversation array or prompt
    const contents: any[] = [];
    if (history && Array.isArray(history)) {
      history.forEach((h: any) => {
        contents.push({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: h.content }],
        });
      });
    }
    contents.push({
      role: "user",
      parts: [{ text: message || "Hola, ¿cómo me puedes ayudar a gestionar el inventario de TI?" }],
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: contents,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    res.json({ text: response.text || "No se pudo generar la respuesta." });
  } catch (error: any) {
    console.error("Error calling Gemini API:", error);
    res.status(500).json({ error: error?.message || "Error al procesar la solicitud de IA." });
  }
});

// AI Handover Document Generator API
app.post("/api/gemini/handover-act", async (req, res) => {
  try {
    const { employeeName, employeeRole, employeeDocId, deviceName, serialNumber, specs, location, handoverDate } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      // Fallback response if no key
      return res.json({
        documentMarkdown: `
# ACTA DE ENTREGA Y RESPONSABILIDAD DE EQUIPO DE COMPUTO
**Organización:** FirstPlug Managed Operations
**Fecha:** ${handoverDate || new Date().toLocaleDateString("es-ES")}
**Lugar / Hub:** ${location || "Ciudad de México / Remoto"}

---

### DATOS DEL COLABORADOR
- **Nombre Completo:** ${employeeName}
- **Puesto / Rol:** ${employeeRole}
- **Documento / ID:** ${employeeDocId || "ID-98432"}

### DETALLE DEL EQUIPO ASIGNADO
- **Equipo / Modelo:** ${deviceName}
- **Número de Serie:** ${serialNumber}
- **Especificaciones:** ${specs}
- **Estado Físico:** Excelente / Como Nuevo (Certificado FirstPlug)

---

### COMPROMISO Y CONDICIONES DE USO
1. El colaborador declara haber recibido el equipo descrito arriba en perfectas condiciones operativas y físicas.
2. El equipo está destinado exclusivamente para el desempeño de las labores asignadas por la empresa.
3. El colaborador se compromete a cuidar el bien y notificar de inmediato cualquier falla, extravío o daño a TI.
4. En caso de desvinculación (Offboarding), el colaborador deberá devolver el equipo mediante el kit de recolección de FirstPlug.

---
**Firma del Colaborador:** _______________________
**Firma de Entrega FirstPlug TI:** _______________________
        `,
      });
    }

    const prompt = `
Genera un acta formal en formato Markdown redactada profesionalmente en ESPAÑOL titulada "ACTA DE ENTREGA Y RESPONSABILIDAD DE EQUIPO DE CÓMPUTO".

Datos para la confección:
- Colaborador: ${employeeName} (${employeeRole}) - Doc ID: ${employeeDocId}
- Equipo: ${deviceName}
- Número de Serie: ${serialNumber}
- Especificaciones Técnicas: ${specs}
- Ubicación/Hub de Salida: ${location}
- Fecha de Entrega: ${handoverDate}

El documento debe ser completo, incluir cláusulas legales estándar de custodia de activos informáticos de la empresa, confidencialidad, uso adecuado de software con licencia y protocolo de devolución FirstPlug al concluir la relación laboral. Incluir secciones para firmas de ambas partes.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
    });

    res.json({ documentMarkdown: response.text });
  } catch (error: any) {
    console.error("Error generating handover act:", error);
    res.status(500).json({ error: "Error al generar el acta de entrega." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`FirstPlug ITAM Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
