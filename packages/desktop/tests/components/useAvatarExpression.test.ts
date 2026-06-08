/**
 * Tests de las expresiones por emoción: la función pura `resolveFaceParams`
 * y el wiring del hook `useAvatarExpression` (con `requestAnimationFrame`
 * stubbeado, ya que jsdom no tiene rAF real).
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Emotion } from '@proyecto-shiro/core';
import { FACE_PARAM_IDS, resolveFaceParams } from '../../src/components/Avatar/expression-map';
import { useAvatarExpression } from '../../src/components/Avatar/useAvatarExpression';

// rAF controlable a mano.
let rafCb: FrameRequestCallback | null = null;

beforeEach(() => {
  rafCb = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function tick(n: number): void {
  act(() => {
    for (let i = 0; i < n; i++) rafCb?.(0);
  });
}

// ─── resolveFaceParams (pura) ────────────────────────────────────────

describe('resolveFaceParams', () => {
  it('neutral deja todos los parámetros en 0', () => {
    const p = resolveFaceParams('neutral');
    for (const id of FACE_PARAM_IDS) expect(p[id]).toBe(0);
  });

  it('divertida sonríe (MouthForm 1, EyeSmile > 0)', () => {
    const p = resolveFaceParams('divertida');
    expect(p.ParamMouthForm).toBe(1);
    expect(p.ParamEyeLSmile).toBeGreaterThan(0);
    expect(p.ParamEyeRSmile).toBeGreaterThan(0);
  });

  it('molesta frunce el ceño (MouthForm y cejas negativos)', () => {
    const p = resolveFaceParams('molesta');
    expect(p.ParamMouthForm).toBeLessThan(0);
    expect(p.ParamBrowLY).toBeLessThan(0);
    expect(p.ParamBrowRY).toBeLessThan(0);
  });

  it('siempre devuelve TODOS los FACE_PARAM_IDS', () => {
    const p = resolveFaceParams('vulnerable');
    for (const id of FACE_PARAM_IDS) expect(p[id]).toBeTypeOf('number');
  });
});

// ─── useAvatarExpression (wiring) ────────────────────────────────────

describe('useAvatarExpression', () => {
  it('interpola los parámetros hacia la emoción actual', () => {
    const values: Record<string, number> = {};
    renderHook(() =>
      useAvatarExpression({
        emotion: 'divertida',
        setParam: (id: string, v: number) => {
          values[id] = v;
        },
        smoothing: 1, // instantáneo para el test
      }),
    );

    tick(2);
    expect(values.ParamMouthForm).toBe(1); // objetivo de divertida
  });

  it('al cambiar de emoción re-apunta el objetivo', () => {
    const values: Record<string, number> = {};
    const setParam = (id: string, v: number): void => {
      values[id] = v;
    };
    const { rerender } = renderHook(
      (props: Parameters<typeof useAvatarExpression>[0]) => {
        useAvatarExpression(props);
      },
      { initialProps: { emotion: 'neutral' as Emotion, setParam, smoothing: 1 } },
    );

    tick(1);
    expect(values.ParamMouthForm).toBe(0); // neutral

    rerender({ emotion: 'molesta', setParam, smoothing: 1 });
    tick(1);
    expect(values.ParamMouthForm).toBeLessThan(0); // molesta frunce
  });

  it('enabled=false no escribe parámetros', () => {
    const calls: string[] = [];
    renderHook(() =>
      useAvatarExpression({
        emotion: 'divertida',
        setParam: (id: string) => {
          calls.push(id);
        },
        enabled: false,
      }),
    );

    tick(2);
    expect(calls).toHaveLength(0);
  });

  it('setParam null no crashea', () => {
    expect(() => {
      renderHook(() => useAvatarExpression({ emotion: 'divertida', setParam: null }));
      tick(2);
    }).not.toThrow();
  });
});
