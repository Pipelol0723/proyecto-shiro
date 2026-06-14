/**
 * FsScope — guardia de seguridad de las herramientas de filesystem
 * (ADR 0022 §3). Resuelve y **valida** que una ruta pedida cae dentro de
 * los directorios permitidos (`paths`), antes de que cualquier `fs:*`
 * toque el disco.
 *
 * Defensas:
 * - **Containment**: la ruta resuelta (absoluta, normalizada) debe estar
 *   dentro de un root permitido. `path.resolve` ya colapsa `..`, así que
 *   `../../etc/passwd` se normaliza y cae fuera → rechazado.
 * - **Anti-symlink**: además del check textual, se hace `realpath` (de la
 *   ruta si existe, o del directorio padre si es una creación) para que un
 *   symlink dentro del scope no apunte fuera de él.
 * - **Scope vacío = nada permitido**: sin `paths`, toda ruta se rechaza.
 *
 * Node-only (usa `node:fs`/`node:os`/`node:path`). Vive en
 * `@proyecto-shiro/core/node` (ADR 0011).
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve, sep, dirname, join } from 'node:path';
import { z } from 'zod';

// ─── Schema de config ─────────────────────────────────────────────────

export const FsScopeConfigSchema = z.object({
  /**
   * Directorios donde las tools FS pueden operar. Soportan `~` (home del
   * usuario). Vacío = ninguna ruta permitida (las tools fallan con error
   * claro). Ver `tools.config.fs.paths` en `modules.config.yaml`.
   */
  paths: z.array(z.string().min(1)).default([]),
  /**
   * Tope de bytes que `fs:read` devuelve. Evita cargar archivos enormes
   * en memoria / contexto del LLM. Default 256 KB.
   */
  max_read_bytes: z.number().int().positive().default(262_144),
});

export type FsScopeConfig = z.infer<typeof FsScopeConfigSchema>;

// ─── Resultado de resolución ──────────────────────────────────────────

export type ResolveResult = { ok: true; abs: string } | { ok: false; error: string };

/** Expande un `~` inicial al home del usuario. */
export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith(`~${sep}`) || p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

// ─── FsScope ──────────────────────────────────────────────────────────

export class FsScope {
  /** Roots permitidos, ya absolutos y normalizados. */
  readonly roots: readonly string[];
  readonly maxReadBytes: number;

  constructor(config: FsScopeConfig) {
    this.roots = config.paths.map((p) => resolve(expandTilde(p)));
    this.maxReadBytes = config.max_read_bytes;
  }

  /** True si `abs` (ya absoluto/normalizado) cae dentro de algún root. */
  private withinRoots(abs: string): boolean {
    return this.roots.some((root) => abs === root || abs.startsWith(root + sep));
  }

  /**
   * Resuelve `requested` a un absoluto y valida que cae dentro del scope.
   * `mustExist` (default true): cuando la ruta debe existir (read/list/
   * delete) se resuelve su `realpath` para cortar symlinks; cuando es una
   * creación (write) se valida contra el `realpath` del directorio padre.
   */
  async resolve(requested: string, mustExist = true): Promise<ResolveResult> {
    if (this.roots.length === 0) {
      return {
        ok: false,
        error: 'sin scope de filesystem configurado (tools.config.fs.paths vacío)',
      };
    }
    if (typeof requested !== 'string' || requested.length === 0) {
      return { ok: false, error: 'ruta vacía' };
    }

    const expanded = expandTilde(requested);
    // Rutas relativas se resuelven contra el primer root (no contra cwd).
    const abs = isAbsolute(expanded) ? resolve(expanded) : resolve(this.roots[0] ?? '', expanded);

    // 1) Check textual (`path.resolve` colapsa `..`).
    if (!this.withinRoots(abs)) {
      return { ok: false, error: `ruta fuera del scope permitido: ${abs}` };
    }

    // 2) Check anti-symlink: la ruta (si existe) o su ancestro existente
    //    más cercano debe resolver (realpath) dentro del scope.
    if (mustExist) {
      try {
        const real = await fs.realpath(abs);
        if (!this.withinRoots(real)) {
          return { ok: false, error: `la ruta resuelve (symlink) fuera del scope: ${real}` };
        }
        return { ok: true, abs: real };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        return {
          ok: false,
          error:
            code === 'ENOENT' ? `no existe: ${abs}` : `error resolviendo: ${String(code ?? err)}`,
        };
      }
    }

    // Creación (write): el archivo puede no existir. Subimos hasta el primer
    // ancestro que SÍ existe y verificamos su realpath; lo que no existe se
    // creará dentro de él con `mkdir` (que no sigue symlinks inexistentes),
    // así que ningún symlink intermedio puede sacarnos del scope.
    let probe = dirname(abs);
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (!this.withinRoots(real)) {
          return { ok: false, error: `un ancestro resuelve (symlink) fuera del scope: ${real}` };
        }
        return { ok: true, abs };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          return { ok: false, error: `error resolviendo: ${String(code ?? err)}` };
        }
        const parent = dirname(probe);
        if (parent === probe) {
          return { ok: false, error: `no se pudo validar el scope de: ${abs}` };
        }
        probe = parent;
      }
    }
  }
}
