/**
 * ConnectionBanner — aviso de que el cliente no está conectado al core-host.
 *
 * Aparece tras `BANNER_GRACE_MS` sin conexión abierta: así no parpadea al
 * arrancar ni en reconexiones rápidas. Se quita solo al volver a `open`.
 */

import { useEffect, useState } from 'react';
import { useConnectionState } from './use-connection';
import styles from './ConnectionBanner.module.css';

const BANNER_GRACE_MS = 1000;

export function ConnectionBanner(): JSX.Element | null {
  const state = useConnectionState();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state === 'open') {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(true);
    }, BANNER_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  if (state === 'open' || !visible) return null;

  return (
    <div className={styles.banner} role="status">
      {state === 'connecting' ? 'Conectando con Shiro…' : 'Sin conexión con Shiro: reintentando'}
    </div>
  );
}
