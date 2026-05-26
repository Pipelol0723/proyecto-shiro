# Design mockup — referencia, NO implementación

Este directorio contiene el **bundle de exportación** del diseño que el
usuario creó con [Claude Design](https://claude.ai/design) el 2026-05-26.

**No editar. No tratar como código de producción.**

El mockup vive aquí únicamente como **referencia visual y de
comportamiento** para guiar la implementación real en
`packages/desktop/`. La implementación se decidió en:

- [ADR 0008](../adr/0008-cliente-desktop-vite-react.md) — stack
- [ADR 0009](../adr/0009-orbe-placeholder-avatar.md) — orbe placeholder
- [ADR 0010](../adr/0010-wiring-cliente-core-eventbus.md) — cómo el cliente consume el EventBus

## Estructura del bundle

```
design-mockup/
├── README.md                ← README original del bundle de Claude Design
├── chats/
│   └── chat1.md             ← Transcripción de la conversación
│                              que generó este diseño
└── project/
    ├── Shiro.html           ← Entry point HTML (Babel Standalone)
    ├── styles.css           ← 3 temas: kawaii / cyber / editorial
    ├── app.jsx              ← Root con reducer + sidebar + diag panel
    ├── orb.jsx              ← Orbe SVG metaball animado
    ├── icons.jsx            ← Iconos inline SVG
    ├── tweaks-panel.jsx     ← Panel de tweaks de diseño
    ├── screen-conversation.jsx
    ├── screen-config.jsx    ← (modules + character + avatar screens)
    └── screen-onboarding.jsx
```

## Por qué no se commiteó como código vivo

El bundle es un **prototipo de exploración**, no producción:

- Usa **Babel Standalone en el navegador** — viola la build pipeline.
- Carga **React y fuentes vía CDN** — no respeta nuestro bundling.
- Es **JSX sin tipos** — viola nuestra política TS strict.
- Tiene **datos sample hardcodeados** — pertenecen a tests, no al cliente.

El README del bundle lo dice explícitamente:

> *"recreate them pixel-perfectly en whatever technology makes sense
> para el target codebase. Match the visual output; don't copy the
> prototype's internal structure unless it happens to fit."*

## Cómo se usa este directorio

1. **Antes de implementar una pantalla en `packages/desktop/`**, abre
   el JSX correspondiente aquí y léelo entero. Entiende el
   comportamiento esperado.
2. **Para los temas CSS**, copia los valores de `styles.css` a la
   implementación real (mantenemos los 3 temas como swap-eables — ver
   ADR 0008).
3. **Para el orbe**, el SVG de `orb.jsx` es la referencia visual; ver
   ADR 0009 para el plan de migración a Live2D en Fase 6.
4. **No abras `Shiro.html` en el navegador** salvo que necesites ver
   visualmente algo concreto. Las dimensiones, colores y estructura
   están todas escritas en los archivos fuente.

## Exclusiones de tooling

Este directorio está excluido de:

- **Prettier** (`.prettierignore`) — el JSX inline no respeta
  nuestras reglas y reformatearlo lo rompe.
- **ESLint** (config `ignores`) — no tiene tipos ni respeta TS strict.

Esto previene que el bundle se mezcle con el código real del proyecto.
