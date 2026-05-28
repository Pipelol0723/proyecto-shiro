# ADR 0015: HybridRouter — clasificador LLM con fallback heurístico

- **Status**: Accepted
- **Fecha**: 2026-05-28
- **Decidido por**: Pipelol0723

## Contexto

[ADR 0001](0001-arquitectura-modular-event-driven.md) y `modules.config.yaml` previeron un `HybridRouter` que decide para cada `user:message` si responde el LLM **local** (Ollama, gratis y privado) o el **cloud** (Anthropic, mejor calidad pero costoso). El YAML ya tiene la configuración:

```yaml
router:
  active: HybridRouter
  config:
    classifier_model: 'qwen2.5:7b'
    cloud_threshold: 0.6
```

Hace falta decidir **cómo decide**.

### Restricciones reales

- **Modelos chicos** (Qwen 2.5 3B, lo que cabe en GTX 1650 hoy) tienen mala calibración de confianza. Pedirles un score 0-1 da números arbitrarios.
- **Latencia importa**. El router corre antes del LLM principal. Si añade 2-3 segundos clasificando, el usuario lo nota.
- **Ollama puede estar caído**. El router no puede fallar el turno entero — necesita un plan B.
- **Heurísticas puras** funcionan razonable para muchos casos triviales ("hola", "qué hora es" → local; "explícame los modelos de difusión" → cloud) pero pierden matiz.

## Decisión

**Clasificador LLM-based con fallback heurístico**:

```
async route(request):
  try:
    tier = await Promise.race([
      askClassifier(request.text),     // Ollama con format JSON
      timeout(2000ms)
    ])
    return tier
  catch:
    return heuristic(request.text)
```

### `askClassifier`

Prompt corto pidiendo respuesta binaria con structured output (mismo mecanismo que ADR 0014):

```typescript
{
  model: config.classifier_model,
  messages: [
    { role: 'system', content:
      'Clasificas mensajes de usuario en "local" o "cloud".\n' +
      '- "local": saludos, charla casual, preguntas factuales simples.\n' +
      '- "cloud": razonamiento complejo, código, análisis técnico largo.\n' +
      'Respondes SOLO con el JSON requerido.'
    },
    { role: 'user', content: request.text }
  ],
  format: {
    type: 'object',
    properties: { tier: { type: 'string', enum: ['local', 'cloud'] } },
    required: ['tier']
  },
  stream: false,
  options: { temperature: 0.1 }   // determinista
}
```

Temperatura baja (0.1) para que la clasificación sea estable.

### Timeout

**2 segundos** para el clasificador. Si Ollama está cargando el modelo por primera vez tarda más — caemos al heurístico. En llamadas subsiguientes (modelo en VRAM) responde en <500ms.

### Heurística (fallback)

```typescript
function routeByHeuristic(text: string): LLMTier {
  if (text.length > 200) return 'cloud';
  const complexMarkers =
    /\b(explica|analiza|compara|diseña|programa|estrategia|implementa|optimiza|debug)/i;
  if (complexMarkers.test(text)) return 'cloud';
  return 'local';
}
```

Reglas:

- **Texto largo** (>200 caracteres) → cloud. Mensajes breves no justifican cloud.
- **Verbos de razonamiento complejo** → cloud.
- **Default** → local. Privacy-first.

La heurística también se usa si:

- Ollama responde algo que no parsea como `{ tier: 'local' | 'cloud' }`.
- Ollama da timeout (>2s).
- `fetch` falla por red.

### `cloud_threshold` queda deprecated

El campo del YAML asumía un score 0-1. Como usamos clasificación binaria, **el threshold no aplica en V1**. Se mantiene como opcional en el schema (no rompe configs existentes) pero se ignora. Un comentario en el YAML lo aclara. Cuando V2 traiga clasificación con scores reales (modelo más grande, embeddings, etc.), el threshold vuelve.

## Alternativas consideradas

