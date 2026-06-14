/**
 * Tests de las tools FS (`fs:read/list/write/delete`, ADR 0022 §3) sobre
 * un directorio temporal real. Verifica el camino feliz, el respeto del
 * scope, el tope de tamaño, y los tiers de permiso.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../../../../../src/core/logger.js';
import type { ToolContext } from '../../../../../src/interfaces/IToolModule.js';
import { FsScope, FsScopeConfigSchema } from '../../../../../src/modules/tools/fs/fs-scope.js';
import {
  FsDeleteTool,
  FsListTool,
  FsReadTool,
  FsWriteTool,
} from '../../../../../src/modules/tools/fs/fs-tools.js';

function ctx(): ToolContext {
  return { logger: new Logger('error', { module: 'test' }), userId: 'me' };
}

describe('FS tools', () => {
  let root: string;
  let scope: FsScope;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-fstools-')));
    scope = new FsScope(FsScopeConfigSchema.parse({ paths: [root], max_read_bytes: 1024 }));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('fs:read', () => {
    it('lee un archivo del scope', async () => {
      await fs.writeFile(join(root, 'a.txt'), 'contenido', 'utf8');
      const res = await new FsReadTool(scope).execute({ path: join(root, 'a.txt') }, ctx());
      expect(res.ok).toBe(true);
      expect(res.output).toBe('contenido');
    });

    it('falla fuera del scope', async () => {
      const res = await new FsReadTool(scope).execute({ path: join(tmpdir(), 'nope.txt') }, ctx());
      expect(res.ok).toBe(false);
    });

    it('falla si el archivo excede max_read_bytes', async () => {
      await fs.writeFile(join(root, 'big.txt'), 'x'.repeat(2048), 'utf8');
      const res = await new FsReadTool(scope).execute({ path: join(root, 'big.txt') }, ctx());
      expect(res.ok).toBe(false);
      expect(res.error).toContain('grande');
    });

    it('rechaza args inválidos', async () => {
      const res = await new FsReadTool(scope).execute({}, ctx());
      expect(res.ok).toBe(false);
      expect(res.error).toContain('args');
    });

    it('es tier auto', () => {
      expect(new FsReadTool(scope).permissionTier).toBe('auto');
    });
  });

  describe('fs:list', () => {
    it('lista un directorio', async () => {
      await fs.writeFile(join(root, 'f1.txt'), '', 'utf8');
      await fs.mkdir(join(root, 'd1'));
      const res = await new FsListTool(scope).execute({ path: root }, ctx());
      expect(res.ok).toBe(true);
      expect(res.output).toContain('f1.txt');
      expect(res.output).toContain('d1');
    });

    it('falla si la ruta no es un directorio', async () => {
      await fs.writeFile(join(root, 'a.txt'), '', 'utf8');
      const res = await new FsListTool(scope).execute({ path: join(root, 'a.txt') }, ctx());
      expect(res.ok).toBe(false);
    });
  });

  describe('fs:write', () => {
    it('crea un archivo (y sus dirs) dentro del scope', async () => {
      const p = join(root, 'sub', 'nuevo.txt');
      const res = await new FsWriteTool(scope).execute({ path: p, content: 'hey' }, ctx());
      expect(res.ok).toBe(true);
      expect(await fs.readFile(p, 'utf8')).toBe('hey');
    });

    it('falla fuera del scope', async () => {
      const res = await new FsWriteTool(scope).execute(
        { path: join(tmpdir(), 'x.txt'), content: 'a' },
        ctx(),
      );
      expect(res.ok).toBe(false);
    });

    it('es tier confirm', () => {
      expect(new FsWriteTool(scope).permissionTier).toBe('confirm');
    });
  });

  describe('fs:delete', () => {
    it('borra un archivo del scope', async () => {
      const p = join(root, 'borrar.txt');
      await fs.writeFile(p, '', 'utf8');
      const res = await new FsDeleteTool(scope).execute({ path: p }, ctx());
      expect(res.ok).toBe(true);
      await expect(fs.stat(p)).rejects.toBeTruthy();
    });

    it('rechaza borrar un directorio', async () => {
      const d = join(root, 'undir');
      await fs.mkdir(d);
      const res = await new FsDeleteTool(scope).execute({ path: d }, ctx());
      expect(res.ok).toBe(false);
      expect(res.error).toContain('directorio');
    });

    it('es tier confirm', () => {
      expect(new FsDeleteTool(scope).permissionTier).toBe('confirm');
    });
  });
});
