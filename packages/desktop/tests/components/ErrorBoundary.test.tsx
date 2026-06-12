/**
 * Tests del `ErrorBoundary`.
 *
 * React loguea a `console.error` cuando un boundary captura — lo silenciamos
 * en los casos que lanzan a propósito para no ensuciar la salida del test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('boom de render');
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderiza los hijos cuando no lanzan', () => {
    render(
      <ErrorBoundary fallback={<span>fallback</span>}>
        <span>contenido ok</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText('contenido ok')).toBeDefined();
    expect(screen.queryByText('fallback')).toBeNull();
  });

  it('muestra el fallback y llama onError cuando un hijo lanza al renderizar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={<span>fallback-visible</span>} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fallback-visible')).toBeDefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('soporta fallback como función que recibe el error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary fallback={(err) => <span>error: {err.message}</span>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('error: boom de render')).toBeDefined();
  });
});
