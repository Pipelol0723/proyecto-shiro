import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_ORIGINS, isOriginAllowed } from '../../../src/transports/origin-policy.js';

describe('isOriginAllowed', () => {
  it('acepta los orígenes del cliente empaquetado y de Vite', () => {
    expect([...DEFAULT_ALLOWED_ORIGINS]).toEqual([
      'http://tauri.localhost',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    for (const origin of DEFAULT_ALLOWED_ORIGINS) expect(isOriginAllowed(origin)).toBe(true);
  });

  it('acepta la ausencia de Origin (clientes que no son navegador, regla 2a)', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('rechaza cualquier otro Origin, con comparación exacta', () => {
    const rejected = [
      'https://evil.example',
      'null',
      '',
      'http://localhost:5173/',
      'http://localhost:5174',
      'https://localhost:5173',
      'http://tauri.localhost.evil.example',
      'http://evil.example/http://tauri.localhost',
      'HTTP://TAURI.LOCALHOST',
      'tauri://localhost',
    ];
    for (const origin of rejected) expect(isOriginAllowed(origin), origin).toBe(false);
  });
});
