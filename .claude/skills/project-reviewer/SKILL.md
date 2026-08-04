---
name: project-reviewer
description: Revisa proyectos ZIP de estudiantes RIWI sin sobrecargar tokens
version: 1.0.0
---

# 🎓 Project Reviewer - RIWI Edition

## Propósito
Analizar entregas de estudiantes (Centinela, Patanova, Azure Projects) en ZIP 
con máxima eficiencia de tokens.

## Cómo Usar

### Cuando lo llames:
1. Subo tu archivo ZIP
2. Listo los archivos sin extraer todo
3. Busco puntos de entrada (package.json, main.tf, etc)
4. Valido sintaxis JSON/YAML
5. Reporto hallazgos críticos

## Comandos Rápidos

**Análisis rápido:**
\`\`\`
/project-reviewer archivo.zip
\`\`\`

**Análisis profundo (todos los archivos):**
\`\`\`
/project-reviewer --deep archivo.zip
\`\`\`

## Casos de Uso
- ✅ Calificar entregas de Centinela (Azure fraud detection)
- ✅ Revisar panels de Patanova (eCommerce)
- ✅ Auditar Node.js + TypeScript projects
- ✅ Verificar compliance de Clases-Nakamoto
- ✅ Revisar entregas de estudiantes ITM

## Salida Esperada

\`\`\`
📦 ANÁLISIS DE PROYECTO: proyecto.zip
├─ 📊 Tamaño: 5.2 MB
├─ 📂 Archivos: 127
├─ ⏱️ Tiempo: 2.3s (token-optimized)
├─ ✅ Validaciones
│  ├─ JSON: OK
│  ├─ package.json: Present
│  ├─ .env: Secretos ocultos ✓
│  └─ README: Presente
└─ ⚠️ Warnings: 0
\`\`\`

## Pasos Internos (Automáticos)

1. **Listar sin extraer**: Usa \`unzip -l\` / \`Expand-Archive -WhatIf\`
2. **Buscar tamaño**: Identifica archivos grandes
3. **Validar JSON**: Verifica package.json y config files
4. **Buscar problemas**: grep/Select-String para TODO, ERROR, deprecated
5. **Reportar**: Prioriza issues críticas primero

## Optimización de Tokens

- ✓ Listado de archivos sin extraer: ~30 tokens
- ✓ Análisis de tamaño: ~10 tokens
- ✓ Validación JSON: ~50 tokens
- ✓ Búsqueda de problemas: ~40 tokens
- **Total: ~130 tokens** vs 5000+ si leo todo

## Ejemplos de Uso

**Tu entrada:**
\`\`\`
/project-reviewer mi-proyecto.zip
\`\`\`

**Mi análisis:**
- Extrae sin cargar en memoria
- Encuentra package.json → lee dependencias
- Busca archivos de config → valida sintaxis
- Reporta: ✅ Proyecto válido, 0 dependencias deprecated, .env configurado