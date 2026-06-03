/**
 * ModulesScreen — vista (stub) sobre el modules.config.yaml.
 *
 * En esta fase no edita ni lee el YAML real — muestra el estado
 * conceptual de los slots con sample data. Cuando llegue el editor
 * funcional (post-MVP), aquí se cablea al ConfigLoader del backend
 * y al schema zod.
 */

import styles from './ModulesScreen.module.css';

interface Slot {
  id: string;
  label: string;
  active: string;
  fallbacks?: readonly string[];
  status: 'pendiente' | 'listo' | 'fallback';
  note: string;
}

const SLOTS: readonly Slot[] = [
  {
    id: 'llm-local',
    label: 'LLM local',
    active: 'OllamaLLM (qwen2.5:7b)',
    status: 'pendiente',
    note: 'Hito LLM — Fase 2 del cronograma actualizado.',
  },
  {
    id: 'llm-cloud',
    label: 'LLM cloud',
    active: 'AnthropicLLM (claude-sonnet-4-6)',
    status: 'pendiente',
    note: 'API key se lee de ANTHROPIC_API_KEY en .env.',
  },
  {
    id: 'router',
    label: 'Router',
    active: 'HybridRouter',
    status: 'pendiente',
    note: 'Usa Qwen 7B como clasificador rápido (umbral 0.6).',
  },
  {
    id: 'stt',
    label: 'STT (voz → texto)',
    active: 'WhisperSTT',
    status: 'pendiente',
    note: 'Microservicio faster-whisper en :8765 (Python).',
  },
  {
    id: 'tts',
    label: 'TTS (texto → voz)',
    active: 'ElevenLabsTTS',
    fallbacks: ['SystemTTS'],
    status: 'pendiente',
    note: 'ElevenLabs primary, SystemTTS fallback. Sin Kokoro (ADR 0020).',
  },
  {
    id: 'memory',
    label: 'Memoria',
    active: 'LettaMemory',
    fallbacks: ['LocalMemory'],
    status: 'pendiente',
    note: 'Letta (Docker) con LocalMemory SQLite como fallback.',
  },
  {
    id: 'avatar',
    label: 'Avatar',
    active: 'Live2DAvatar',
    status: 'pendiente',
    note: 'Hasta entonces, el orbe del cliente sirve como placeholder.',
  },
] as const;

export function ModulesScreen(): JSX.Element {
  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>Módulos</h1>
        <p className={styles.subtitle}>
          Cada slot del cerebro tiene una implementación activa y, opcionalmente, una cadena de
          fallbacks. Editor funcional post-MVP — por ahora, vista de solo lectura de{' '}
          <code>config/modules.config.yaml</code>.
        </p>
      </header>

      <ul className={styles.list}>
        {SLOTS.map((s) => (
          <li key={s.id} className={styles.slot}>
            <div className={styles.slotHead}>
              <span className={styles.label}>{s.label}</span>
              <span className={`${styles.badge} ${styles[`badge-${s.status}`] ?? ''}`}>
                {s.status}
              </span>
            </div>
            <div className={styles.active}>{s.active}</div>
            {s.fallbacks && (
              <div className={styles.fallbacks}>
                fallback →{' '}
                {s.fallbacks.map((f, i) => (
                  <span key={f} className={styles.tag}>
                    {f}
                    {i < s.fallbacks!.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </div>
            )}
            <p className={styles.note}>{s.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
