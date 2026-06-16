/**
 * Tests de `isImmutable` (ADR 0023 §3) — la frontera dura de self-dev.
 * Es código de seguridad: cubre cada categoría protegida y, crucialmente,
 * que NO sobre-bloquee código/tests/docs legítimos.
 */

import { describe, expect, it } from 'vitest';
import {
  immutablePathError,
  isImmutable,
} from '../../../../../src/modules/tools/selfdev/immutable-paths.js';

describe('isImmutable — protege', () => {
  it('el carácter de Shiro', () => {
    expect(isImmutable('packages/core/src/character/characters/default.yaml')).toBe(true);
    expect(isImmutable('packages/core/src/character/index.ts')).toBe(true);
  });

  it('los ADRs (incluido el propio 0023)', () => {
    expect(isImmutable('docs/adr/0023-shiro-self-improvement-propose-only.md')).toBe(true);
    expect(isImmutable('docs/adr/README.md')).toBe(true);
  });

  it('la config de permisos', () => {
    expect(isImmutable('config/modules.config.yaml')).toBe(true);
    expect(isImmutable('config')).toBe(true);
  });

  it('safety/, CLAUDE.md, .gitignore y secrets', () => {
    expect(isImmutable('safety/system-prompt.md')).toBe(true);
    expect(isImmutable('CLAUDE.md')).toBe(true);
    expect(isImmutable('.gitignore')).toBe(true);
    expect(isImmutable('.env')).toBe(true);
    expect(isImmutable('.env.local')).toBe(true);
  });

  it('defensivo: character/ bajo cualquier paquete', () => {
    expect(isImmutable('packages/desktop/src/character/foo.ts')).toBe(true);
  });

  it('normaliza `\\`, `./` y `/` inicial', () => {
    expect(isImmutable('docs\\adr\\0001.md')).toBe(true);
    expect(isImmutable('./docs/adr/0001.md')).toBe(true);
    expect(isImmutable('/config/x.yaml')).toBe(true);
  });
});

describe('isImmutable — NO sobre-bloquea', () => {
  it('código, tests y docs técnicos', () => {
    expect(isImmutable('packages/core/src/modules/router/hybrid-router.ts')).toBe(false);
    expect(isImmutable('packages/desktop/tests/foo.test.ts')).toBe(false);
    expect(isImmutable('docs/architecture.md')).toBe(false);
    expect(isImmutable('README.md')).toBe(false);
  });

  it('no confunde prefijos parecidos', () => {
    expect(isImmutable('docs/adr-notes.md')).toBe(false); // no es docs/adr/
    expect(isImmutable('configuracion.ts')).toBe(false); // no es config/
    expect(isImmutable('packages/core/src/characters-util.ts')).toBe(false); // no es character/
  });
});

describe('immutablePathError', () => {
  it('menciona el path y el código', () => {
    const msg = immutablePathError('config/modules.config.yaml');
    expect(msg).toContain('config/modules.config.yaml');
    expect(msg).toContain('IMMUTABLE_PATH');
  });
});
