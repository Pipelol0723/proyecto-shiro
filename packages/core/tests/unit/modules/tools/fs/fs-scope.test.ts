/**
 * Tests del `FsScope` — el guardia de seguridad de las tools FS
 * (ADR 0022 §3). Verifica containment, anti-`..`, anti-symlink y scope
 * vacío sobre directorios temporales reales.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FsScope,
  FsScopeConfigSchema,
  expandTilde,
} from '../../../../../src/modules/tools/fs/fs-scope.js';

function makeScope(roots: string[], maxReadBytes = 262_144): FsScope {
  return new FsScope(FsScopeConfigSchema.parse({ paths: roots, max_read_bytes: maxReadBytes }));
}

describe('expandTilde', () => {
  it('expande ~ al home del usuario', () => {
    expect(expandTilde('~')).toBe(homedir());
    expect(expandTilde(join('~', 'sub'))).toBe(join(homedir(), 'sub'));
  });

  it('deja rutas sin ~ intactas', () => {
    expect(expandTilde('/abs/path')).toBe('/abs/path');
    expect(expandTilde('relativo/x')).toBe('relativo/x');
  });
});

describe('FsScope.resolve', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-scope-')));
    outside = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-out-')));
    await fs.writeFile(join(root, 'file.txt'), 'hola', 'utf8');
    await fs.mkdir(join(root, 'sub'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('acepta una ruta dentro del scope', async () => {
    const r = await makeScope([root]).resolve(join(root, 'file.txt'));
    expect(r.ok).toBe(true);
  });

  it('rechaza traversal con ..', async () => {
    const r = await makeScope([root]).resolve(join(root, '..', 'file.txt'));
    expect(r.ok).toBe(false);
  });

  it('rechaza una ruta absoluta fuera del scope', async () => {
    const r = await makeScope([root]).resolve(join(outside, 'whatever.txt'));
    expect(r.ok).toBe(false);
  });

  it('scope vacío rechaza todo', async () => {
    const r = await makeScope([]).resolve(join(root, 'file.txt'));
    expect(r.ok).toBe(false);
  });

  it('para creación (mustExist=false) acepta un archivo inexistente en scope', async () => {
    const r = await makeScope([root]).resolve(join(root, 'sub', 'nuevo.txt'), false);
    expect(r.ok).toBe(true);
  });

  it('rechaza un symlink que apunta fuera del scope', async () => {
    const link = join(root, 'escape');
    try {
      await fs.symlink(outside, link, 'dir');
    } catch {
      return; // sin privilegios de symlink (Windows sin developer mode) → skip
    }
    const scope = makeScope([root]);
    // Lectura a través del symlink → realpath sale del scope.
    await fs.writeFile(join(outside, 'secret.txt'), 'x', 'utf8');
    const read = await scope.resolve(join(link, 'secret.txt'), true);
    expect(read.ok).toBe(false);
    // Creación a través del symlink → ancestro resuelve fuera del scope.
    const write = await scope.resolve(join(link, 'nuevo.txt'), false);
    expect(write.ok).toBe(false);
  });
});
