# design-sync — notas para Shiro UI Kit

Proyecto que sincroniza a claude.ai/design (project "Shiro UI Kit",
`b2b9fce5-ad62-450e-91d4-e2cdf3fbc8a8`). Lee esto antes de re-sincronizar.

## Contexto: esto es una app, no una librería de componentes

`@proyecto-shiro/desktop` es una app (Vite + React, `private`), sin build de
librería ni `.d.ts` exportados ni Storybook. Para sincronizar se usa un **entry
sintético** (`.design-sync/ds-entry.tsx`) que re-exporta los presentacionales y
arrastra el CSS de temas/fuentes. La config la maneja entera, no la auto-detección.

- `shape: "package"`, `entry: ".design-sync/ds-entry.tsx"`.
- **PKG_DIR = raíz del repo** (el entry vive en `.design-sync/`). `srcDir`
  apunta a `packages/desktop/src` para que el enrichment (JSDoc → prompt.md,
  grupos por carpeta) funcione.
- **`--node-modules ./node_modules` (raíz del repo), NO el de desktop.** `react`
  y `@fontsource/*` están hoisted en la raíz; `packages/desktop/node_modules`
  está vacío de ellos. Si pasas el de desktop el bundle falla.
- Comando: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./.design-sync/ds-entry.tsx --out ./ds-bundle` (o `resync.mjs` con los mismos flags para el driver).

## Descubrimiento de componentes

- Sin `.d.ts` de librería → la lista de componentes la fija **`componentSrcMap`**
  (cada nombre → su `.tsx` real). Los 7 iconos comparten `Icons.tsx`.
- Los tipos de props los fija **`dtsPropsFor`** a mano (auto-extracción no aplica
  sin `.d.ts`). **Si cambian las props reales de un componente, actualiza
  `dtsPropsFor` o el `.d.ts` emitido se desincroniza en silencio.**

## Acoplamiento al tema

Las variables de color/fuente viven bajo `.theme-kawaii` / `.theme-cyber` /
`.theme-editorial`. Las previews envuelven en esa clase vía el helper
`previews/_stage.tsx` — **sin ella el Orb sale negro**. Eso genera un aviso
benigno `(stale preview: _stage — component no longer exported)`: `_stage` es un
helper compartido, no un componente. Ignóralo.

## Decisiones de alcance

- **`ToolApprovalModal` excluido a propósito**: depende del EventBus
  (`useBus`/`useBusEvent`) y renderiza `null` sin petición pendiente — no se puede
  previsualizar aislado. Si algún día se quiere, hay que mockear `useToolApproval`.
- **`guidelinesGlob: []`**: por defecto barría `docs/architecture.md` (arquitectura
  del sistema, no guía de UI). La guía de diseño real está en `conventions.md`.

## Conocidos

- `_ds_bundle.css` ≈ 2.4 MB: las 5 familias `@fontsource` se inlinean como
  data-URI (esbuild `.woff2 → dataurl`). Bajo el límite de 5 MB. Se sube en su
  propia llamada `write_files` por el límite de bytes.
- Render warns conocidos: **ninguno** (build limpio, 9/9 good).

## Re-sync risks (qué vigilar la próxima vez)

- **Flake de file-lock en Windows**: la PRIMERA corrida del build/driver tras un
  validate a veces falla con `build exit 1` (no puede `rmSync` `ds-bundle/`,
  handle retenido por chromium/AV). **Re-ejecuta y pasa.** No es un bug de config.
- **El entry sintético hardcodea la lista**: si se añade/quita/renombra un
  componente en la app, actualiza `ds-entry.tsx` + `componentSrcMap` + `dtsPropsFor`.
- **`dtsPropsFor` es manual**: deriva de la fuente pero no se valida contra ella.
- Estructura de temas asumida (`.theme-*` + nombres de tokens en `conventions.md`);
  si cambia el CSS de temas, revalida los nombres del header contra el build nuevo.
