/**
 * SetupScreen: fila de Gemini con aviso de privacidad (ADR 0034 §6) y
 * textos degradados coherentes con la cadena Gemini → ElevenLabs → sistema.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemHealthReport } from '@proyecto-shiro/core';

const saveMock = vi.fn();
const state: { report: SystemHealthReport | null } = { report: null };
/** Lo que devuelve el guardado de claves; los tests lo mueven a mano. */
const secretsState: { status: 'idle' | 'saving' | 'saved' | 'error'; error: string | undefined } = {
  status: 'idle',
  error: undefined,
};

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
    status: secretsState.status,
    restartRequired: false,
    error: secretsState.error,
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

describe('SetupScreen — vivo frente a listo', () => {
  const secrets = { anthropic: true, elevenlabs: true, gemini: true };

  it('si a Ollama le falta un modelo, dice cuál y cómo bajarlo', () => {
    state.report = { ...makeReport(secrets), readiness: { ollamaMissingModels: ['qwen2.5:3b'] } };
    render(<SetupScreen />);
    const card = cardOf('Ollama');
    expect(within(card).queryByText(/✓ activo/)).toBeNull();
    expect(within(card).getByText(/falta un modelo/)).toBeDefined();
    expect(within(card).getByText('ollama pull qwen2.5:3b')).toBeDefined();
  });

  it('con varios modelos que faltan, da un comando por modelo', () => {
    state.report = {
      ...makeReport(secrets),
      readiness: { ollamaMissingModels: ['qwen2.5:3b', 'mxbai-embed-large'] },
    };
    render(<SetupScreen />);
    const card = cardOf('Ollama');
    expect(within(card).getByText('ollama pull qwen2.5:3b')).toBeDefined();
    expect(within(card).getByText('ollama pull mxbai-embed-large')).toBeDefined();
  });

  it('Whisper cargando el modelo no sale como activo', () => {
    state.report = { ...makeReport(secrets), readiness: { whisper: 'loading' } };
    render(<SetupScreen />);
    const card = cardOf('Whisper (STT)');
    expect(within(card).queryByText(/✓ activo/)).toBeNull();
    expect(within(card).getByText(/cargando/)).toBeDefined();
  });

  it('Whisper en CPU sale activo, con el aviso de que irá lento', () => {
    state.report = { ...makeReport(secrets), readiness: { whisper: 'cpu' } };
    render(<SetupScreen />);
    const card = cardOf('Whisper (STT)');
    expect(within(card).getByText(/✓ activo/)).toBeDefined();
    expect(within(card).getByText(/CPU/)).toBeDefined();
  });

  it('con Ollama caído, el comando incluye también el modelo de embeddings', () => {
    state.report = {
      ...makeReport(secrets),
      services: { ollama: 'down', letta: 'ok', whisper: 'ok' },
    };
    render(<SetupScreen />);
    expect(within(cardOf('Ollama')).getByText(/mxbai-embed-large/)).toBeDefined();
  });

  it('sin readiness todo sigue como antes', () => {
    state.report = makeReport(secrets);
    render(<SetupScreen />);
    expect(within(cardOf('Ollama')).getByText(/✓ activo/)).toBeDefined();
    expect(within(cardOf('Whisper (STT)')).getByText(/✓ activo/)).toBeDefined();
  });
});

describe('SetupScreen — Whisper caído', () => {
  it('avisa de que, recién arrancado, puede estar cargando el modelo', () => {
    state.report = {
      ...makeReport({ anthropic: true, elevenlabs: true, gemini: true }),
      services: { ollama: 'ok', letta: 'ok', whisper: 'down' },
    };
    render(<SetupScreen />);
    expect(within(cardOf('Whisper (STT)')).getByText(/recién arrancado/)).toBeDefined();
  });
});

