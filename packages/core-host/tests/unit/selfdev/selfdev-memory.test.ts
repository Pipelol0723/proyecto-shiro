/**
 * Tests de los constructores de turnos de memoria de self-dev (ADR 0023 Fase 2):
 * el turno `role:'tool'` (memoria interna) y el `role:'assistant'` (chat).
 */

import { describe, expect, it } from 'vitest';
import {
  buildSelfDevAnnounceTurn,
  buildSelfDevToolTurn,
} from '../../../src/selfdev/selfdev-memory.js';

describe('buildSelfDevToolTurn', () => {
  it('éxito → role tool, texto con el PR + resumen, metadata selfdev', () => {
    const e = buildSelfDevToolTurn(
      {
        topic: 'arreglar X',
        ok: true,
        prUrl: 'https://x/pull/9',
        branch: 'shiro/arreglar-x',
        summary: 'agregué un guard',
      },
      'me',
    );
    expect(e.role).toBe('tool');
    expect(e.userId).toBe('me');
    expect(e.text).toContain('https://x/pull/9');
    expect(e.text).toContain('agregué un guard');
    expect(e.metadata).toMatchObject({
      kind: 'selfdev',
      ok: true,
      topic: 'arreglar X',
      prUrl: 'https://x/pull/9',
    });
  });

  it('fallo → texto con el motivo, ok:false', () => {
    const e = buildSelfDevToolTurn({ topic: 'algo', ok: false, reason: 'eval rojo' }, 'me');
    expect(e.role).toBe('tool');
    expect(e.text).toContain('eval rojo');
    expect(e.metadata).toMatchObject({ kind: 'selfdev', ok: false });
  });
});

describe('buildSelfDevAnnounceTurn', () => {
  it('role assistant con el texto + emoción', () => {
    const e = buildSelfDevAnnounceTurn('Listo, abrí el PR', 'divertida', 'me');
    expect(e.role).toBe('assistant');
    expect(e.text).toBe('Listo, abrí el PR');
    expect(e.userId).toBe('me');
    expect(e.metadata).toMatchObject({ emotion: 'divertida', source: 'selfdev' });
  });
});
