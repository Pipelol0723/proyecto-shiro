# ADR 0014: Formato estructurado de salida del LLM — `{ text, emotion }`

- **Status**: Accepted (retrospective)
- **Fecha**: 2026-05-28 (decisión efectiva: 2026-05-27, durante el planning de PRs 5/6)
- **Decidido por**: Pipelol0723

## Contexto

El evento `llm:responded` del [EventMap](../../packages/core/src/types/events.ts) lleva siempre dos campos:

```typescript
'llm:responded': {
  text: string;
  emotion: Emotion;   // 'neutral' | 'divertida' | 'pensativa' | 'molesta' | 'vulnerable'
  // ...
}
```

`text` lo pinta el cliente como subtítulo y `emotion` la consume el avatar (color del orbe, expresión del Live2D futuro) y eventualmente el TTS (parámetros de voz).

Cuando llegaron los primeros LLM reales (PRs 5 y 6) hubo que decidir **cómo obtener la emoción** del modelo. Tres approaches sobre la mesa:

1. **JSON estructurado**: el modelo emite `{ text, emotion }` como JSON garantizado.
2. **Tag al final del texto**: `respuesta. [emotion: divertida]` parseado por regex.
3. **Inferencia post-hoc**: una segunda llamada al LLM clasificando la emoción del primer output.

Este ADR registra la decisión que tomamos en planning y que ya está implementada en `OllamaLLM` (PR 5) y `AnthropicLLM` (PR 6).

## Decisión

**JSON estructurado, forzado por el proveedor.** Cada implementación de `ILLMModule` usa el mecanismo nativo del provider para garantizar que el output cumpla el schema `{ text: string, emotion: <enum> }`.

### Ollama: `format` con JSON schema

```typescript
{
  // ...
  format: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      emotion: { type: 'string', enum: [...EMOTIONS] }
    },
    required: ['text', 'emotion']
  }
}
```

Ollama 0.5+ garantiza que `message.content` será un JSON parseable que cumple el schema.

### Anthropic: tool use forzado

```typescript
{
  tools: [{
    name: 'respond',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        emotion: { type: 'string', enum: [...EMOTIONS] }
      },
      required: ['text', 'emotion']
    }
  }],
  tool_choice: { type: 'tool', name: 'respond' }
}
```

La API de Anthropic no tiene `format: json` con schema, pero `tool_use` cumple la misma función: el modelo está obligado a llamar la herramienta `respond` con el input que define el schema.

### Fallback uniforme

Si por la razón que sea (Ollama 0.4 sin structured outputs, modelo viejo, parser falla) el output no cumple el contrato:

- **Texto crudo** entra como `text`.
- **Emoción inválida o ausente** → `'neutral'`.

Mejor degradar a "respuesta sin emoción" que romper el turno entero.

## Alternativas consideradas

- **Tag al final del texto (`respuesta. [emotion: divertida]`)**: descartada. Parser frágil — el modelo a veces omite el tag, lo escribe distinto (`[Emotion: divertida]`, `[emoción: divertida]`), lo mete en medio. Streaming pintaría el tag al usuario antes de poder retirarlo.
- **Inferencia post-hoc** (dos llamadas al LLM por turno): descartada. Dobla la latencia y el coste. La emoción la conoce el LLM cuando escribe el texto — no hace falta una segunda pasada para inferirla.
- **Sin emoción** (solo `text`): descartada. El avatar sin emoción es una bola gris siempre. Reduce el companion a un chatbot sin presencia.
- **Schema más rico** (`{ text, emotion, intent, confidence, ... }`): descartada para V1. Cada campo extra es uno más que el modelo puede equivocar. Empezar minimal; ampliar cuando los datos digan que hace falta.

## Consecuencias

### Positivas

- **Contract garantizado por el provider** (Ollama format / Anthropic tool_use), no por nuestro parsing.
- **Mismo shape conceptual en ambos LLMs**, distinto mecanismo. El `ILLMModule.LLMResponse` no cambia.
- **Degradación graceful**: emoción inválida → neutral, sin romper.
- **Avatar siempre tiene señal**: aunque la emoción falle, hay un valor por defecto que el orbe pinta como neutral.

### Negativas / Riesgos

- **Streaming queda mal**: si el output es JSON, los chunks intermedios no son texto legible. Por eso `generateStream()` se omitió en PRs 5/6 — decisión deferida hasta TTS. Cuando llegue TTS, evaluaremos: parser incremental de JSON, o segunda llamada sin schema solo para streaming + una sin streaming para la clasificación.
- **Modelos chicos pueden ignorar el schema** ocasionalmente. Mitigación: el fallback a neutral. Si se vuelve frecuente, subir el system prompt para enfatizar el formato.
- **Cualquier emoción nueva requiere actualizar tres sitios**: el enum (`emotions.ts`), el schema generado en cada LLM, y el avatar mapping. Aceptable porque el enum cambia raramente.

### Neutrales

- El system prompt **no necesita explicar el formato JSON** — el provider lo enforza. Mantiene el prompt centrado en la personalidad. Esto se documenta en `system-prompt-builder.ts`.

## Addendum 2026-05-28: el provider no enforza tanto como pensábamos

Tras las primeras horas de uso real con OllamaLLM y AnthropicLLM (PRs 5 y 6) detectamos que **ambos providers omiten la emoción con frecuencia notable**, especialmente con inputs cortos ("hola") o cuando el modelo está poco "calentado":

- **Anthropic** acepta el `tool_use` forzado, pero `required: ['text', 'emotion']` es un hint que el modelo puede ignorar. En la práctica, ~30% de respuestas a inputs triviales llegaban sin `emotion`. Resultado: warn "emoción desconocida 'undefined', usando neutral".
- **Ollama con `qwen2.5:3b`** sigue el schema mejor (es más estricto), pero el modelo de 3B es lo bastante pequeño que ocasionalmente devuelve la JSON sin el campo o con un valor fuera del enum.

El fallback a `'neutral'` evita romper el turno — bien — pero el avatar se queda neutral siempre. Pierde el 80% de su valor.

**Mitigación adoptada**: el `buildSystemPrompt` añade una sección final `FORMATO DE SALIDA` que recuerda en lenguaje natural que la emoción es obligatoria y lista las 5 válidas. Con esto el ratio de respuestas con emoción válida sube significativamente sin tocar código de los módulos LLM.

La decisión original (structured outputs por provider) sigue siendo correcta — es la primera línea de defensa. El recordatorio en el prompt es la segunda línea, que la práctica mostró necesaria.

## Notas de implementación

- `packages/core/src/modules/llm/ollama-llm.ts` (PR 5):
  - Función `buildOutputSchema()` genera el JSON schema con `[...EMOTIONS]`.
  - `parseContent()` aplica el fallback a neutral si el JSON está malformado o la emoción está fuera del enum.
- `packages/core/src/modules/llm/anthropic-llm.ts` (PR 6):
  - Función `buildResponseToolSchema()` análoga.
  - `extractToolUse()` busca el tool_use block; si no lo encuentra, degrada al primer text block + neutral.
- Ambas implementaciones usan `isEmotion(value)` de `types/emotions.ts` para validar.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — `llm:responded` con emoción nace aquí.
- [ADR 0005](0005-typed-events-string-literals.md) — `EventMap` tipado define la forma del payload.
- [Ollama Structured Outputs](https://ollama.com/blog/structured-outputs) — referencia externa.
- [Anthropic Tool Use](https://docs.claude.com/en/docs/build-with-claude/tool-use) — referencia externa.
