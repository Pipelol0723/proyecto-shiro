/**
 * Tests del UpdateBanner / useAppUpdater fuera de Tauri.
 *
 * En jsdom no existe `window.__TAURI_INTERNALS__`, así que el hook debe
 * quedar en fase `unsupported` y el banner no renderizar nada — sin
 * intentar importar los plugins nativos. Esto protege el contrato de que
 * el bundle web (modo `npm run dev`) es un no-op total del updater.
 *
 * El camino "dentro de Tauri" (check → available → install → relaunch) se
 * verifica a mano con el binario real (ADR 0024 §4) — no se puede ejercer
 * en jsdom sin el runtime nativo.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UpdateBanner } from '../../src/updater/UpdateBanner';

describe('UpdateBanner (fuera de Tauri)', () => {
  it('no renderiza nada cuando no hay runtime de Tauri', () => {
    // jsdom no define __TAURI_INTERNALS__ → fase unsupported.
    expect('__TAURI_INTERNALS__' in window).toBe(false);
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });
});
