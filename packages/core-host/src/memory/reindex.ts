/**
 * reindex — prepara la memoria local para volver a llenar Letta desde cero
 * (`npm run reindex-memory`; P-11a, R-330).
 *
 * Los turnos ya enviados a Letta no se reenvían solos. Si Letta se cambia por
 * otro, o se restaura vacío, el agente nuevo se queda sin el historial. Esta
 * orden deja todos los turnos como pendientes y olvida el agente anotado; en
 * el siguiente arranque, Shiro crea un agente y los reenvía por lotes.
 *
 * No borra ningún turno ni toca Letta: solo cambia, en la memoria local, la
 * marca de «ya enviado» y el agente anotado.
 */

import { existsSync } from 'node:fs';
import { inspectLettaSync, LocalMemory, reindexFromLocal } from '@proyecto-shiro/core/node';

export interface ReindexOptions {
  /** Archivo de la memoria local (`memory.db`). */
  dbPath: string;
  /** `false`: solo dice lo que haría. */
  apply: boolean;
  /** ¿Hay un `core-host` en marcha? Con él abierto no se toca la memoria. */
  isAppRunning: () => Promise<boolean>;
}

export interface ReindexReport {
  applied: boolean;
  /** Turnos que hay en la memoria. */
  total: number;
  /** Turnos que estaban enviados y vuelven a quedar pendientes. */
  toResend: number;
  /** Agente de Letta que estaba anotado, si lo había. */
  agentId: string | undefined;
}

export async function reindexMemory(options: ReindexOptions): Promise<ReindexReport> {
  const { dbPath, apply } = options;
  // Abrir una ruta que no existe crearía una memoria vacía: se comprueba antes.
  if (!existsSync(dbPath)) throw new Error(`no existe la memoria local: ${dbPath}`);
  if (await options.isAppRunning()) {
    throw new Error(
      'Shiro está en marcha: cierra Shiro antes. El servidor tiene el agente en uso y seguiría enviando al de antes',
    );
  }
  const local = new LocalMemory({ dbPath });
  try {
    if (!apply) {
      const { total, pending, agentId } = inspectLettaSync(local);
      return { applied: false, total, toResend: total - pending, agentId };
    }
    const { total, resent, agentId } = reindexFromLocal(local);
    return { applied: true, total, toResend: resent, agentId };
  } finally {
    local.close();
  }
}

/** El informe, en líneas para la consola. */
export function describeReindex(report: ReindexReport): string[] {
  const agent = report.agentId ?? 'ninguno';
  if (!report.applied) {
    return [
      `La memoria tiene ${String(report.total)} turnos; ${String(report.toResend)} constan como ya enviados a Letta.`,
      `Agente de Letta anotado: ${agent}.`,
      'No se ha cambiado nada. Para dejarlos todos pendientes y olvidar el agente, repite con --yes.',
    ];
  }
  return [
    `Hecho: los ${String(report.total)} turnos quedan pendientes de enviar (${String(report.toResend)} constaban como enviados).`,
    `Agente de Letta olvidado: ${agent}.`,
    'Al arrancar Shiro con Letta en marcha se crea un agente nuevo y los turnos se reenvían por lotes.',
    'Si la configuración fija un agente (letta.agent_id), no se crea ninguno: se reenvían a ese.',
  ];
}
