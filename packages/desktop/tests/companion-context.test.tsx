/**
 * Tests de `CompanionProvider` / `useCompanion`.
 *
 * Regresión del bug "la conversación desaparece al cambiar de pantalla":
 * el state vive en el provider (montado una vez en el root), no en la
 * pantalla, así que desmontar y volver a montar un consumidor — que es lo
 * que pasa al navegar entre pantallas — NO pierde el historial. Y un
 * `memory:snapshot` recibido por el provider rehidrata el chat (camino de
 * recarga).
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  EventBus,
  InProcessTransport,
  Logger,
  type EventMap,
  type IEventBus,
} from '@proyecto-shiro/core';
import { BusProvider } from '../src/bus-context';
import { CompanionProvider } from '../src/state/companion-context';
import { useCompanion } from '../src/state/use-companion';

function makeBus(): IEventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
}

/** Consumidor mínimo: pinta el historial como líneas de texto. */
function HistoryView(): JSX.Element {
  const [state] = useCompanion();
  return (
    <ul aria-label="historial">
      {state.history.map((m, i) => (
        <li key={`${m.role}-${String(i)}`}>{`${m.role}: ${m.text}`}</li>
      ))}
    </ul>
  );
}

/**
 * Simula el switch de pantallas de la app: un consumidor que se monta y
 * desmonta según un flag, todo DENTRO del provider (que no se desmonta).
 */
function Harness({ bus }: { bus: IEventBus<EventMap> }): JSX.Element {
  const [showChat, setShowChat] = useState(true);
  return (
    <BusProvider bus={bus}>
      <CompanionProvider>
        <button type="button" onClick={() => setShowChat((v) => !v)}>
          toggle
        </button>
        {showChat && <HistoryView />}
      </CompanionProvider>
    </BusProvider>
  );
}

function wrap(bus: IEventBus<EventMap>) {
  return ({ children }: { children: ReactNode }) => (
    <BusProvider bus={bus}>
      <CompanionProvider>{children}</CompanionProvider>
    </BusProvider>
  );
}

describe('CompanionProvider — el historial sobrevive a cambios de pantalla', () => {
  it('desmontar y remontar el consumidor (navegar) conserva el historial', async () => {
    const bus = makeBus();
    const { getByRole, queryByLabelText } = render(<Harness bus={bus} />);

    // Un turno de conversación entra al historial.
    await act(async () => {
      await bus.emit('user:message', { text: 'no me olvides', userId: 'me' });
    });
    await waitFor(() => {
      expect(screen.getByText('user: no me olvides')).toBeDefined();
    });

    // Navegamos fuera del chat (desmonta el consumidor)…
    act(() => {
      getByRole('button', { name: 'toggle' }).click();
    });
    expect(queryByLabelText('historial')).toBeNull();

    // …y volvemos. El consumidor se remonta y DEBE leer el historial que
    // el provider mantuvo vivo (antes salía vacío: el bug).
    act(() => {
      getByRole('button', { name: 'toggle' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText('user: no me olvides')).toBeDefined();
    });
  });
});

describe('CompanionProvider — rehidratación por memory:snapshot', () => {
  it('un memory:snapshot recibido por el provider rellena el historial', async () => {
    const bus = makeBus();
    render(
      wrap(bus)({
        children: <HistoryView />,
      }),
    );

    await act(async () => {
      await bus.emit('memory:snapshot', {
        userId: 'me',
        entries: [
          {
            id: 'm1',
            role: 'user',
            text: 'ayer dijimos esto',
            timestamp: '2026-06-11T10:00:00.000Z',
            userId: 'me',
          },
          {
            id: 'm2',
            role: 'assistant',
            text: 'lo recuerdo',
            timestamp: '2026-06-11T10:00:03.000Z',
            userId: 'me',
            metadata: { emotion: 'neutral', tier: 'cloud', latencyMs: 500 },
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByText('user: ayer dijimos esto')).toBeDefined();
      expect(screen.getByText('shiro: lo recuerdo')).toBeDefined();
    });
  });
});
