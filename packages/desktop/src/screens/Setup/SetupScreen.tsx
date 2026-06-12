/**
 * SetupScreen — wizard de salud del sistema + referencia de atajos.
 *
 * Muestra en vivo el estado de los servicios externos (Ollama, Letta,
 * Whisper) y la presencia de las API keys, con el comando exacto para
 * levantar lo que falte. El chequeo lo hace el core-host server-side y
 * lo emite por `system:health` (ADR 0024 §6); este componente solo lo
 * renderiza vía `useSystemHealth`.
 *
 * Shiro funciona en **modo degradado** si falta algo: cada fila explica
 * qué se pierde. Las API keys se pueden **introducir desde la propia app**
 * (sin tocar `.env`): el core-host las persiste en un `secrets.env` y
 * aplican al reiniciar (ADR 0024 §6).
 */

import { useState } from 'react';
import type { ServiceStatus, SystemHealthReport } from '@proyecto-shiro/core';
import { useBus } from '../../use-bus';
import { useSystemHealth } from '../../health/useSystemHealth';
import { useSecretsSave } from '../../health/useSecretsSave';
import styles from './SetupScreen.module.css';

/** Campos del payload `secrets:save`. Mapea cada secret a su campo. */
const SECRET_FIELD: Record<keyof SystemHealthReport['secrets'], 'anthropic' | 'elevenlabs'> = {
  anthropic: 'anthropic',
  elevenlabs: 'elevenlabs',
};

interface ServiceRow {
  key: keyof SystemHealthReport['services'];
  name: string;
  /** Para qué se usa. */
  purpose: string;
  /** Comando para levantarlo si está caído. */
  command: string;
  /** Qué se pierde si no está. */
  degraded: string;
}

const SERVICES: readonly ServiceRow[] = [
  {
    key: 'ollama',
    name: 'Ollama',
    purpose: 'LLM local (Qwen 2.5) + clasificador del router',
    command: 'ollama serve   ·   ollama pull qwen2.5:3b',
    degraded:
      'Sin Ollama, Shiro depende del LLM cloud (Claude). Sin key de Claude tampoco, no responde.',
  },
  {
    key: 'letta',
    name: 'Letta',
    purpose: 'Memoria semántica persistente',
    command: 'docker compose up -d letta',
    degraded:
      'Sin Letta, Shiro no recuerda conversaciones entre sesiones (solo el WAL local de continuidad).',
  },
  {
    key: 'whisper',
    name: 'Whisper (STT)',
    purpose: 'Transcripción de voz a texto',
    command: 'docker compose up -d whisper',
    degraded: 'Sin Whisper, no puedes hablar por voz — solo escribir.',
  },
] as const;

interface SecretRow {
  key: keyof SystemHealthReport['secrets'];
  name: string;
  envVar: string;
  purpose: string;
  degraded: string;
}

const SECRETS: readonly SecretRow[] = [
  {
    key: 'anthropic',
    name: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    purpose: 'LLM cloud para respuestas complejas',
    degraded:
      'Sin esta key Shiro usa solo Qwen local, que da respuestas más cortas y a veces vacías.',
  },
  {
    key: 'elevenlabs',
    name: 'ElevenLabs',
    envVar: 'ELEVENLABS_API_KEY',
    purpose: 'Voz neuronal del TTS',
    degraded: 'Sin esta key Shiro habla con la voz del sistema operativo (SystemTTS).',
  },
] as const;

function StatusBadge({ ok, checking }: { ok: boolean; checking: boolean }): JSX.Element {
  if (checking)
    return <span className={`${styles.badge} ${styles.badgeChecking}`}>comprobando…</span>;
  return ok ? (
    <span className={`${styles.badge} ${styles.badgeOk}`}>✓ activo</span>
  ) : (
    <span className={`${styles.badge} ${styles.badgeDown}`}>✕ no detectado</span>
  );
}

