/**
 * SetupScreen — onboarding y atajos de teclado.
 *
 * Por ahora muestra los atajos previstos y un placeholder del wizard
 * de primer arranque. El wizard real (instalar Ollama, pedir API key,
 * elegir voz) llega cuando hagan falta módulos reales.
 */

import styles from './SetupScreen.module.css';

interface Shortcut {
  keys: readonly string[];
  desc: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['Space'], desc: 'Mantener para hablar (push-to-talk)' },
  { keys: ['M'], desc: 'Alternar micrófono (toggle)' },
  { keys: ['Cmd', '/'], desc: 'Mostrar/ocultar chat' },
  { keys: ['Cmd', 'D'], desc: 'Panel de diagnóstico' },
  { keys: ['Cmd', 'Shift', 'O'], desc: 'Modo overlay flotante' },
  { keys: ['Esc'], desc: 'Cancelar / salir de overlay' },
] as const;

export function SetupScreen(): JSX.Element {
  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>Setup</h1>
        <p className={styles.subtitle}>
          Configuración inicial y referencia de atajos. El wizard de onboarding completo llegará
          cuando haya módulos reales que configurar.
        </p>
      </header>

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

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Próximos pasos</h2>
        <ol className={styles.steps}>
          <li>Instalar Ollama y descargar el modelo Qwen 2.5 (hito LLM).</li>
          <li>
            Configurar API key de Anthropic en <code>.env</code> (hito LLM).
          </li>
          <li>Levantar Letta vía Docker (hito Memoria).</li>
          <li>Levantar microservicio faster-whisper (hito STT).</li>
          <li>
            API key de ElevenLabs en <code>.env</code> (hito TTS).
          </li>
          <li>Descargar modelo Live2D y Cubism SDK (hito Avatar Live2D).</li>
        </ol>
      </div>
    </div>
  );
}
