/**
 * Tests del wiring `useCompanionState` ↔ EventBus.
 *
 * Enfoque del archivo: el reducer puro tiene su propio archivo de tests
 * (`companion-reducer.test.ts`). Aquí cubrimos lo que *el hook* añade:
 * el ciclo `stt:transcribed` → emit `user:message` → reducer dispatch
 * `USER_SAID` → historial actualizado.
 *
 * Mecánica: usamos el `EventBus` real con `InProcessTransport` y
 * `renderHook` + `act` para conducir la cadena de efectos asíncronos.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  EventBus,
  InProcessTransport,
  Logger,
  type EventMap,
  type IEventBus,
} from '@proyecto-shiro/core';
import { BusProvider } from '../src/bus-context';
import { useCompanionState } from '../src/state/useCompanionState';

function makeBus(): IEventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
}

function wrap(bus: IEventBus<EventMap>) {
  return ({ children }: { children: ReactNode }) => <BusProvider bus={bus}>{children}</BusProvider>;
}

describe('useCompanionState — wiring stt:transcribed → user:message', () => {
  it('un stt:transcribed con texto dispara user:message con ese mismo texto', async () => {
    const bus = makeBus();
    const userMessages: EventMap['user:message'][] = [];
    bus.on('user:message', (p) => {
      userMessages.push(p);
    });

    const { result } = renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    await act(async () => {
      await bus.emit('stt:transcribed', {
        text: 'hola Shiro',
        userId: 'me',
        isFinal: true,
      });
    });

    // El reducer apaga listening y limpia sttLive.
    expect(result.current[0].listening).toBe(false);
    expect(result.current[0].sttLive).toBe('');

    // Se emitió `user:message` y el historial captó el turno del usuario.
    await waitFor(() => {
      expect(userMessages).toHaveLength(1);
    });
    expect(userMessages[0]).toEqual({ text: 'hola Shiro', userId: 'me' });

    await waitFor(() => {
      expect(result.current[0].history).toHaveLength(1);
    });
    expect(result.current[0].history[0]).toMatchObject({
      role: 'user',
      text: 'hola Shiro',
    });
  });

  it('un stt:transcribed con texto vacío NO emite user:message ni añade al historial', async () => {
    const bus = makeBus();
    const userMessages: EventMap['user:message'][] = [];
    bus.on('user:message', (p) => {
      userMessages.push(p);
    });

    const { result } = renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    await act(async () => {
      await bus.emit('stt:transcribed', { text: '', userId: 'me', isFinal: true });
    });
    await act(async () => {
      await bus.emit('stt:transcribed', { text: '   ', userId: 'me', isFinal: true });
    });

    // Verifica explícitamente que NO se emitió: sin esto, un waitFor
    // pasaría por casualidad si el evento llegara tarde.
    await new Promise((r) => setTimeout(r, 20));
    expect(userMessages).toHaveLength(0);
    expect(result.current[0].history).toHaveLength(0);
  });

  it('trimea whitespace antes de emitir user:message', async () => {
    const bus = makeBus();
    const userMessages: EventMap['user:message'][] = [];
    bus.on('user:message', (p) => {
      userMessages.push(p);
    });

    renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    await act(async () => {
      await bus.emit('stt:transcribed', {
        text: '   hola Shiro   ',
        userId: 'me',
        isFinal: true,
      });
    });

    await waitFor(() => {
      expect(userMessages).toHaveLength(1);
    });
    expect(userMessages[0]?.text).toBe('hola Shiro');
  });

  it('un user:message manual (input de texto) sigue añadiéndose al historial sin pasar por STT', async () => {
    const bus = makeBus();
    const { result } = renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    await act(async () => {
      await bus.emit('user:message', { text: 'tipeado', userId: 'me' });
    });

    await waitFor(() => {
      expect(result.current[0].history).toHaveLength(1);
    });
    expect(result.current[0].history[0]?.text).toBe('tipeado');
  });
});

describe('useCompanionState — flujo conversacional completo voz → respuesta', () => {
  it('voz → user:message → router:routed → llm:responded → tts:audio-ended deja el estado consistente', async () => {
    const bus = makeBus();
    const { result } = renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    // 1. Usuario aprieta Space (el hook PTT real emitiría esto al
    //    arrancar la captura; aquí lo simulamos).
    await act(async () => {
      await bus.emit('stt:listening', { userId: 'me' });
    });
    expect(result.current[0].listening).toBe(true);

    // 2. Partials llegan mientras habla — el subtítulo en vivo se llena.
    await act(async () => {
      await bus.emit('stt:partial', { text: 'hola', userId: 'me' });
    });
    expect(result.current[0].sttLive).toBe('hola');

    // 3. Final del STT — el hook debe emitir user:message
    //    automáticamente, lo que arranca el pipeline server-side.
    await act(async () => {
      await bus.emit('stt:transcribed', {
        text: 'hola Shiro',
        userId: 'me',
        isFinal: true,
      });
    });
    expect(result.current[0].listening).toBe(false);
    expect(result.current[0].sttLive).toBe('');
    await waitFor(() => {
      expect(result.current[0].history).toHaveLength(1);
    });

    // 4. Router decide tier (lo simula el server-side; aquí emitimos
    //    como si nos hubiera llegado por el bus).
    await act(async () => {
      await bus.emit('router:routed', { tier: 'local', userId: 'me' });
    });
    expect(result.current[0].thinking).toBe(true);
    expect(result.current[0].routedTo).toBe('local');

    // 5. LLM responde.
    await act(async () => {
      await bus.emit('llm:responded', {
        text: '¡Hola! ¿Cómo estás?',
        emotion: 'divertida',
        tier: 'local',
        userId: 'me',
        latencyMs: 320,
      });
    });
    expect(result.current[0].thinking).toBe(false);
    expect(result.current[0].speaking).toBe(true);
    expect(result.current[0].emotion).toBe('divertida');

    // El historial tiene el turno del usuario + la respuesta de Shiro.
    expect(result.current[0].history).toHaveLength(2);
    expect(result.current[0].history[0]?.role).toBe('user');
    expect(result.current[0].history[1]?.role).toBe('shiro');
    expect(result.current[0].history[1]?.text).toBe('¡Hola! ¿Cómo estás?');

    // 6. TTS termina.
    await act(async () => {
      await bus.emit('tts:audio-ended', { userId: 'me' });
    });
    expect(result.current[0].speaking).toBe(false);
  });

  it('si el LLM no responde, el historial mantiene el turno del usuario (no se pierde)', async () => {
    const bus = makeBus();
    const { result } = renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    await act(async () => {
      await bus.emit('stt:transcribed', {
        text: 'hola Shiro',
        userId: 'me',
        isFinal: true,
      });
    });

    await waitFor(() => {
      expect(result.current[0].history).toHaveLength(1);
    });
    expect(result.current[0].history[0]?.text).toBe('hola Shiro');
    // No depende de respuestas ulteriores — el "tú dijiste" queda guardado.
  });
});

describe('useCompanionState — hot path no se rompe por suscripciones', () => {
  it('múltiples ciclos de PTT consecutivos no apilan dispatches duplicados', async () => {
    const bus = makeBus();
    const userMessages: EventMap['user:message'][] = [];
    bus.on('user:message', (p) => {
      userMessages.push(p);
    });

    const { result } = renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    for (let i = 0; i < 3; i += 1) {
      // Secuencial a propósito — emulamos 3 turnos de PTT uno tras otro.
      await act(async () => {
        await bus.emit('stt:transcribed', {
          text: `turno ${i}`,
          userId: 'me',
          isFinal: true,
        });
      });
    }

    await waitFor(() => {
      expect(userMessages).toHaveLength(3);
    });
    expect(userMessages.map((m) => m.text)).toEqual(['turno 0', 'turno 1', 'turno 2']);
    expect(result.current[0].history).toHaveLength(3);
  });

  it('un suscriptor externo a user:message recibe el mensaje que el hook emite (interop con otros componentes)', async () => {
    const bus = makeBus();
    const externalListener = vi.fn();
    bus.on('user:message', externalListener);

    renderHook(() => useCompanionState(), { wrapper: wrap(bus) });

    await act(async () => {
      await bus.emit('stt:transcribed', {
        text: 'desde STT',
        userId: 'me',
        isFinal: true,
      });
    });

    await waitFor(() => {
      expect(externalListener).toHaveBeenCalledWith({ text: 'desde STT', userId: 'me' });
    });
  });
});
