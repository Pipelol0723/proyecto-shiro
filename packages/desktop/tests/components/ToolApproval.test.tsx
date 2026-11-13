/**
 * Tests del flujo de aprobación de tools agénticas en el cliente:
 * `useToolApproval` (hook) y `ToolApprovalModal` (UI).
 *
 * Estrategia: `EventBus` real + `BusProvider` (como `bus-context.test.tsx`).
 * Simulamos el `tool:requires-approval` que manda el core-host y verificamos
 * que el cliente responde con `tool:approval`.
 */

import { render, renderHook, act, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { EventBus, InProcessTransport, Logger, type EventMap } from '@proyecto-shiro/core';
import { BusProvider } from '../../src/bus-context';
import { ToolApprovalModal, useToolApproval } from '../../src/components/ToolApproval';

function makeBus(): EventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error'),
    transports: [new InProcessTransport()],
  });
}

function wrapper(bus: EventBus<EventMap>) {
  return ({ children }: { children: ReactNode }) => <BusProvider bus={bus}>{children}</BusProvider>;
}

const REQ: EventMap['tool:requires-approval'] = {
  requestId: 'r1',
  toolId: 'fs:write',
  toolName: 'fs_write',
  argsPreview: '{"path":"notas.txt"}',
  userId: 'me',
};

describe('useToolApproval', () => {
  it('expone la petición pendiente al recibir tool:requires-approval', async () => {
    const bus = makeBus();
    const { result } = renderHook(() => useToolApproval(), { wrapper: wrapper(bus) });
    expect(result.current.pending).toBeNull();

    await act(async () => {
      await bus.emit('tool:requires-approval', REQ);
    });

    expect(result.current.pending).toMatchObject({ requestId: 'r1', toolId: 'fs:write' });
  });

  it('respond(true) emite tool:approval y limpia la pendiente', async () => {
    const bus = makeBus();
    const approvals: EventMap['tool:approval'][] = [];
    bus.on('tool:approval', (p) => {
      approvals.push(p);
    });
    const { result } = renderHook(() => useToolApproval(), { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('tool:requires-approval', REQ);
    });
    act(() => {
      result.current.respond(true);
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ requestId: 'r1', approved: true, userId: 'me' });
    expect(result.current.pending).toBeNull();
  });
});

describe('ToolApprovalModal', () => {
  it('no renderiza nada sin petición pendiente', () => {
    const bus = makeBus();
    const { container } = render(<ToolApprovalModal />, { wrapper: wrapper(bus) });
    expect(container.firstChild).toBeNull();
  });

  it('muestra el toolId y el argsPreview al recibir la petición', async () => {
    const bus = makeBus();
    render(<ToolApprovalModal />, { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('tool:requires-approval', REQ);
    });

    expect(screen.getByText('fs:write')).toBeDefined();
    expect(screen.getByText(/notas\.txt/)).toBeDefined();
  });

  it('“Permitir una vez” emite tool:approval con approved=true y cierra', async () => {
    const bus = makeBus();
    const approvals: EventMap['tool:approval'][] = [];
    bus.on('tool:approval', (p) => {
      approvals.push(p);
    });
    const { container } = render(<ToolApprovalModal />, { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('tool:requires-approval', REQ);
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Permitir una vez' }));
    });

    expect(approvals[0]).toMatchObject({ requestId: 'r1', approved: true });
    expect(container.firstChild).toBeNull();
  });

  it('“Cancelar” emite tool:approval con approved=false y cierra', async () => {
    const bus = makeBus();
    const approvals: EventMap['tool:approval'][] = [];
    bus.on('tool:approval', (p) => {
      approvals.push(p);
    });
    const { container } = render(<ToolApprovalModal />, { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('tool:requires-approval', REQ);
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    });

    expect(approvals[0]).toMatchObject({ requestId: 'r1', approved: false });
    expect(container.firstChild).toBeNull();
  });
});

describe('ToolApprovalModal — seguro por defecto (R-030)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openModal(bus: EventBus<EventMap>): Promise<EventMap['tool:approval'][]> {
    const approvals: EventMap['tool:approval'][] = [];
    bus.on('tool:approval', (p) => {
      approvals.push(p);
    });
    render(<ToolApprovalModal />, { wrapper: wrapper(bus) });
    await act(async () => {
      await bus.emit('tool:requires-approval', REQ);
    });
    return approvals;
  }

  it('el foco inicial está en Cancelar', async () => {
    await openModal(makeBus());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
  });

  it('Space al abrir no emite approved:true', async () => {
    const user = userEvent.setup();
    const approvals = await openModal(makeBus());
    await user.keyboard(' ');
    expect(approvals.filter((a) => a.approved)).toHaveLength(0);
  });

  it('Enter al abrir no emite approved:true', async () => {
    const user = userEvent.setup();
    const approvals = await openModal(makeBus());
    await user.keyboard('{Enter}');
    expect(approvals.filter((a) => a.approved)).toHaveLength(0);
  });

  it('Enter y Space en Permitir antes de 500 ms no aprueban', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const approvals = await openModal(makeBus());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Permitir una vez' }));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(approvals.filter((a) => a.approved)).toHaveLength(0);
  });

  it('tras 500 ms, Tab hasta Permitir y Enter sí aprueba', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const approvals = await openModal(makeBus());
    act(() => {
      vi.advanceTimersByTime(600);
    });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Permitir una vez' }));
    await user.keyboard('{Enter}');
    expect(approvals.filter((a) => a.approved)).toHaveLength(1);
  });
});