- **Solo heurística (sin LLM)**: descartada. Falla en casos intermedios ("ayúdame a entender X" — depende del X). El LLM aporta valor cuando está disponible.
- **Solo LLM (sin fallback)**: descartada. Crea un punto de fallo crítico. Si Ollama está caído, el companion entero se cae — peor experiencia que ir a cloud por defecto.
- **Score 0-1 con threshold**: descartada para V1. Modelos chicos no calibran bien. Daría números arbitrarios y el threshold sería ruido. Reservado para V2 si llega.
- **Clasificador con embeddings** (similarity a queries de entrenamiento): descartada. Requiere persistir embeddings, modelo de embeddings cargado siempre, y un dataset etiquetado. Overkill para PR 7.
- **Todo a cloud siempre**: descartada. Pierde la razón de ser del modo local (privacidad, latencia, coste cero).
- **Todo a local siempre**: descartada. Modelos chicos no rinden en razonamiento complejo. El usuario pierde la opción de "Claude responde esta vez".

## Consecuencias

### Positivas

- **Mejor de dos mundos**: usa el LLM cuando está disponible, cae a heurística cuando no.
- **Fail-safe**: nunca rompe el turno por fallo del router. Default a local mantiene privacidad.
- **Determinista en tests**: pueden mockear `fetch` o pasar el clasificador caído para forzar el heurístico.
- **Cero infraestructura nueva**: reusa la API de Ollama ya levantada.

### Negativas / Riesgos

- **Latencia añadida** (~300-600ms en hot path, hasta 2s en cold). Asumible para chat humano; reconsiderar si se vuelve molesto en uso intensivo.
- **Modelos chicos pueden equivocarse** en la clasificación. Mitigación: el coste de una clasificación errónea es bajo — usuario recibe respuesta de Ollama cuando Claude habría sido mejor (o viceversa). No es catastrófico.
- **El `cloud_threshold` del YAML queda muerto**. Riesgo: dev confundido al leerlo. Mitigación: comentario explícito en el YAML.

### Neutrales

- **Algoritmo evolucionable**: cuando llegue un router más sofisticado (V2 con embeddings, o LLM grande con scoring real), reemplaza a HybridRouter manteniendo el contrato `IRouterModule.route()`.

## Notas de implementación

- `packages/core/src/modules/router/hybrid-router.ts`:
  - Clase `HybridRouter` implementa `IRouterModule`.
  - Hace `fetch` directo a `${classifier_host}/api/chat` (no reusa `OllamaLLM` porque el schema es distinto y no necesitamos su capa de validación de emociones).
  - `Promise.race([askClassifier(), timeout(2s)])`.
  - `routeByHeuristic()` exportado además de la clase para que tests lo prueben aislado.
- Schema config:
  ```typescript
  HybridRouterConfigSchema = z.object({
    classifier_model: z.string().default('qwen2.5:3b'),
    classifier_host: z.string().url().default('http://localhost:11434'),
    timeout_ms: z.number().int().positive().default(2_000),
    cloud_threshold: z.number().optional(), // deprecated, ignorado en V1
  });
  ```
- Tests:
  - `route()` con `fetch` mockeado devolviendo `{ tier: 'local' }` y `{ tier: 'cloud' }`.
  - Timeout → fallback heurístico.
  - Fetch rechaza → fallback heurístico.
  - Respuesta malformada → fallback heurístico.
  - Heurística directa: textos cortos → local, largos → cloud, con keyword complejo → cloud.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — la idea de routing por tier es de aquí.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — el mismo mecanismo de structured output (esta vez `{tier}` en lugar de `{text, emotion}`).
- [ADR 0016](0016-pipeline-conversational-wiring.md) — quien invoca este router.
- `IRouterModule` en `packages/core/src/interfaces/IRouterModule.ts`.
- OllamaLLM (PR 5) — comparte el mismo backend pero usa schema distinto.
