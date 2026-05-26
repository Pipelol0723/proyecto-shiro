/* Orb.jsx — The animated avatar placeholder
   - Liquid metaball look with SVG + Gaussian blur filter
   - Reacts to emotion (color shift) and speaking state (amplitude pulse)
   - Idle breathing animation
*/

const { useEffect, useRef, useState } = React;

const EMOTION_COLORS = {
  neutral:    { primary: "var(--neutral-color)",    secondary: "var(--accent-2)" },
  alegre:     { primary: "var(--alegre-color)",     secondary: "var(--accent)" },
  pensativa:  { primary: "var(--pensativa-color)",  secondary: "var(--accent)" },
  sorprendida:{ primary: "var(--sorprendida-color)",secondary: "var(--accent-2)" },
};

function Orb({ emotion = "neutral", speaking = false, listening = false, thinking = false, size = 280 }) {
  const [amp, setAmp] = useState(0);
  const rafRef = useRef();
  const tRef = useRef(0);

  // Fake audio amplitude when speaking
  useEffect(() => {
    if (!speaking && !listening) {
      setAmp(0);
      return;
    }
    const tick = () => {
      tRef.current += 0.06;
      // Layered sine waves to feel organic
      const t = tRef.current;
      const v = (Math.sin(t * 2.1) * 0.5 + Math.sin(t * 3.7) * 0.3 + Math.sin(t * 5.3) * 0.2) * 0.5 + 0.5;
      const scaled = Math.max(0, Math.min(1, v * (speaking ? 1 : 0.5)));
      setAmp(scaled);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [speaking, listening]);

  const colors = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral;
  const scale = 1 + amp * 0.08;
  const haloScale = 1 + amp * 0.15;

  return (
    <div className={`orb-wrap ${speaking ? "is-speaking" : ""} ${listening ? "is-listening" : ""} ${thinking ? "is-thinking" : ""} emotion-${emotion}`}
         style={{ width: size, height: size }}>

      {/* Outer halo */}
      <div className="orb-halo" style={{
        background: `radial-gradient(circle, ${getComputedCssVar(colors.primary)} 0%, transparent 65%)`,
        transform: `scale(${haloScale})`,
      }} />

      {/* Ring orbits */}
      <svg className="orb-rings" viewBox="0 0 300 300">
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={`var(${colors.primary.replace("var(","").replace(")","")})`} stopOpacity="0.6" />
            <stop offset="100%" stopColor={`var(${colors.secondary.replace("var(","").replace(")","")})`} stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="150" cy="150" r="120" fill="none" stroke="url(#ringGrad)" strokeWidth="1" strokeDasharray="2 4" className="ring-1" />
        <circle cx="150" cy="150" r="135" fill="none" stroke="url(#ringGrad)" strokeWidth="0.5" strokeDasharray="1 6" className="ring-2" />
      </svg>

      {/* Metaball orb */}
      <svg className="orb-svg" viewBox="0 0 300 300" style={{ transform: `scale(${scale})` }}>
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix in="blur" mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
          <radialGradient id="orbGrad" cx="35%" cy="30%">
            <stop offset="0%" stopColor="white" stopOpacity="0.9" />
            <stop offset="40%" stopColor={`var(${colors.primary.replace("var(","").replace(")","")})`} stopOpacity="1" />
            <stop offset="100%" stopColor={`var(${colors.secondary.replace("var(","").replace(")","")})`} stopOpacity="1" />
          </radialGradient>
        </defs>
        <g filter="url(#goo)">
          <circle cx="150" cy="150" r="80" fill="url(#orbGrad)" className="orb-main" />
          <circle cx="150" cy="150" r="28" fill={`var(${colors.primary.replace("var(","").replace(")","")})`} className="orb-blob orb-blob-a" />
          <circle cx="150" cy="150" r="22" fill={`var(${colors.secondary.replace("var(","").replace(")","")})`} className="orb-blob orb-blob-b" />
          <circle cx="150" cy="150" r="18" fill={`var(${colors.primary.replace("var(","").replace(")","")})`} className="orb-blob orb-blob-c" />
        </g>
        {/* Highlight */}
        <ellipse cx="120" cy="115" rx="32" ry="20" fill="white" opacity="0.35" filter="blur(8px)" className="orb-highlight" />
      </svg>

      {/* Particles when thinking */}
      {thinking && (
        <div className="orb-particles">
          {[...Array(8)].map((_, i) => (
            <span key={i} className="particle" style={{
              "--i": i,
              "--n": 8,
              background: `var(${colors.primary.replace("var(","").replace(")","")})`,
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// Helper to resolve CSS var (used only for inline gradient string fallback)
function getComputedCssVar(v) { return v; }

// Inject orb-specific styles once
(function injectOrbStyles() {
  if (document.getElementById("__orb_styles")) return;
  const css = `
    .orb-wrap {
      position: relative;
      display: grid;
      place-items: center;
      isolation: isolate;
    }
    .orb-halo {
      position: absolute;
      inset: -30%;
      border-radius: 50%;
      opacity: 0.55;
      filter: blur(40px);
      transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 0;
    }
    .orb-wrap.is-speaking .orb-halo { opacity: 0.75; }
    .orb-rings {
      position: absolute;
      inset: -10%;
      width: 120%;
      height: 120%;
      z-index: 1;
      animation: orb-rotate 24s linear infinite;
    }
    .ring-2 { animation: orb-rotate 36s linear infinite reverse; transform-origin: center; }
    @keyframes orb-rotate {
      to { transform: rotate(360deg); }
    }
    .orb-svg {
      width: 100%; height: 100%;
      position: relative;
      z-index: 2;
      transition: transform 80ms linear;
      animation: orb-breath 5s ease-in-out infinite;
    }
    @keyframes orb-breath {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.08); }
    }
    .orb-blob { transform-origin: 150px 150px; }
    .orb-blob-a { animation: orb-orbit-a 7s ease-in-out infinite; }
    .orb-blob-b { animation: orb-orbit-b 9s ease-in-out infinite; }
    .orb-blob-c { animation: orb-orbit-c 11s ease-in-out infinite; }

    @keyframes orb-orbit-a {
      0%   { transform: translate( 30px, -20px); }
      50%  { transform: translate(-25px,  30px); }
      100% { transform: translate( 30px, -20px); }
    }
    @keyframes orb-orbit-b {
      0%   { transform: translate(-30px,  10px); }
      50%  { transform: translate( 20px, -30px); }
      100% { transform: translate(-30px,  10px); }
    }
    @keyframes orb-orbit-c {
      0%   { transform: translate(  0px, 30px); }
      50%  { transform: translate( 20px, -10px); }
      100% { transform: translate(  0px, 30px); }
    }

    .orb-highlight {
      transition: opacity 200ms;
    }

    /* Listening tint */
    .orb-wrap.is-listening .orb-rings { animation-duration: 8s; }
    .orb-wrap.is-speaking .orb-svg { animation-duration: 2s; }

    /* Particles */
    .orb-particles {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 3;
    }
    .particle {
      position: absolute;
      left: 50%; top: 50%;
      width: 6px; height: 6px;
      border-radius: 50%;
      opacity: 0.7;
      filter: blur(1px);
      animation: particle-orbit 3.5s linear infinite;
      animation-delay: calc(var(--i) * -0.4s);
      transform-origin: 0 0;
    }
    @keyframes particle-orbit {
      0%   { transform: rotate(calc(var(--i) / var(--n) * 360deg)) translateX(140px) scale(0.6); opacity: 0; }
      20%  { opacity: 0.9; }
      80%  { opacity: 0.9; }
      100% { transform: rotate(calc(var(--i) / var(--n) * 360deg + 360deg)) translateX(140px) scale(0.6); opacity: 0; }
    }

    /* Cyber theme orb tweaks */
    .theme-cyber .orb-halo { filter: blur(60px); opacity: 0.6; }
    .theme-editorial .orb-halo { opacity: 0.35; }
    .theme-editorial .orb-rings { display: none; }
  `;
  const tag = document.createElement("style");
  tag.id = "__orb_styles";
  tag.textContent = css;
  document.head.appendChild(tag);
})();

window.Orb = Orb;
