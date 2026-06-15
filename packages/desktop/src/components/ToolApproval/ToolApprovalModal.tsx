/**
 * ToolApprovalModal — modal de aprobación de acciones agénticas (ADR 0022
 * §4). Cuando Shiro quiere ejecutar una tool `confirm` (`fs:write`,
 * `fs:delete`, `shell:exec`), el server pausa el loop y este modal pide
 * permiso explícito al usuario. Aprobación **por acción** — no hay opción de
 * "recordar" (cada acción se confirma individualmente).
 *
 * Se monta una vez en el root (`AppShell`), junto a `<UpdateBanner />`, para
 * que cubra cualquier pantalla. Invisible mientras no hay petición pendiente.
 *
 * `Esc` cancela (decisión segura por defecto).
 */

import { useEffect } from 'react';
import { useToolApproval } from './useToolApproval';
import styles from './ToolApprovalModal.module.css';

export function ToolApprovalModal(): JSX.Element | null {
  const { pending, respond } = useToolApproval();

  useEffect(() => {
    if (pending === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') respond(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [pending, respond]);

  if (pending === null) return null;

  return (
    <div className={styles.backdrop} role="presentation">
      <div
        className={styles.card}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tool-approval-title"
      >
        <h2 id="tool-approval-title" className={styles.title}>
          Shiro quiere ejecutar una acción
        </h2>
        <p className={styles.toolId}>
          <code>{pending.toolId}</code>
        </p>
        <pre className={styles.preview}>{pending.argsPreview}</pre>
        <p className={styles.warn}>
          Esta acción puede modificar tu equipo. Permítela solo si confías en lo que Shiro va a
          hacer.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancel}
            onClick={() => {
              respond(false);
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={styles.allow}
            autoFocus
            onClick={() => {
              respond(true);
            }}
          >
            Permitir una vez
          </button>
        </div>
      </div>
    </div>
  );
}
