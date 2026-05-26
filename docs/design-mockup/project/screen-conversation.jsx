/* screen-conversation.jsx — main conversation surface */

const { useState, useEffect, useRef } = React;

// Fake responses Shiro might give, keyed by trigger keywords
const SAMPLE_FLOW = [
  {
    userInput: "Hola Shiro, ¿cómo estás?",
    emotion: "alegre",
    response: "¡Hola! Bien, gracias por preguntar. Acabo de terminar de procesar como tres podcasts de música electrónica que dejaste anoche. Tengo opiniones.",
    routedTo: "local",
    latencyMs: 820,
  },
  {
    userInput: "Explícame cómo funcionan los modelos de difusión",
    emotion: "pensativa",
    response: "Mmm, déjame pensarlo bien. Imagínate que tomás una imagen y le agregás ruido poco a poco hasta que es pura estática. El modelo aprende a hacer el camino inverso: dado ruido, predecir qué quitar para revelar una imagen coherente.",
    routedTo: "cloud",
    latencyMs: 1840,
  },
  {
    userInput: "¿Te acordás de lo que hablamos ayer?",
    emotion: "neutral",
    response: "Sí, claro. Estábamos viendo cómo estructurar el módulo de memoria. Decidiste empezar con LocalMemory para no depender de Docker desde el día uno. ¿Avanzaste algo?",
    routedTo: "local",
    latencyMs: 940,
  },
  {
    userInput: "¡Mirá lo que conseguí!",
    emotion: "sorprendida",
    response: "¿Qué?! Contame contame contame.",
    routedTo: "local",
    latencyMs: 620,
  },
];