export function SetupScreen(): JSX.Element {
  const bus = useBus();
  const { report, checking, refresh } = useSystemHealth({ bus });
  const secrets = useSecretsSave(bus);
  // Borradores de las keys que el usuario escribe (no se rellenan nunca
  // con el valor real — solo se conoce la presencia). Key por field.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const serviceStatus = (s: ServiceStatus | undefined): boolean => s === 'ok';

  const saveSecret = (field: 'anthropic' | 'elevenlabs'): void => {
    const value = drafts[field] ?? '';
    secrets.save({ [field]: value });
    setDrafts((d) => ({ ...d, [field]: '' }));
  };

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>Setup</h1>
        <p className={styles.subtitle}>
          Estado de los servicios que Shiro necesita. Lo que falte se levanta con el comando
          indicado; mientras tanto Shiro funciona en modo degradado.
        </p>
      </header>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Servicios externos</h2>
          <button
            type="button"
            className={styles.refresh}
            onClick={refresh}
            disabled={checking}
            title="Volver a chequear"
          >
            {checking ? 'comprobando…' : 'rechequear'}
          </button>
        </div>

        <ul className={styles.cards}>
          {SERVICES.map((svc) => {
            const ok = serviceStatus(report?.services[svc.key]);
            return (
              <li key={svc.key} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardName}>{svc.name}</span>
                  <StatusBadge ok={ok} checking={report === null && checking} />
                </div>
                <p className={styles.cardPurpose}>{svc.purpose}</p>
                {!ok && report !== null && (
                  <>
                    <code className={styles.command}>{svc.command}</code>
                    <p className={styles.degraded}>{svc.degraded}</p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>API keys</h2>
        <ul className={styles.cards}>
          {SECRETS.map((sec) => {
            const ok = report?.secrets[sec.key] ?? false;
            const field = SECRET_FIELD[sec.key];
            return (
              <li key={sec.key} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardName}>{sec.name}</span>
                  <StatusBadge ok={ok} checking={report === null && checking} />
                </div>
                <p className={styles.cardPurpose}>{sec.purpose}</p>
                {!ok && report !== null && <p className={styles.degraded}>{sec.degraded}</p>}
                <div className={styles.secretRow}>
                  <input
                    type="password"
                    className={styles.secretInput}
                    placeholder={ok ? 'reemplazar key…' : `pega tu ${sec.envVar}`}
                    value={drafts[field] ?? ''}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setDrafts((d) => ({ ...d, [field]: v }));
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={styles.secretSave}
                    disabled={secrets.status === 'saving' || (drafts[field] ?? '').trim() === ''}
                    onClick={() => {
                      saveSecret(field);
                    }}
                  >
                    Guardar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {secrets.status === 'saved' && secrets.restartRequired && (
          <p className={styles.secretNote}>
            ✓ Guardada. Reinicia Shiro (tray → Salir y reabrir) para aplicarla.
          </p>
        )}
        {secrets.status === 'saved' && !secrets.restartRequired && (
          <p className={styles.secretNote}>Sin cambios (la key era la misma o estaba vacía).</p>
        )}
        {secrets.status === 'error' && (
          <p className={styles.secretError}>No se pudo guardar: {secrets.error}</p>
        )}
        <p className={styles.secretHint}>
          Las keys se guardan localmente (cifrado del disco del SO) y nunca salen de tu máquina. En
          desarrollo, el <code>.env</code> de la raíz tiene prioridad.
        </p>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Atajos de teclado</h2>
        <ul className={styles.shortcuts}>
          {SHORTCUTS.map((s) => (
            <li key={s.desc} className={styles.shortcut}>
              <span className={styles.desc}>{s.desc}</span>
              <span className={styles.keys}>
                {s.keys.map((k, i) => (
                  <span key={`${k}-${String(i)}`} className={styles.kbd}>
                    {k}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface Shortcut {
  keys: readonly string[];
  desc: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['Space'], desc: 'Mantener para hablar (push-to-talk)' },
  { keys: ['M'], desc: 'Alternar micrófono (toggle)' },
  { keys: ['Cmd', '/'], desc: 'Mostrar/ocultar chat' },
  { keys: ['Cmd', 'Shift', 'O'], desc: 'Modo overlay flotante' },
  { keys: ['Esc'], desc: 'Cancelar / salir de overlay' },
] as const;
