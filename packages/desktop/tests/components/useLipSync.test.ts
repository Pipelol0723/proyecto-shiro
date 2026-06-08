/**
 * Tests del lip-sync: la función pura `computeMouthOpen` y el wiring del
 * hook `useLipSync` (con `AudioContext` fake y `requestAnimationFrame`
 * stubbeado, ya que jsdom no tiene Web Audio ni rAF real).
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeMouthOpen, useLipSync } from '../../src/components/Avatar/useLipSync';

// ─── Fakes de Web Audio ──────────────────────────────────────────────

interface FakeContext {
  sources: number;
  level: number;
  createMediaElementSource: () => { connect: () => void };
  createAnalyser: () => {
    fftSize: number;
    frequencyBinCount: number;
    getByteFrequencyData: (a: Uint8Array) => void;
    connect: () => void;
  };
  destination: object;
  resume: () => Promise<void>;
}

function makeFakeContext(level = 200): FakeContext {
  const ctx: FakeContext = {
    sources: 0,
    level,
    createMediaElementSource: () => {
      ctx.sources++;
      return { connect: () => undefined };
    },
    createAnalyser: () => ({
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: (a: Uint8Array) => a.fill(ctx.level),
      connect: () => undefined,
    }),
    destination: {},
    resume: () => Promise.resolve(),
  };
  return ctx;
}

function asContextFactory(ctx: FakeContext): () => AudioContext {
  return () => ctx as unknown as AudioContext;
}

function fakeAudio(): HTMLAudioElement {
  return {} as unknown as HTMLAudioElement;
}

// requestAnimationFrame controlable a mano.
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

// ─── computeMouthOpen (pura) ─────────────────────────────────────────

describe('computeMouthOpen', () => {
  it('0 para array vacío', () => {
    expect(computeMouthOpen(new Uint8Array(0))).toBe(0);
  });

  it('0 en silencio', () => {
    expect(computeMouthOpen(new Uint8Array(128))).toBe(0);
  });

  it('llega a 1 con energía máxima y gain 1', () => {
    expect(computeMouthOpen(new Uint8Array(128).fill(255), 1)).toBeCloseTo(1, 5);
  });

  it('clampa a 1 con gain alto', () => {
    expect(computeMouthOpen(new Uint8Array(128).fill(255), 5)).toBe(1);
  });

  it('crece con el nivel de energía', () => {
    const quiet = computeMouthOpen(new Uint8Array(128).fill(40), 1);
    const loud = computeMouthOpen(new Uint8Array(128).fill(200), 1);
    expect(loud).toBeGreaterThan(quiet);
  });
});

// ─── useLipSync (wiring) ─────────────────────────────────────────────

describe('useLipSync', () => {
  it('crea el source y escribe mouthOpen > 0 mientras suena el audio', () => {
    const ctx = makeFakeContext(200);
    const values: number[] = [];
    renderHook(() =>
      useLipSync({
        audioElement: fakeAudio(),
        setMouthOpen: (v: number) => {
          values.push(v);
        },
        smoothing: 1,
        audioContextFactory: asContextFactory(ctx),
      }),
    );

    expect(ctx.sources).toBe(1);
    tick(3);
    expect(values.length).toBeGreaterThan(0);
    expect(values.at(-1)).toBeGreaterThan(0);
  });

  it('no recrea el MediaElementSource para el mismo elemento (StrictMode-safe)', () => {
    const ctx = makeFakeContext();
    const audio = fakeAudio();
    const noop = (): void => undefined;
    const { rerender } = renderHook(
      (props: Parameters<typeof useLipSync>[0]) => {
        useLipSync(props);
      },
      {
        initialProps: {
          audioElement: audio,
          setMouthOpen: noop,
          audioContextFactory: asContextFactory(ctx),
        },
      },
    );

    rerender({
      audioElement: audio,
      setMouthOpen: noop,
      audioContextFactory: asContextFactory(ctx),
    });

    expect(ctx.sources).toBe(1);
  });

  it('cierra la boca (0) al desmontar', () => {
    const ctx = makeFakeContext(200);
    const values: number[] = [];
    const { unmount } = renderHook(() =>
      useLipSync({
        audioElement: fakeAudio(),
        setMouthOpen: (v: number) => {
          values.push(v);
        },
        smoothing: 1,
        audioContextFactory: asContextFactory(ctx),
      }),
    );

    tick(2);
    unmount();
    expect(values.at(-1)).toBe(0);
  });

  it('audioElement null: cierra la boca y no crea source', () => {
    const ctx = makeFakeContext();
    const values: number[] = [];
    renderHook(() =>
      useLipSync({
        audioElement: null,
        setMouthOpen: (v: number) => {
          values.push(v);
        },
        audioContextFactory: asContextFactory(ctx),
      }),
    );

    expect(ctx.sources).toBe(0);
    expect(values).toContain(0);
  });

  it('enabled=false: no crea source y cierra la boca', () => {
    const ctx = makeFakeContext();
    const values: number[] = [];
    renderHook(() =>
      useLipSync({
        audioElement: fakeAudio(),
        setMouthOpen: (v: number) => {
          values.push(v);
        },
        enabled: false,
        audioContextFactory: asContextFactory(ctx),
      }),
    );

    expect(ctx.sources).toBe(0);
    expect(values).toContain(0);
  });
});
