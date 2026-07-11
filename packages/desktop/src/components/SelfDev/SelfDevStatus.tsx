/**
 * SelfDevStatus — indicador flotante del progreso de las sesiones de
 * self-improvement (ADR 0023). Discreto y no-modal: invisible salvo cuando hay
 * una sesión en curso o un resultado sin descartar.
 *
 * Se monta una vez en el root (`AppShell`), junto a `<ToolApprovalModal />`.
 * Mientras corre muestra la fase; al terminar muestra el link del PR (éxito) o
 * el motivo (fallo), con un botón para cerrar. Los modales de aprobación
 * (arrancar sesión / crear PR) son aparte — los maneja `ToolApprovalModal`.
 */

import { useSelfDevStatus, type SelfDevPhase } from './useSelfDevStatus';
import styles from './SelfDevStatus.module.css';

const PHASE_LABELS: Record<SelfDevPhase, string> = {
  setup: 'preparando el worktree aislado',
  generating: 'generando el cambio',
  eval: 'corriendo los checks (format, lint, typecheck, test)',
  fixing: 'corrigiendo lo que falló',
  pr: 'esperando tu aprobación del PR',
  done: 'terminando',
};

export function SelfDevStatus(): JSX.Element | null {
  const { session, result, dismiss } = useSelfDevStatus();

  if (session !== null) {
    return (
      <div className={styles.panel} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.text}>
          Shiro trabaja en <strong>{session.topic}</strong>: {PHASE_LABELS[session.phase]}
          {session.message !== undefined && session.message.length > 0
            ? ` — ${session.message}`
            : ''}
        </span>
      </div>
    );
  }

  if (result !== null) {
    return (
      <div
        className={`${styles.panel} ${result.ok ? styles.ok : styles.fail}`}
        role={result.ok ? 'status' : 'alert'}
      >
        <span className={styles.text}>
          {result.ok ? (
            <>
              Self-dev sobre <strong>{result.topic}</strong>: PR listo para tu revisión.
              {result.prUrl !== undefined && (
                <>
                  {' '}
                  <a className={styles.link} href={result.prUrl} target="_blank" rel="noreferrer">
                    {result.prUrl}
                  </a>
                </>
              )}
            </>
          ) : (
            <>
              Self-dev sobre <strong>{result.topic}</strong> no se completó:{' '}
              {result.reason ?? 'motivo desconocido'}
            </>
          )}
        </span>
        <button type="button" className={styles.dismiss} onClick={dismiss}>
          Cerrar
        </button>
      </div>
    );
  }

  return null;
}