function ConversationScreen({ tweaks, setTweak, state, dispatch }) {
  const {
    emotion, speaking, listening, thinking, sttLive, subtitle,
    history, inputMode, micHeld, draftText,
  } = state;

  const inputRef = useRef();

  // Simulated flow controller
  const runFlow = (entry) => {
    // STT phase
    dispatch({ type: "LISTEN_START" });
    const words = entry.userInput.split(" ");
    let i = 0;
    const sttInterval = setInterval(() => {
      i += 1;
      dispatch({ type: "STT_PARTIAL", text: words.slice(0, i).join(" ") });
      if (i >= words.length) {
        clearInterval(sttInterval);
        // STT done → router thinking
        setTimeout(() => {
          dispatch({ type: "STT_FINAL", text: entry.userInput });
          dispatch({ type: "THINK_START", routedTo: entry.routedTo });
          setTimeout(() => {
            // TTS speaking phase
            dispatch({ type: "SHIRO_REPLY", text: entry.response, emotion: entry.emotion, routedTo: entry.routedTo, latencyMs: entry.latencyMs });
            const dur = Math.max(2400, entry.response.length * 45);
            setTimeout(() => dispatch({ type: "SPEAK_END" }), dur);
          }, entry.routedTo === "cloud" ? 1400 : 700);
        }, 250);
      }
    }, 90);
  };

  const triggerRandomFlow = () => {
    const entry = SAMPLE_FLOW[Math.floor(Math.random() * SAMPLE_FLOW.length)];
    runFlow(entry);
  };

  const sendText = () => {
    if (!draftText.trim()) return;
    const entry = {
      userInput: draftText.trim(),
      response: matchResponseFor(draftText) || "Mmm, dejame pensar eso un segundo.",
      emotion: guessEmotion(draftText),
      routedTo: draftText.length > 40 ? "cloud" : "local",
      latencyMs: draftText.length > 40 ? 1800 : 850,
    };
    dispatch({ type: "USER_TEXT", text: entry.userInput });
    dispatch({ type: "DRAFT", text: "" });
    setTimeout(() => {
      dispatch({ type: "THINK_START", routedTo: entry.routedTo });
      setTimeout(() => {
        dispatch({ type: "SHIRO_REPLY", text: entry.response, emotion: entry.emotion, routedTo: entry.routedTo, latencyMs: entry.latencyMs });
        const dur = Math.max(2400, entry.response.length * 45);
        setTimeout(() => dispatch({ type: "SPEAK_END" }), dur);
      }, entry.routedTo === "cloud" ? 1300 : 700);
    }, 100);
  };

  // Latest shiro line for the bubble
  const latestShiro = [...history].reverse().find((m) => m.role === "shiro");

  return (
    <div className={`conversation ${tweaks.showChat ? "with-chat" : ""}`}>
      <div className="stage">
        {/* Floating speech bubble (latest Shiro line, if speaking) */}
        {speaking && latestShiro && (
          <div className="bubble-area">
            <div className="bubble">{latestShiro.text}</div>
          </div>
        )}

        {/* ORB */}
        <div className="orb-area">
          <Orb emotion={emotion} speaking={speaking} listening={listening} thinking={thinking} size={300} />

          {/* Emotion label or thinking */}
          {thinking ? (
            <div style={{ marginTop: 32 }}>
              <div className="thinking">
                <div className="thinking-dots"><span /><span /><span /></div>
                <span>Pensando con <strong style={{ color: "var(--accent)" }}>{state.routedTo === "cloud" ? "Claude Sonnet" : "Qwen 2.5"}</strong></span>
              </div>
            </div>
          ) : (
            <div className="emotion-label">{`— ${emotion}`}</div>
          )}
        </div>

        {/* Subtitle area */}
        <div className="subtitle-area">
          {listening && sttLive ? (
            <span className="live-stt">{sttLive}</span>
          ) : subtitle ? (
            <span>{subtitle}</span>
          ) : !speaking && !thinking ? (
            <span className="placeholder">
              Decile algo a Shiro, o presioná el micrófono para hablar
            </span>
          ) : null}
        </div>

        {/* Input dock with mode switcher above */}
        <div className="dock-wrap">
          <div className="mode-switch">
            {["push", "vad", "toggle"].map((m) => (
              <button key={m} className={inputMode === m ? "active" : ""} onClick={() => dispatch({ type: "SET_INPUT_MODE", mode: m })}>
                {m === "push" ? "Push-to-talk" : m === "vad" ? "Wake / VAD" : "Toggle"}
              </button>
            ))}
          </div>

          <div className={`dock ${listening ? "listening" : ""}`}>
            <input
              ref={inputRef}
              className="dock-input"
              type="text"
              placeholder={listening ? "Escuchando…" : "Escribí o usá el micrófono…"}
              value={draftText}
              onChange={(e) => dispatch({ type: "DRAFT", text: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
            />

            {draftText.trim() && (
              <button className="send-btn" onClick={sendText} title="Enviar (Enter)">
                {Icon.send}
              </button>
            )}

            <button
              className={`mic-btn ${listening ? "recording" : ""}`}
              title={inputMode === "push" ? "Mantené presionado para hablar" : "Click para empezar/parar"}
              onMouseDown={() => { if (inputMode === "push") triggerRandomFlow(); }}
              onClick={() => { if (inputMode !== "push") triggerRandomFlow(); }}
            >
              {Icon.micFilled}
            </button>
          </div>

          <div style={{ fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.04em", marginTop: 2 }}>
            {inputMode === "push" && <span><span className="kbd">Space</span> mantener para hablar</span>}
            {inputMode === "vad" && <span>Always-listening · VAD detecta el fin de frase</span>}
            {inputMode === "toggle" && <span><span className="kbd">M</span> alternar mic</span>}
          </div>
        </div>
      </div>

      {tweaks.showChat && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <span>Historial</span>
            <button className="icon-btn" onClick={() => setTweak("showChat", false)} title="Cerrar">
              {Icon.close}
            </button>
          </div>
          <div className="chat-list" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
            {history.length === 0 && (
              <div className="empty">No hay mensajes todavía.<br/>Empezá una conversación.</div>
            )}
            {history.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
                {m.role === "shiro" && m.routedTo && (
                  <div className="msg-meta">
                    <span className={`tag ${m.routedTo}`}>{m.routedTo === "cloud" ? "Claude" : "Qwen"}</span>
                    <span>{m.latencyMs}ms</span>
                    <span>· {m.emotion}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function matchResponseFor(text) {
  const t = text.toLowerCase();
  for (const e of SAMPLE_FLOW) {
    const k = e.userInput.toLowerCase().split(" ").slice(0, 2).join(" ");
    if (t.includes(k)) return e.response;
  }
  return null;
}

function guessEmotion(text) {
  const t = text.toLowerCase();
  if (/[!¡]|genial|wow|increíble|aweso|mirá/.test(t)) return "sorprendida";
  if (/jaja|haha|risa|chiste|gracioso|hola|cómo est/.test(t)) return "alegre";
  if (/por qué|cómo|expli|piensa|estrate|complicad/.test(t)) return "pensativa";
  return "neutral";
}

window.ConversationScreen = ConversationScreen;
