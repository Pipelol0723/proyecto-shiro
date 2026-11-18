/**
 * Avisos de por qué falló un LLM en el turno en curso. Uno por fallo: la nube
 * puede fallar y el local responder, o fallar los dos.
 */

import type { TurnFailure } from '../../state/companion-reducer';
import { describeTurnFailure } from '../../state/turn-failure-text';
import styles from './ConversationScreen.module.css';

export function TurnFailureNotices({
  failures,
}: {
  failures: readonly TurnFailure[];
}): JSX.Element {
  return (
    <>
      {failures.map((failure) => (
        <p key={`${failure.tier}-${failure.reason}`} className={styles.cutNotice} role="status">
          {describeTurnFailure(failure)}
        </p>
      ))}
    </>
  );
}
