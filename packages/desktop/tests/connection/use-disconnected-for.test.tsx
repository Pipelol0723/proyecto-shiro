/**
 * La gracia de `useDisconnectedFor` cuenta desde que la conexión deja de
 * estar 'open', no desde cada salto entre 'connecting' y 'closed'.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportState } from '@proyecto-shiro/core';
import { ConnectionProvider } from '../../src/connection/connection-context';
import { useDisconnectedFor } from '../../src/connection/use-disconnected-for';

function Probe(): JSX.Element {
  return <p>{useDisconnectedFor() ? 'aviso' : 'ok'}</p>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useDisconnectedFor', () => {
  it('los reintentos (connecting/closed alternando) no reinician la gracia', () => {
    vi.useFakeTimers();
    let state: TransportState = 'open';
    const handlers = new Set<(s: TransportState) => void>();
    const source = {
      getState: () => state,
      onStateChange: (h: (s: TransportState) => void) => {
        handlers.add(h);
        return () => {
          handlers.delete(h);
        };
      },
    };
    const set = (next: TransportState): void => {
      state = next;
      for (const h of [...handlers]) h(next);
    };
    render(
      <ConnectionProvider source={source}>
        <Probe />
      </ConnectionProvider>,
    );
    act(() => {
      set('closed');
    });
    const flips: TransportState[] = ['connecting', 'closed', 'connecting'];
    for (const next of flips) {
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => {
        set(next);
      });
    }
    // 900 ms desde que dejó 'open'; faltan 100 ms.
    expect(screen.getByText('ok')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText('aviso')).toBeDefined();
  });
});
