/**
 * Contraste del texto sobre el color de acento (P-08, R-286).
 * Lee los CSS de los temas con `fs`, saca `--accent` y `--on-accent` y calcula
 * el contraste WCAG 2.x. Además, ninguna hoja de botones puede volver a poner
 * `color: white` sobre `background: var(--accent)`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = resolve(__dirname, '../../src');

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function token(css: string, name: string): string | null {
  const m = new RegExp(String.raw`${name}:\s*(#[0-9a-fA-F]{6})\s*;`).exec(css);
  return m ? m[1]! : null;
}

describe('contraste del acento', () => {
  it.each(['kawaii', 'cyber', 'editorial'])('--on-accent sobre --accent ≥ 4,5:1 en %s', (theme) => {
    const css = readFileSync(resolve(SRC, `themes/${theme}.css`), 'utf8');
    const accent = token(css, '--accent');
    const onAccent = token(css, '--on-accent');
    expect(accent).not.toBeNull();
    expect(onAccent, `${theme}.css no define --on-accent`).not.toBeNull();
    expect(contrast(accent!, onAccent!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    'components/ToolApproval/ToolApprovalModal.module.css',
    'screens/Setup/SetupScreen.module.css',
    'updater/UpdateBanner.module.css',
  ])('ninguna regla de %s usa color: white sobre --accent', (file) => {
    const css = readFileSync(resolve(SRC, file), 'utf8');
    const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? [];
    const accentBlocks = blocks.filter((b) => /background(-color)?:\s*var\(--accent\)/.test(b));
    expect(accentBlocks.length).toBeGreaterThan(0);
    const bad = accentBlocks.filter((b) => !/(^|[\s;{])color:\s*var\(--on-accent\)/.test(b));
    expect(bad).toEqual([]);
  });
});
