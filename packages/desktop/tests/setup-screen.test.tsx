/**
 * SetupScreen: fila de Gemini con aviso de privacidad (ADR 0034 §6) y
 * textos degradados coherentes con la cadena Gemini → ElevenLabs → sistema.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SystemHealthReport } from '@proyecto-shiro/core';

const saveMock = vi.fn();
const state: { report: SystemHealthReport | null } = { report: null };

vi.mock('../src/use-bus', () => ({ useBus: () => ({}) }));
vi.mock('../src/connection/use-connection', () => ({ useConnectionState: () => 'open' }));
vi.mock('../src/connection/use-disconnected-for', () => ({ useDisconnectedFor: () => false }));
vi.mock('../src/health/useSystemHealth', () => ({
  useSystemHealth: () => ({
    report: state.report,
    checking: false,
    timedOut: false,
    refresh: () => undefined,
  }),
}));
vi.mock('../src/health/useSecretsSave', () => ({
  useSecretsSave: () => ({
    save: saveMock,
    status: 'idle',
    restartRequired: false,
    error: undefined,
  }),
}));

import { SetupScreen } from '../src/screens/Setup/SetupScreen';

function makeReport(secrets: SystemHealthReport['secrets']): SystemHealthReport {
  return {
    services: { ollama: 'ok', letta: 'ok', whisper: 'ok' },
    secrets,
    checkedAt: '2026-11-14T00:00:00.000Z',
  };
}

function cardOf(name: string): HTMLElement {
  const card = screen.getByText(name).closest('li');
  if (!card) throw new Error(`Sin tarjeta para ${name}`);
  return card;
}

describe('SetupScreen', () => {
  it('muestra la fila de Gemini con el aviso del nivel gratuito', () => {
    state.report = makeReport({ anthropic: true, elevenlabs: true, gemini: false });
    render(<SetupScreen />);
    const card = cardOf('Google Gemini');
    expect(within(card).getByText(/nivel gratuito/)).toBeDefined();
    expect(within(card).getByText(/se envía a Google/)).toBeDefined();
    expect(within(card).getByPlaceholderText(/GEMINI_API_KEY/)).toBeDefined();
  });

  it('la insignia de Gemini refleja secrets.gemini', () => {
    state.report = makeReport({ anthropic: true, elevenlabs: true, gemini: true });
    const { unmount } = render(<SetupScreen />);
    expect(within(cardOf('Google Gemini')).getByText(/activo/)).toBeDefined();
    unmount();
    state.report = makeReport({ anthropic: true, elevenlabs: true, gemini: false });
    render(<SetupScreen />);
    expect(within(cardOf('Google Gemini')).getByText(/no detectado/)).toBeDefined();
  });

  it('el texto degradado de ElevenLabs ya no promete la voz del sistema como único respaldo', () => {
    state.report = makeReport({ anthropic: true, elevenlabs: false, gemini: true });
    render(<SetupScreen />);
    const text = within(cardOf('ElevenLabs')).getByText(/Sin esta clave/).textContent ?? '';
    expect(text).toMatch(/Gemini/);
    expect(text).not.toMatch(/key/);
  });

  it('la nota fija avisa de que lo hablado sale a un tercero', () => {
    state.report = makeReport({ anthropic: true, elevenlabs: true, gemini: true });
    render(<SetupScreen />);
    expect(screen.getByText(/lo que digo en voz alta sí se envía/i)).toBeDefined();
    expect(screen.queryByText(/nunca salen de tu máquina/)).toBeNull();
  });

  it('guardar la clave de Gemini manda gemini por secrets:save', () => {
    state.report = makeReport({ anthropic: true, elevenlabs: true, gemini: false });
    render(<SetupScreen />);
    const card = cardOf('Google Gemini');
    fireEvent.change(within(card).getByPlaceholderText(/GEMINI_API_KEY/), {
      target: { value: 'clave-de-prueba' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Guardar' }));
    expect(saveMock).toHaveBeenCalledWith({ gemini: 'clave-de-prueba' });
  });
});
