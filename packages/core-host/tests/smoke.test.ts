import { describe, expect, it } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import { VERSION } from '../src/index.js';

describe('core-host skeleton', () => {
  it('exporta VERSION', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('puede importar primitivas del core', () => {
    expect(typeof EventBus).toBe('function');
    expect(typeof Logger).toBe('function');
  });

  it('instancia un EventBus básico (sanity-check del entorno)', () => {
    const logger = new Logger('error', { module: 'test' });
    const bus = new EventBus({ logger });
    expect(bus).toBeDefined();
  });
});
