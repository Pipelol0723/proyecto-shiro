/**
 * ConnectionBanner — aviso de que el cliente no está conectado al core-host.
 *
 * Aparece tras la gracia de `useDisconnectedFor` sin conexión abierta: así no
 * parpadea al arrancar ni en reconexiones rápidas. Se quita solo al volver a
 * `open`.
 */

import { useConnectionState } from './use-connection';
import { useDisconnectedFor } from './use-disconnected-for';
import styles from './ConnectionBanner.module.css';

export function ConnectionBanner(): JSX.Element | null {
  const state = useConnectionState();
  const visible = useDisconnectedFor();

  if (!visible) return null;

  return (
    <div className={styles.banner} role="status">
      {state === 'connecting' ? 'Conectando con Shiro…' : 'Sin conexión con Shiro: reintentando'}
    </div>
  );
}
