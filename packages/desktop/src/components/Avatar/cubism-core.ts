/**
 * Carga del Cubism Core SDK (`Live2DCubismCore.js`) en el browser.
 *
 * El Cubism Core es un script propietario de Live2D que `pixi-live2d-display`
 * espera ver en `window.Live2DCubismCore` antes de cargar cualquier
 * modelo `.moc3`. **No lo distribuimos** (fuera del repo, gitignored)
 * — cada dev lo baja manualmente desde
 * <https://www.live2d.com/sdk/download/web/> y lo copia a
 * `packages/desktop/public/live2d/Core/live2dcubismcore.js`.
 *
 * Si el script NO está disponible (dev recién clonando el repo, archivo
 * corrupto, 404), esta función falla **silenciosamente** devolviendo
 * `false` — el `<Avatar>` lo detecta y cae al `<Orb>` (ADR 0021 §3).
 *
 * La carga se hace una sola vez: si ya está en `window`, devuelve true
 * inmediatamente. Si dos componentes piden cargarlo a la vez,
 * comparten la misma `Promise` en vuelo (cache simple).
 */

interface Live2DCubismCoreGlobal {
  Version: { csmGetVersion: () => number };
}

declare global {
  interface Window {
    Live2DCubismCore?: Live2DCubismCoreGlobal;
  }
}

let cachedLoad: Promise<boolean> | null = null;

/**
 * Asegura que `window.Live2DCubismCore` está disponible. Devuelve `true`
 * si la carga tuvo éxito (o ya estaba), `false` si falló por cualquier
 * motivo (404, parse error, sin red). Nunca lanza.
 */
export function ensureCubismCore(scriptUrl: string): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Live2DCubismCore !== undefined) return Promise.resolve(true);
  if (cachedLoad !== null) return cachedLoad;

  cachedLoad = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-shiro-cubism-core="true"]`,
    );
    if (existing !== null) {
      // Otro mount ya inyectó la etiqueta — esperamos su onload.
      existing.addEventListener('load', () => {
        resolve(window.Live2DCubismCore !== undefined);
      });
      existing.addEventListener('error', () => {
        resolve(false);
      });
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.dataset.shiroCubismCore = 'true';
    script.addEventListener('load', () => {
      resolve(window.Live2DCubismCore !== undefined);
    });
    script.addEventListener('error', () => {
      // Mantenemos el <script> en el DOM para que un reintento posterior
      // detecte la falla en lugar de re-inyectarlo cada vez.
      resolve(false);
    });
    document.head.appendChild(script);
  });

  return cachedLoad;
}

/**
 * Reset interno — solo para tests. NO usar en código de producción.
 */
export function __resetCubismCoreCache(): void {
  cachedLoad = null;
}
