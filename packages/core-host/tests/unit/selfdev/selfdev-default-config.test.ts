/**
 * La config real del repo (`config/modules.config.yaml`) debe traer self-dev
 * apagado (P-01): se reactiva a mano o en P-29, al pasar el gate de la Fase 3.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Logger } from '@proyecto-shiro/core';
import { ConfigLoader, parseSelfDevConfig } from '@proyecto-shiro/core/node';

describe('config/modules.config.yaml', () => {
  it('trae selfdev.enabled=false', () => {
    const path = fileURLToPath(
      new URL('../../../../../config/modules.config.yaml', import.meta.url),
    );
    const config = new ConfigLoader({ logger: new Logger('error') }).loadModulesConfig(path);
    expect(parseSelfDevConfig(config.selfdev).enabled).toBe(false);
  });
});
