/* screen-onboarding.jsx — first-time setup wizard */

const { useState: useOnbS } = React;

function OnboardingScreen({ onDone }) {
  const [step, setStep] = useOnbS(0);
  const [choices, setChoices] = useOnbS({
    llm: "hybrid",
    voiceMode: "vad",
    tts: "elevenlabs",
    memory: "letta",
  });

  const setC = (k, v) => setChoices({ ...choices, [k]: v });

  const steps = [
    {
      title: "Hola, soy Shiro.",
      sub: "Antes de que charlemos, configurá algunas cosas. Te tomo cinco minutos.",
      content: (
        <div style={{ display: "flex", justifyContent: "center", margin: "24px 0 40px" }}>
          <Orb emotion="alegre" speaking={false} listening={false} size={220} />
        </div>
      ),
    },
    {
      title: "¿Qué LLM querés usar?",
      sub: "Podés cambiarlo después, o usar ambos con un router híbrido.",
      content: (
        <div className="onb-card-grid">
          <OnbChoice id="local" selected={choices.llm === "local"} onClick={() => setC("llm", "local")}
            badge="Gratis · Privado" title="Solo local (Qwen 2.5)" desc="Corre 100% en tu máquina con Ollama. Necesita GPU." />
          <OnbChoice id="cloud" selected={choices.llm === "cloud"} onClick={() => setC("llm", "cloud")}
            badge="$10-20 / mes" title="Solo cloud (Claude)" desc="Calidad máxima, requiere API key de Anthropic." />
          <OnbChoice id="hybrid" selected={choices.llm === "hybrid"} onClick={() => setC("llm", "hybrid")}
            badge="Recomendado" title="Híbrido" desc="El router decide. Local para charla simple, Claude para tareas complejas." />
        </div>
      ),
    },
    {
      title: "¿Cómo querés hablarle?",
      sub: "Cambiá entre los tres modos cuando quieras desde el dock.",
      content: (
        <div className="onb-card-grid">
          <OnbChoice id="push" selected={choices.voiceMode === "push"} onClick={() => setC("voiceMode", "push")}
            badge="Más control" title="Push-to-talk" desc="Mantenés un botón presionado mientras hablás. Sin sorpresas." />
          <OnbChoice id="vad" selected={choices.voiceMode === "vad"} onClick={() => setC("voiceMode", "vad")}
            badge="Más natural" title="Always-on (VAD)" desc="Detecta automáticamente cuando empezás y terminás de hablar." />
          <OnbChoice id="toggle" selected={choices.voiceMode === "toggle"} onClick={() => setC("voiceMode", "toggle")}
            badge="Manual" title="Toggle" desc="Click para empezar, click para parar. Como un walkie-talkie." />
        </div>
      ),
    },
    {
      title: "¿Qué voz para Shiro?",
      sub: "ElevenLabs es la de mejor calidad. Kokoro funciona offline.",
      content: (
        <div className="onb-card-grid">
          <OnbChoice id="elevenlabs" selected={choices.tts === "elevenlabs"} onClick={() => setC("tts", "elevenlabs")}
            badge="Mejor calidad" title="ElevenLabs" desc="Voz natural con emociones. Requiere suscripción ($11/mes)." />
          <OnbChoice id="kokoro" selected={choices.tts === "kokoro"} onClick={() => setC("tts", "kokoro")}
            badge="Offline" title="Kokoro" desc="Síntesis local. Sin costos, sin internet. Calidad decente." />
          <OnbChoice id="system" selected={choices.tts === "system"} onClick={() => setC("tts", "system")}
            badge="Fallback" title="System TTS" desc="La voz de tu sistema operativo. Para emergencias." />
        </div>
      ),
    },
    {
      title: "Una última cosa: memoria.",
      sub: "Para que Shiro recuerde lo que hablamos entre sesiones.",
      content: (
        <div className="onb-card-grid">
          <OnbChoice id="letta" selected={choices.memory === "letta"} onClick={() => setC("memory", "letta")}
            badge="Recomendado" title="Letta (Docker)" desc="Memoria a largo plazo con vectores. Mejor recuerdo contextual." />
          <OnbChoice id="local" selected={choices.memory === "local"} onClick={() => setC("memory", "local")}
            badge="Sin dependencias" title="LocalMemory" desc="SQLite local. Sin Docker. Más simple, menos potente." />
        </div>
      ),
    },
    {
      title: "Listo.",
      sub: "Te llevo a la conversación. Podés cambiar todo desde Módulos.",
      content: (
        <div style={{ display: "flex", justifyContent: "center", margin: "24px 0 32px" }}>
          <Orb emotion="alegre" speaking={false} listening={false} size={220} />
        </div>
      ),
      isLast: true,
    },
  ];

  const s = steps[step];

  return (
    <div className="onboarding">
      <div className="onb-progress">
        {steps.map((_, i) => (
          <div key={i} className={`onb-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`} />
        ))}
      </div>

      <h1 className="onb-title">{s.title}</h1>
      <div className="onb-sub">{s.sub}</div>

      {s.content}

      <div className="onb-actions">
        {step > 0 && (
          <button className="btn ghost" onClick={() => setStep(step - 1)}>Atrás</button>
        )}
        {s.isLast ? (
          <button className="btn" onClick={onDone}>Empezar a charlar {Icon.arrow}</button>
        ) : (
          <button className="btn" onClick={() => setStep(step + 1)}>
            {step === 0 ? "Empezar" : "Siguiente"} {Icon.arrow}
          </button>
        )}
      </div>
    </div>
  );
}

function OnbChoice({ id, selected, onClick, badge, title, desc }) {
  return (
    <div className={`onb-choice ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="onb-choice-badge">{badge}</div>
      <div className="onb-choice-title">{title}</div>
      <div className="onb-choice-desc">{desc}</div>
    </div>
  );
}

window.OnboardingScreen = OnboardingScreen;
