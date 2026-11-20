/**
 * Tests del aviso de fallo del turno: el texto por motivo, el componente que
 * lo pinta y el camino entero desde el bus (`llm:failed`) hasta la pantalla.
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  EventBus,
  InProcessTransport,
  Logger,
  TURN_FAILURE_REASONS,
  type EventMap,
  type IEventBus,
} from '@proyecto-shiro/core';
import { BusProvider } from '../src/bus-context';
import { CompanionProvider } from '../src/state/companion-context';
import { useCompanion } from '../src/state/use-companion';
import { describeTurnFailure } from '../src/state/turn-failure-text';
import { TurnFailureNotices } from '../src/screens/Conversation/TurnFailureNotices';

function makeBus(): IEventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
}

describe('describeTurnFailure', () => {
  it('tiene un texto propio para cada motivo y cada modelo', () => {
    const texts = (['cloud', 'local'] as const).flatMap((tier) =>
      TURN_FAILURE_REASONS.map((reason) => describeTurnFailure({ reason, tier })),
    );
    expect(texts.every((text) => text.length > 0)).toBe(true);
  });

  it('en la nube, cada motivo tiene su propio texto', () => {
    const texts = TURN_FAILURE_REASONS.map((reason) =>
      describeTurnFailure({ reason, tier: 'cloud' }),
    );
    expect(new Set(texts).size).toBe(TURN_FAILURE_REASONS.length);
  });

  it('un fallo local sin motivo conocido no culpa al modelo: pudo ser otro paso', () => {
    const text = describeTurnFailure({ reason: 'unknown', tier: 'local' });
    expect(text).not.toMatch(/modelo local/);
    expect(text).toMatch(/no pude/);
  });

  it('la nube no promete que el local vaya a responder: dice que lo prueba', () => {
    expect(describeTurnFailure({ reason: 'auth', tier: 'cloud' })).toMatch(
      /Pruebo con el modelo local/,
    );
  });

  it('todo fallo de la nube nombra el modelo local', () => {
    for (const reason of TURN_FAILURE_REASONS) {
      expect(describeTurnFailure({ reason, tier: 'cloud' })).toMatch(/modelo local/);
    }
  });

  it('nombra la causa: la clave, el límite, Ollama o el modelo que falta', () => {
    expect(describeTurnFailure({ reason: 'auth', tier: 'cloud' })).toMatch(/clave/);
    expect(describeTurnFailure({ reason: 'missing-key', tier: 'cloud' })).toMatch(/clave/);
    expect(describeTurnFailure({ reason: 'quota', tier: 'cloud' })).toMatch(/límite|saldo/);
    expect(describeTurnFailure({ reason: 'unavailable', tier: 'local' })).toMatch(/Ollama/);
    expect(describeTurnFailure({ reason: 'model-missing', tier: 'local' })).toMatch(/ollama pull/);
  });
});

describe('TurnFailureNotices', () => {
  it('sin fallos no pinta nada', () => {
    const { container } = render(<TurnFailureNotices failures={[]} />);
    expect(container.textContent).toBe('');
  });

  it('pinta un aviso por fallo', () => {
    render(
      <TurnFailureNotices
        failures={[
          { reason: 'auth', tier: 'cloud' },
          { reason: 'unavailable', tier: 'local' },
        ]}
      />,
    );
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});

describe('del bus a la pantalla', () => {
  function Chat(): JSX.Element {
    const [state] = useCompanion();
    return <TurnFailureNotices failures={state.turnFailures} />;
  }

  it.each([
    ['auth', /clave/],
    ['quota', /límite|saldo/],
  ] as const)(
    'un llm:failed «%s» de la nube se ve en el chat con su causa',
    async (reason, text) => {
      const bus = makeBus();
      render(
        <BusProvider bus={bus}>
          <CompanionProvider>
            <Chat />
          </CompanionProvider>
        </BusProvider>,
      );
      expect(screen.queryByRole('status')).toBeNull();

      await act(async () => {
        await bus.emit('llm:failed', { reason, tier: 'cloud', userId: 'me' });
      });

      expect(screen.getByRole('status').textContent).toMatch(text);
    },
  );
});

// IN-F: el motivo nuevo dice lo que pasó, no el aviso genérico.
describe('describeTurnFailure — respuesta vacía', () => {
  it('la nube y el local tienen su propio texto, distinto del genérico', () => {
    const cloud = describeTurnFailure({ reason: 'empty', tier: 'cloud' });
    const local = describeTurnFailure({ reason: 'empty', tier: 'local' });

    expect(cloud).toMatch(/sin texto/);
    expect(local).toMatch(/sin texto/);
    expect(cloud).not.toBe(describeTurnFailure({ reason: 'unknown', tier: 'cloud' }));
    expect(local).not.toBe(describeTurnFailure({ reason: 'unknown', tier: 'local' }));
  });
});
