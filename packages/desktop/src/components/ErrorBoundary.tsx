/**
 * ErrorBoundary — captura errores lanzados durante el render de sus hijos
 * y muestra un `fallback` en vez de propagarlos.
 *
 * **Por qué hace falta**: en React, un error de render sin un boundary
 * arriba **desmonta TODO el árbol** → pantalla en blanco. El `try/catch`
 * de un `useEffect` NO atrapa estos errores (ocurren en la fase de render,
 * no en el efecto). El caso real que motivó esto: `pixi-live2d-display`
 * dentro del `<Live2DCanvas>` puede crashear al renderizar en la WebView
 * empaquetada (no solo al importar) y se llevaba la app entera a blanco.
 *
 * Es un **class component** porque los error boundaries no tienen
 * equivalente en hooks (a día de hoy es la única API de React para esto).
 *
 * `fallback` puede ser un nodo fijo o una función `(error) => nodo` si
 * quieres mostrar el mensaje del error (útil en el boundary raíz para
 * diagnosticar en vez de quedarte en blanco).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback: ReactNode | ((error: Error) => ReactNode);
  /** Se invoca una vez al capturar — para loguear o degradar (p. ej. caer al Orbe). */
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      const { fallback } = this.props;
      return typeof fallback === 'function' ? fallback(error) : fallback;
    }
    return this.props.children;
  }
}
