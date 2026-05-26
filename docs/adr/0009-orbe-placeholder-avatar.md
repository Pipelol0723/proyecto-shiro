# ADR 0009: Orbe SVG como placeholder visual del avatar

- **Status**: Accepted
- **Fecha**: 2026-05-26
- **Decidido por**: Pipelol0723

## Contexto

El plan original puso la implementación del avatar Live2D en
**Fase 6** (semanas 15-18). Hasta entonces, no hay nada visual que el
usuario pueda ver "moviéndose" cuando Shiro habla, escucha o cambia
emoción.

[ADR 0008](0008-cliente-desktop-vite-react.md) decidió arrancar el
cliente desktop **antes** de Fase 6 para que cada módulo (Ollama,
ElevenLabs, etc.) tenga validación visual desde su entrega. Eso
significa que el cliente desktop necesita **algo** en el sitio del
avatar — pero no Live2D todavía.

El mockup ([`docs/design-mockup/project/orb.jsx`](../design-mockup/project/orb.jsx))
propone un **orbe SVG animado** como solución: un metaball que pulsa,
cambia color según emoción, y reacciona al estado (listening, speaking,
thinking) con animaciones CSS y SVG filters.

Hay que decidir si adoptamos ese orbe formalmente como el placeholder
oficial y cómo se planea su sustitución por Live2D.

## Decisión

**Adoptar el orbe SVG del mockup como placeholder visual del avatar
hasta Fase 6**. Implementación en `packages/desktop/src/components/Orb/`.

Características:

- **SVG metaball** con filtro Gaussian blur (`feGaussianBlur` +
  `feColorMatrix`) — el look "líquido orgánico" del mockup.
- **Reactivo al estado del companion** vía props:
  - `emotion`: cambia el gradiente de color (4 emociones por ahora —
    neutral, alegre, pensativa, sorprendida).
  - `speaking`: amplitud pulsante simulada (cuando llegue audio real,
    se cablea al RMS del buffer del TTS).
  - `listening`: anillos rotan más rápido + halo más intenso.
  - `thinking`: partículas orbitando + rings más sutiles.
- **Idle breathing**: animación CSS de brillo (`orb-breath`) de 5s en
  loop cuando no está activo.
- **Colores de emoción definidos por CSS vars** (no hardcoded) — los
  tres temas del cliente (kawaii / cyber / editorial) pueden
  re-mapearlos sin tocar el componente.

### Plan de migración a Live2D (Fase 6)

Cuando el módulo `Live2DAvatar` esté listo:

1. El componente `<Orb>` queda como **fallback** (sigue en el código).
2. Un nuevo componente `<Avatar>` recibe las mismas props que el orb:
   `emotion`, `speaking`, `listening`, `thinking`.
3. `<Avatar>` decide internamente si renderizar Live2D (si hay modelo
   cargado) u Orb (si no hay). El consumidor no cambia.
4. El layout del cliente (header, sidebar, screens) **no se toca** —
   la migración es local al componente del avatar.

Eso asegura que el cliente sigue funcionando incluso si Live2D falla
al cargar o si el usuario quita el modelo activo.

## Alternativas consideradas

- **Imagen estática (PNG)**: descartado. Cero reactividad al estado.
- **Spinner CSS estándar**: descartado. Funciona pero no transmite
  personalidad — sería un asistente más, no Shiro.
- **3D con Three.js desde el inicio**: descartado. Mucho más complejo
  para algo provisional. Three.js sí se usará en Fase 10 (VRM 3D
  futuro), pero como upgrade post-MVP.
- **Empezar directamente con Live2D**: descartado. Live2D necesita:
  1. Cubism SDK Web descargado manualmente (licencia propietaria).
  2. Un modelo `.moc3` adquirido o construido (no trivial).
  3. Tooling de animaciones y morph targets.
     Para Fases 1-5 no aporta nada que justifique ese coste.
- **Webcam del usuario** (idea outlandish): descartado, no encaja con
  el concepto.

## Consecuencias

### Positivas

- **Algo bonito que mostrar desde el primer PR del cliente**. El orbe
  por sí solo ya hace que la app "se sienta viva".
- **Reusa 100% del trabajo del mockup**. El SVG, las animaciones, los
  colores — todo está ya diseñado y validado visualmente.
- **Es portable**: el mismo componente puede vivir en mobile (Fase 9)
  o web sin reescribirse.
- **El día que llegue Live2D, no hay drama de transición**: solo se
  hace swap del componente interno.

### Negativas / Riesgos

- **El orbe no es tan expresivo como un avatar humanoide**. Para una
  emoción sutil (e.g. "pensativa con cariño") no hay forma de
  comunicarla solo con color y forma. Aceptado: las emociones se
  pueden ver también en los subtítulos y el chat.
- **Riesgo de cariño**: si el orbe queda muy bonito, el usuario puede
  acabar prefiriéndolo a Live2D y nunca migrar. **Eso no es un riesgo
  real, es una victoria** — el orb es válido como avatar definitivo
  para ciertos casos (modo minimal / overlay flotante).

### Neutrales

- El orb se exporta como **componente independiente y reutilizable**.
  Si alguien quiere usarlo fuera del companion (e.g. una librería de
  UI), no tiene dependencias del core.

## Notas de implementación

- Ubicación: `packages/desktop/src/components/Orb/`.
  - `Orb.tsx` — componente React.
  - `Orb.module.css` — estilos scoped (CSS Modules).
  - `useOrbAmplitude.ts` — custom hook con la lógica de RAF para la
    amplitud animada (más limpio que tenerlo dentro del componente).
- Props (TypeScript estricto):
  ```ts
  interface OrbProps {
    emotion?: Emotion; // del core, ver packages/core
    speaking?: boolean;
    listening?: boolean;
    thinking?: boolean;
    size?: number; // default 280
  }
  ```
- Las 4 emociones de Fase 1A (`Emotion` en `@proyecto-shiro/core`) son
  las únicas que el orbe sabe pintar de forma distinta. Si llega otra
  emoción del LLM ('triste', 'enojada' — ya están en el tipo), cae a
  'neutral' visual hasta que se asigne color (commit pequeño).
- **No suscribir el componente al EventBus directamente**. Recibe todo
  por props. El `<ConversationScreen>` (que vive arriba) hace de
  conector entre el EventBus y los componentes visuales — patrón
  estándar de "smart container, dumb component" en React.

## Referencias

- [ADR 0008](0008-cliente-desktop-vite-react.md) — stack del cliente.
- [ADR 0010](0010-wiring-cliente-core-eventbus.md) — cómo se cablea el
  estado que alimenta al orbe.
- [`docs/design-mockup/project/orb.jsx`](../design-mockup/project/orb.jsx) —
  implementación del prototipo que se replica fielmente.
- Plan original, Fase 6 — donde llegará el módulo `Live2DAvatar`.
