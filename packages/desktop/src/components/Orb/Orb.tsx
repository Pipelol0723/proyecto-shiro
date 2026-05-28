/**
 * Orb — placeholder visual del avatar (ADR 0009).
 *
 * SVG metaball animado que reacciona a 4 estados del companion:
 * - emotion: gradiente de color (neutral/divertida/pensativa/molesta/vulnerable).
 * - speaking: amplitud pulsante (escala el SVG con la "voz").
 * - listening: anillos giran más rápido + halo más intenso.
 * - thinking: partículas orbitando alrededor del orb.
 *
 * Smart container: no se suscribe al EventBus directamente. Recibe todo
 * por props. El conector vivirá en `ConversationScreen` (PR C).
 *
 * Composición del SVG (de fondo a frente):
 * 1. `.halo` — gradiente radial difuminado con CSS, escala con amplitud.
 * 2. `.rings` — dos círculos SVG con stroke gradient que rotan.
 * 3. `.svg` — el orb principal con filtro Gaussian blur ("goo"), 4 blobs
 *    internos orbitando, y un highlight blanco difuminado.
 * 4. `.particles` — 8 partículas absolutas orbitando, solo si `thinking`.
 *
 * El filtro `feGaussianBlur` + `feColorMatrix` produce el efecto metaball:
 * los blobs cercanos se "fusionan" visualmente como gotas de mercurio.
 */

import { useOrbAmplitude } from './useOrbAmplitude';
import type { Emotion, OrbProps } from './types';
import styles from './Orb.module.css';

const EMOTION_TO_VAR: Record<Emotion, string> = {
  neutral: '--neutral-color',
  divertida: '--divertida-color',
  pensativa: '--pensativa-color',
  molesta: '--molesta-color',
  vulnerable: '--vulnerable-color',
};

export function Orb(props: OrbProps): JSX.Element {
  const {
    emotion = 'neutral',
    speaking = false,
    listening = false,
    thinking = false,
    size = 280,
  } = props;

  const amp = useOrbAmplitude({ speaking, listening });

  // Escalas derivadas de la amplitud — sutil para no marear.
  const scale = 1 + amp * 0.08;
  const haloScale = 1 + amp * 0.15;

  const colorVar = EMOTION_TO_VAR[emotion];
  // Estilos dinámicos: solo lo que cambia por render (color/escala).
  // El resto vive en CSS Module para que el navegador lo cachee.
  const orbStyle = {
    width: size,
    height: size,
    '--orb-primary': `var(${colorVar})`,
  } as React.CSSProperties;

  const wrapClass = [
    styles.wrap,
    speaking && styles.isSpeaking,
    listening && styles.isListening,
    thinking && styles.isThinking,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapClass} style={orbStyle} data-emotion={emotion}>
      {/* Halo exterior — gradiente radial difuminado con CSS */}
      <div
        className={styles.halo}
        style={{
          transform: `scale(${haloScale.toString()})`,
        }}
      />

      {/* Anillos giratorios */}
      <svg className={styles.rings} viewBox="0 0 300 300" aria-hidden="true">
        <defs>
          <linearGradient id="orb-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--orb-primary)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle
          cx="150"
          cy="150"
          r="120"
          fill="none"
          stroke="url(#orb-ring-gradient)"
          strokeWidth="1"
          strokeDasharray="2 4"
          className={styles.ring1}
        />
        <circle
          cx="150"
          cy="150"
          r="135"
          fill="none"
          stroke="url(#orb-ring-gradient)"
          strokeWidth="0.5"
          strokeDasharray="1 6"
          className={styles.ring2}
        />
      </svg>

      {/* Orb principal — SVG metaball con filtro Gaussian blur */}
      <svg
        className={styles.svg}
        viewBox="0 0 300 300"
        style={{ transform: `scale(${scale.toString()})` }}
        aria-hidden="true"
      >
        <defs>
          <filter id="orb-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          <radialGradient id="orb-radial" cx="35%" cy="30%">
            <stop offset="0%" stopColor="white" stopOpacity="0.9" />
            <stop offset="40%" stopColor="var(--orb-primary)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="1" />
          </radialGradient>
        </defs>
        <g filter="url(#orb-goo)">
          <circle cx="150" cy="150" r="80" fill="url(#orb-radial)" className={styles.orbMain} />
          <circle
            cx="150"
            cy="150"
            r="28"
            fill="var(--orb-primary)"
            className={`${styles.orbBlob} ${styles.orbBlobA}`}
          />
          <circle
            cx="150"
            cy="150"
            r="22"
            fill="var(--accent-2)"
            className={`${styles.orbBlob} ${styles.orbBlobB}`}
          />
          <circle
            cx="150"
            cy="150"
            r="18"
            fill="var(--orb-primary)"
            className={`${styles.orbBlob} ${styles.orbBlobC}`}
          />
        </g>
        {/* Highlight blanco difuminado — da sensación de superficie reflectiva */}
        <ellipse
          cx="120"
          cy="115"
          rx="32"
          ry="20"
          fill="white"
          opacity="0.35"
          className={styles.highlight}
        />
      </svg>

      {/* Partículas — solo durante thinking */}
      {thinking && (
        <div className={styles.particles} aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className={styles.particle}
              style={
                {
                  '--i': i,
                  '--n': 8,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
