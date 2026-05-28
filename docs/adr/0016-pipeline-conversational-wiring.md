# ADR 0016: Wiring del pipeline conversacional — función en `core-host`

- **Status**: Accepted
- **Fecha**: 2026-05-28
- **Decidido por**: Pipelol0723

## Contexto

Hasta PR 6 los módulos LLM/Router/STT/TTS/Memory existen pero **nadie los invoca**. El bootstrap los instancia con `Orchestrator.init()` y los deja ahí; el flujo conversacional real (cliente emite `user:message` → algo decide tier → algo llama al LLM → algo emite `llm:responded` con la respuesta) **no está cableado**.

Hasta PR 6, el `wireMockConversationFlow` simulaba ese flujo con respuestas canned:

```typescript
// PR 3 — core-host/src/mocks/mock-conversation-flow.ts
bus.on('user:message', async (payload) => {
  await bus.emit('router:routed', { tier: 'local', ... });
  await bus.emit('llm:responded', { text: 'respuesta canned', ... });
  await bus.emit('tts:audio-ended', ...);
});
```

PR 7 reemplaza eso por el wiring real. La pregunta: **dónde vive ese wiring**.

## Decisión

**Función en `packages/core-host/`: `wireConversationFlow({ bus, modules, systemPrompt })`.** Misma forma que el mock que reemplaza.

```typescript
// packages/core-host/src/pipeline/conversation-flow.ts
export function wireConversationFlow(options: {
  bus: IEventBus<EventMap>;
  modules: LoadedModules;
  systemPrompt: string;
  logger: Logger;
}): () => void {
  return bus.on('user:message', async (payload) => {
    const startTime = Date.now();
    try {
      // 1. Router decide tier
      const tier = await modules.router.route({
        text: payload.text,
        userId: payload.userId,
      });
      await bus.emit('router:routed', { tier, userId: payload.userId });

      // 2. LLM correspondiente responde
      const llm = tier === 'local' ? modules.llmLocal : modules.llmCloud;
      const response = await llm.generate({
        text: payload.text,
        systemPrompt,
        userId: payload.userId,
      });

      // 3. Emite la respuesta tipada
      await bus.emit('llm:responded', {
        text: response.text,
        emotion: response.emotion,
        userId: payload.userId,
        tier,
        latencyMs: Date.now() - startTime,
      });

      // 4. (Transitional) Simula fin de TTS para que la UI no quede colgada
      //    en estado "hablando". Se elimina cuando llegue el TTS real.
      await emitSimulatedTTSEnd(bus, response.text, payload.userId);
    } catch (err) {
      // Fallback: respuesta de error visible al usuario
      await emitFallbackResponse(bus, payload, err, startTime);
    }
  });
}
```

### Por qué `core-host`, no `Orchestrator`

El `Orchestrator` vive en `packages/core/` y es deliberadamente agnóstico al uso. Carga módulos, emite `bus:ready`, expone `getModules()`. **No sabe qué es una "conversación"** — solo gestiona ciclos de vida.

El pipeline es una decisión específica del companion ("user:message → router → LLM → llm:responded"). Otro consumidor del Orchestrator (un robot autónomo, un sistema headless de batch) tendría su propio pipeline. Forzar a Orchestrator a conocer este flujo lo acopla a chat semantics.

Manteniendo el wiring fuera del Orchestrator:

- Cada modo de uso (chat vs batch vs robot) declara su propio `wireXxxFlow()`.
- El `Orchestrator` sigue puro: cargar módulos + ciclo de vida.
- Patrón ya establecido por `wireMockConversationFlow` (PR 3).

### Por qué función, no clase

La función:

- Cierra sobre `bus`, `modules`, `systemPrompt` con closure — todo lo que necesita.
- Devuelve un `unsubscribe` para limpieza.
- Es testeable con un mock del bus y mocks de los módulos.

Una clase añadiría boilerplate (constructor, propiedades, métodos) sin ganancia para una pieza con un solo punto de entrada.

### El campo `tts:audio-ended` transicional

La UI cliente transitions `hablando → silencio` al recibir `tts:audio-ended`. Hasta que el hito TTS exista, **el pipeline emite ese evento simulando duración** (proporcional al largo del texto), igual que hacía el mock:

```typescript
const speakMs = Math.max(2200, text.length * 45);
setTimeout(() => bus.emit('tts:audio-ended', { userId }), speakMs);
```

Cuando llegue el TTS real:

- El TTS módulo recibirá `llm:responded` (o lo invocará el pipeline).
- El TTS emitirá `tts:audio-ended` cuando termine la reproducción real.
- Esta línea del pipeline desaparece.

