import { describe, expect, it } from 'vitest';
import { DEFAULT_BIND_HOST, resolveBindHost } from '../../../src/transports/bind-host.js';

describe('resolveBindHost', () => {
  it('usa 127.0.0.1 por defecto', () => {
    expect(DEFAULT_BIND_HOST).toBe('127.0.0.1');
    expect(resolveBindHost({})).toEqual({ host: '127.0.0.1', isLoopback: true });
  });

  it('respeta SHIRO_BIND_HOST', () => {
    expect(resolveBindHost({ SHIRO_BIND_HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
    expect(resolveBindHost({ SHIRO_BIND_HOST: ' 192.168.1.20 ' }).host).toBe('192.168.1.20');
  });

  it('una cadena vacía o en blanco usa el default', () => {
    expect(resolveBindHost({ SHIRO_BIND_HOST: '' }).host).toBe('127.0.0.1');
    expect(resolveBindHost({ SHIRO_BIND_HOST: '   ' }).host).toBe('127.0.0.1');
  });

  it('marca 0.0.0.0, :: y una IP de LAN como no-loopback', () => {
    for (const host of [
      '0.0.0.0',
      '::',
      '192.168.1.20',
      '10.0.0.5',
      '1270.0.0.1',
      '127.0.0.1.evil',
    ]) {
      expect(resolveBindHost({ SHIRO_BIND_HOST: host }).isLoopback, host).toBe(false);
    }
  });

  it('marca 127.0.0.0/8, ::1 y localhost como loopback', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', '::1', 'localhost', 'LOCALHOST']) {
      expect(resolveBindHost({ SHIRO_BIND_HOST: host }).isLoopback, host).toBe(true);
    }
  });
});