describe('SetupScreen — clave de la nube', () => {
  const allKeys = { anthropic: true, elevenlabs: true, gemini: true };

  it('si la nube rechazó la clave, no sale como activa y dice qué hacer', () => {
    state.report = { ...makeReport(allKeys), readiness: { cloud: 'auth' } };
    render(<SetupScreen />);
    const card = cardOf('Anthropic (Claude)');
    expect(within(card).queryByText(/✓ activo/)).toBeNull();
    expect(within(card).getByText('clave rechazada')).toBeDefined();
    expect(within(card).getByText(/mal escrita o caducada/)).toBeDefined();
  });

  it('si no queda cuota o saldo, lo dice', () => {
    state.report = { ...makeReport(allKeys), readiness: { cloud: 'quota' } };
    render(<SetupScreen />);
    const card = cardOf('Anthropic (Claude)');
    expect(within(card).queryByText(/✓ activo/)).toBeNull();
    expect(within(card).getByText('sin cuota o saldo')).toBeDefined();
  });

  it('sin clave, manda «no detectado»: el problema de una clave que no está no se pinta', () => {
    state.report = {
      ...makeReport({ ...allKeys, anthropic: false }),
      readiness: { cloud: 'auth' },
    };
    render(<SetupScreen />);
    const card = cardOf('Anthropic (Claude)');
    expect(within(card).getByText(/no detectado/)).toBeDefined();
    expect(within(card).queryByText('clave rechazada')).toBeNull();
  });

  it('el problema de la nube no toca las otras claves', () => {
    state.report = { ...makeReport(allKeys), readiness: { cloud: 'auth' } };
    render(<SetupScreen />);
    expect(within(cardOf('ElevenLabs')).getByText(/✓ activo/)).toBeDefined();
  });
});

describe('SetupScreen — clave de la nube, texto', () => {
  it('no promete el modelo local: solo lo ofrece si está disponible', () => {
    state.report = {
      ...makeReport({ anthropic: true, elevenlabs: true, gemini: true }),
      readiness: { cloud: 'auth' },
    };
    render(<SetupScreen />);
    const text = within(cardOf('Anthropic (Claude)')).getByText(/mal escrita o caducada/);
    expect(text.textContent).toMatch(/si está disponible/);
  });
});

// P-15b, R-307: lo escrito se vaciaba al pulsar «Guardar», antes de saber si
// se había guardado. Si fallaba, había que volver a pegar la clave.
describe('SetupScreen — guardar una clave', () => {
  beforeEach(() => {
    secretsState.status = 'idle';
    secretsState.error = undefined;
    state.report = makeReport({ anthropic: true, elevenlabs: true, gemini: false });
  });

  /** Escribe una clave de Gemini, pulsa «Guardar» y deja el guardado «en curso». */
  function typeAndSave(): { input: HTMLInputElement; settle: (status: 'saved' | 'error') => void } {
    const view = render(<SetupScreen />);
    const card = cardOf('Google Gemini');
    const input = within(card).getByPlaceholderText<HTMLInputElement>(/GEMINI_API_KEY/);
    fireEvent.change(input, { target: { value: 'clave-de-prueba' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Guardar' }));
    secretsState.status = 'saving';
    view.rerender(<SetupScreen />);
    return {
      input,
      settle: (status) => {
        secretsState.status = status;
        secretsState.error = status === 'error' ? 'No se pudo guardar.' : undefined;
        view.rerender(<SetupScreen />);
      },
    };
  }

  it('mientras no hay respuesta, lo escrito sigue en el campo', () => {
    const { input } = typeAndSave();
    expect(input.value).toBe('clave-de-prueba');
  });

  it('cuando el core-host confirma, el campo se vacía', () => {
    const { input, settle } = typeAndSave();
    settle('saved');
    expect(input.value).toBe('');
  });

  it('lo que se escribe en el campo mientras se guarda no se borra al confirmarse', () => {
    const { input, settle } = typeAndSave();
    // El campo no se bloquea durante el guardado: se puede seguir escribiendo.
    fireEvent.change(input, { target: { value: 'clave-corregida' } });

    settle('saved');

    expect(input.value).toBe('clave-corregida');
  });

  it('si el guardado falla, lo escrito no se pierde', () => {
    const { input, settle } = typeAndSave();
    settle('error');
    expect(input.value).toBe('clave-de-prueba');
  });

  it('un guardado confirmado no vacía lo que se escriba después en otro campo', () => {
    const { settle } = typeAndSave();
    settle('saved');

    const other = within(cardOf('ElevenLabs')).getByPlaceholderText<HTMLInputElement>(
      /reemplazar key/,
    );
    fireEvent.change(other, { target: { value: 'otra-clave' } });

    expect(other.value).toBe('otra-clave');
  });
});
