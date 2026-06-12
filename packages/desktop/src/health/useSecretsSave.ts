/**
 * useSecretsSave — manda API keys al core-host (`secrets:save`) para que
 * las persista, y escucha el ack (`secrets:saved`).
 *
 * Las keys se guardan en un `secrets.env` server-side y aplican al
 * **reiniciar** la app (los módulos LLM/TTS leen las keys al construirse).
 * El valor viaja por el WS local; este hook nunca lo guarda en estado tras
 * mandarlo. Ver ADR 0024 §6.
 */

import { useCallback, useEffect, useState } from 'react';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';

export type SecretsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseSecretsSaveResult {
  save: (updates: EventMap['secrets:save']) => void;
  status: SecretsSaveStatus;
  /** `true` si el último guardado cambió algo y hace falta reiniciar. */
  restartRequired: boolean;
  error: string | undefined;
}

export function useSecretsSave(bus: IEventBus<EventMap>): UseSecretsSaveResult {
  const [status, setStatus] = useState<SecretsSaveStatus>('idle');
  const [restartRequired, setRestartRequired] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = bus.on('secrets:saved', (payload) => {
      if (payload.ok) {
        setStatus('saved');
        setRestartRequired(payload.restartRequired);
        setError(undefined);
      } else {
        setStatus('error');
        setError(payload.error ?? 'No se pudo guardar.');
      }
    });
    return unsubscribe;
  }, [bus]);

  const save = useCallback(
    (updates: EventMap['secrets:save']) => {
      setStatus('saving');
      setError(undefined);
      void bus.emit('secrets:save', updates);
    },
    [bus],
  );

  return { save, status, restartRequired, error };
}