Documentado con `// transitional` en el código para que sea obvio cuando borrarlo.

### Manejo de errores

Si cualquier paso (router, LLM) falla, el pipeline:

1. Loguea el error.
2. Emite `llm:responded` con un texto fallback y emoción neutral (la UI no queda colgada).
3. Emite `tts:audio-ended` para cerrar el ciclo visual.

El error específico (timeout de Ollama, 401 de Anthropic, etc.) va al log. El usuario solo ve "Algo salió mal procesando tu mensaje".

## Alternativas consideradas

- **Método en `Orchestrator`** (`orchestrator.wireConversationFlow(systemPrompt)`): descartada. Acopla el Orchestrator a chat semantics. Si llega un modo de uso sin conversación (batch processing, robot), el método estorba.
- **Clase `ConversationPipeline`** con métodos: descartada. Boilerplate sin ganancia para un punto de entrada único. Si el pipeline crece (memoria, multi-turn state), reconsiderar — convertir a clase es trivial.
- **Subscribirse desde cada módulo** (cada LLM se autosuscribe a `user:message`): descartada. Crea una telaraña descentralizada — cualquier módulo nuevo puede empezar a escuchar eventos y romper el flujo. Centralizar el wiring en un solo sitio mantiene el flujo legible.
- **Emitir solo `llm:responded`** (no simular `tts:audio-ended`): descartada para V1. La UI se quedaría en estado "hablando" eternamente porque no hay TTS real todavía. Mejor simular cierre.
- **Emitir `llm:chunk` durante streaming**: descartada. Ni `OllamaLLM` (PR 5) ni `AnthropicLLM` (PR 6) implementaron `generateStream` por la decisión del ADR 0014 (structured JSON no se streamea bien). Cuando llegue TTS y se decida el approach de streaming, este pipeline lo absorbe.

## Consecuencias

### Positivas

- **Cliente desktop muestra respuestas reales de Shiro**. Después de mergear, escribir un mensaje en la UI produce el flujo: router → OllamaLLM/AnthropicLLM real → respuesta con emoción. Cierra el hito LLM.
- **Reutilizable**: futuros clientes (móvil, Arduino) heredan el pipeline porque el wiring vive server-side. No cada cliente tiene que reescribirlo.
- **El Orchestrator queda limpio** para otros modos de uso.
- **Mismo patrón que el mock** que reemplaza — diff mental mínimo.

### Negativas / Riesgos

- **Latencia perceptible**: router (300-2000ms) + LLM (500ms-30s según modelo) + delay simulado de TTS. Asumible para chat; cuando llegue TTS real, la duración será exactamente la del audio.
- **Si el LLM se cuelga**, el catch del pipeline emite un fallback genérico pero el log capturará el error. Sin retry — el usuario reintenta manualmente.
- **El `tts:audio-ended` simulado es deuda explícita**. Riesgo: olvidar quitarlo cuando llegue TTS. Mitigación: comentario `// transitional` en el código, mención en este ADR.

### Neutrales

- **El mock (`mock-conversation-flow.ts`) se elimina**: era PR 3, ya cumplió su propósito.
- **`character.systemPrompt`** ya estaba pre-construido en el `BootstrapResult` (PR 4). El pipeline lo consume tal cual.

## Notas de implementación

- `packages/core-host/src/pipeline/conversation-flow.ts` — la función.
- `packages/core-host/src/bootstrap.ts`:
  - Sustituye `wireMockConversationFlow(...)` por `wireConversationFlow(...)`.
  - Pasa `modules` (de `orchestrator.getModules()`) y `systemPrompt`.
- `packages/core-host/src/mocks/mock-conversation-flow.ts` — **eliminado**.
- `packages/core-host/tests/integration/conversation-flow.test.ts` (nuevo):
  - Mock de router y LLMs.
  - Emite `user:message`, verifica orden de eventos: `router:routed` → `llm:responded` → `tts:audio-ended`.
  - Verifica routing: si router devuelve 'cloud', se llama a `llmCloud.generate`.
  - Verifica fallback: si LLM lanza, se emite respuesta de error visible.
- El integration test del bootstrap (`bootstrap.test.ts`) ajusta su expectativa — el text ya no es canned, viene del LLM mockeado.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — modular event-driven, base del flujo.
- [ADR 0012](0012-split-cliente-server-core-host.md) — el pipeline vive server-side por esto.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — formato del `llm:responded`.
- [ADR 0015](0015-hybrid-router-classifier-llm-based.md) — el router que invoca este pipeline.
- Mock que reemplaza: `wireMockConversationFlow` (PR 3, ahora eliminado).
