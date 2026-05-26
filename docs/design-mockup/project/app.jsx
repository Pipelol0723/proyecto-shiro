/* app.jsx — Root: sidebar nav, diagnostic panel, state machine, screen switcher */

const { useReducer, useEffect: useAppEffect, useState: useAppS } = React;

const INITIAL_STATE = {
  emotion: "neutral",
  speaking: false,
  listening: false,
  thinking: false,
  routedTo: null, // "local" | "cloud"
  sttLive: "",
  subtitle: "",
  draftText: "",
  inputMode: "vad",
  micHeld: false,
  history: [], // { role: "user"|"shiro", text, emotion?, routedTo?, latencyMs?, ts }
  log: [
    { ts: "00:00:01", ev: "boot", txt: "EventBus initialized" },
    { ts: "00:00:01", ev: "load", txt: "ModuleLoader: 7/7 modules ready" },
    { ts: "00:00:02", ev: "ok",   txt: "Character loaded: Shiro" },
  ],
};

function reducer(s, a) {
  switch (a.type) {
    case "LISTEN_START":
      return { ...s, listening: true, sttLive: "", subtitle: "", log: pushLog(s.log, "stt", "Listening…") };
    case "STT_PARTIAL":
      return { ...s, sttLive: a.text };
    case "STT_FINAL": {
      const userMsg = { role: "user", text: a.text, ts: Date.now() };
      return {
        ...s,
        listening: false,
        sttLive: "",
        subtitle: "",
        history: [...s.history, userMsg],
        log: pushLog(s.log, "stt", `final: "${a.text.slice(0, 40)}${a.text.length > 40 ? "…" : ""}"`),
      };
    }
    case "USER_TEXT": {
      const userMsg = { role: "user", text: a.text, ts: Date.now() };
      return { ...s, history: [...s.history, userMsg], log: pushLog(s.log, "user", a.text.slice(0, 40)) };
    }
    case "DRAFT":
      return { ...s, draftText: a.text };
    case "THINK_START":
      return {
        ...s,
        thinking: true,
        routedTo: a.routedTo,
        log: pushLog(s.log, "router", `→ ${a.routedTo === "cloud" ? "AnthropicLLM" : "OllamaLLM"}`),
      };
    case "SHIRO_REPLY": {
      const msg = { role: "shiro", text: a.text, emotion: a.emotion, routedTo: a.routedTo, latencyMs: a.latencyMs, ts: Date.now() };
      return {
        ...s,
        thinking: false,
        speaking: true,
        emotion: a.emotion,
        subtitle: a.text,
        history: [...s.history, msg],
        log: pushLog(s.log, a.routedTo === "cloud" ? "cloud" : "local", `reply ${a.latencyMs}ms · ${a.emotion}`),
      };
    }
    case "SPEAK_END":
      return { ...s, speaking: false, subtitle: "" };
    case "SET_INPUT_MODE":
      return { ...s, inputMode: a.mode, log: pushLog(s.log, "cfg", `input mode → ${a.mode}`) };
    case "SET_EMOTION":
      return { ...s, emotion: a.emotion };
    case "RESET":
      return INITIAL_STATE;
    default:
      return s;
  }
}

function pushLog(log, ev, txt) {
  const d = new Date();
  const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return [...log, { ts, ev, txt }].slice(-40);
}
function pad(n) { return String(n).padStart(2, "0"); }

const SCREENS = [
  { id: "chat",      label: "Conversación", icon: Icon.chat },
  { id: "modules",   label: "Módulos",      icon: Icon.modules },
  { id: "character", label: "Personaje",    icon: Icon.character },
  { id: "avatar",    label: "Avatar",       icon: Icon.avatar },
  { id: "setup",     label: "Setup",        icon: Icon.setup },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "kawaii",
  "showChat": true,
  "showDiag": false,
  "overlayMode": false
}/*EDITMODE-END*/;

function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [screen, setScreen] = useAppS("chat");
  const [showOnb, setShowOnb] = useAppS(false);
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply theme class to body
  useAppEffect(() => {
    document.body.className = `theme-${tweaks.theme}`;
  }, [tweaks.theme]);

  // Keyboard shortcuts
  useAppEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "m" || e.key === "M") {
        // toggle mic
      }
      if (e.key === " ") {
        // push-to-talk
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (showOnb) {
    return (
      <div className="app">
        <div className="main">
          <OnboardingScreen onDone={() => setShowOnb(false)} />
        </div>
      </div>
    );
  }

  const overlay = tweaks.overlayMode;
  const hasChat = tweaks.showChat;
  const hasDiag = tweaks.showDiag && !overlay;

  return (
    <div className={`app ${hasDiag ? "has-diag" : ""} ${overlay ? "overlay-mode" : ""}`}>
      <div className="overlay-bezel" />
      <Sidebar screen={screen} setScreen={setScreen} setShowOnb={setShowOnb} />

      <div className="main">
        <Header screen={screen} tweaks={tweaks} setTweak={setTweak} state={state} />
        {screen === "chat" && (
          <ConversationScreen
            tweaks={tweaks}
            setTweak={setTweak}
            state={state}
            dispatch={dispatch}
          />
        )}
        {screen === "modules" && <ModulesScreen />}
        {screen === "character" && <CharacterScreen />}
        {screen === "avatar" && <AvatarLoaderScreen />}
        {screen === "setup" && (
          <div className="screen">
            <h1 className="screen-title">Setup</h1>
            <p className="screen-subtitle">¿Querés rehacer el onboarding? Útil si vas a cambiar de proveedor.</p>
            <button className="btn" onClick={() => setShowOnb(true)}>Abrir wizard de onboarding</button>
            <div style={{ marginTop: 36 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Atajos de teclado</h2>
              <div className="slot-list" style={{ maxWidth: 480 }}>
                <div className="slot">
                  <ShortcutRow keys={["Space"]} desc="Mantener para hablar (push-to-talk)" />
                  <ShortcutRow keys={["M"]} desc="Alternar micrófono (toggle)" />
                  <ShortcutRow keys={["Cmd", "/"]} desc="Mostrar/ocultar chat" />
                  <ShortcutRow keys={["Cmd", "D"]} desc="Panel de diagnóstico" />
                  <ShortcutRow keys={["Cmd", "Shift", "O"]} desc="Modo overlay" />
                  <ShortcutRow keys={["Esc"]} desc="Cancelar / salir de overlay" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {hasDiag && <DiagPanel state={state} />}

      {/* Tweaks panel */}
      <ShiroTweaksPanel tweaks={tweaks} setTweak={setTweak} dispatch={dispatch} state={state} />
    </div>
  );
}

function Sidebar({ screen, setScreen, setShowOnb }) {
  return (
    <div className="sidebar">
      <div className="sidebar-logo" title="Shiro" />
      {SCREENS.map((s) => (
        <button
          key={s.id}
          className={`nav-item ${screen === s.id ? "active" : ""}`}
          onClick={() => s.id === "setup" ? setScreen(s.id) : setScreen(s.id)}
          title={s.label}
        >
          {s.icon}
          <span className="nav-label">{s.label}</span>
        </button>
      ))}
      <div className="sidebar-spacer" />
    </div>
  );
}

function Header({ screen, tweaks, setTweak, state }) {
  const screenObj = SCREENS.find((s) => s.id === screen);
  return (
    <div className="header">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span className="header-title">Shiro</span>
        <span style={{ color: "var(--ink-faint)", fontSize: 14 }}>/</span>
        <span style={{ color: "var(--ink-mute)", fontSize: 14 }}>{screenObj?.label}</span>
      </div>
      <div className="header-tools">
        {screen === "chat" && (
          <>
            <span className="chip">
              <span className="chip-dot live"></span>
              Ollama
            </span>
            <span className="chip" style={{ opacity: 0.7 }}>
              <span className="chip-dot"></span>
              Claude
            </span>
            <span className="chip" style={{ opacity: 0.7 }}>
              <span className="chip-dot"></span>
              Letta
            </span>
            <div style={{ width: 1, height: 20, background: "var(--surface-border)", margin: "0 4px" }} />
            <button
              className={`icon-btn ${tweaks.showChat ? "active" : ""}`}
              title="Toggle chat panel"
              onClick={() => setTweak("showChat", !tweaks.showChat)}
            >
              {Icon.panel}
            </button>
            <button
              className={`icon-btn ${tweaks.showDiag ? "active" : ""}`}
              title="Toggle diagnostic panel"
              onClick={() => setTweak("showDiag", !tweaks.showDiag)}
            >
              {Icon.diag}
            </button>
            <button
              className={`icon-btn ${tweaks.overlayMode ? "active" : ""}`}
              title="Modo overlay flotante"
              onClick={() => setTweak("overlayMode", !tweaks.overlayMode)}
            >
              {Icon.overlay}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DiagPanel({ state }) {
  // Fake metrics
  const cpu = 18 + Math.round(Math.sin(Date.now() / 600) * 8);
  const gpu = state.thinking ? 78 + Math.round(Math.sin(Date.now()/300) * 12) : 22;
  const ram = 11.2;
  const lastLatency = [...state.history].reverse().find(m => m.latencyMs)?.latencyMs;

  return (
    <div className="diag-panel">
      <div className="diag-section">
        <div className="diag-title">Status</div>
        <div className="diag-row"><span>EventBus</span><span className="diag-val ok">● running</span></div>
        <div className="diag-row"><span>Orchestrator</span><span className="diag-val ok">● ready</span></div>
        <div className="diag-row"><span>Ollama (Qwen 2.5:7b)</span><span className="diag-val ok">● online</span></div>
        <div className="diag-row"><span>Whisper service</span><span className="diag-val ok">● :8765</span></div>
        <div className="diag-row"><span>Letta</span><span className="diag-val warn">● fallback</span></div>
        <div className="diag-row"><span>ElevenLabs</span><span className="diag-val ok">● 487 chars left</span></div>
      </div>

      <div className="diag-section">
        <div className="diag-title">Recursos</div>
        <div className="diag-row">
          <span>CPU</span>
          <div className="diag-bar" style={{ flex: 1, marginLeft: 10 }}>
            <div className="diag-bar-track"><div className="diag-bar-fill" style={{ width: `${cpu}%` }} /></div>
            <span className="diag-val" style={{ minWidth: 36, textAlign: "right" }}>{cpu}%</span>
          </div>
        </div>
        <div className="diag-row">
          <span>GPU</span>
          <div className="diag-bar" style={{ flex: 1, marginLeft: 10 }}>
            <div className="diag-bar-track"><div className="diag-bar-fill" style={{ width: `${gpu}%`, background: state.thinking ? "var(--accent-2)" : "var(--accent)" }} /></div>
            <span className="diag-val" style={{ minWidth: 36, textAlign: "right" }}>{gpu}%</span>
          </div>
        </div>
        <div className="diag-row"><span>VRAM</span><span className="diag-val">{ram} / 16 GB</span></div>
      </div>

      <div className="diag-section">
        <div className="diag-title">Última respuesta</div>
        <div className="diag-row"><span>Routed to</span><span className="diag-val">{state.routedTo || "—"}</span></div>
        <div className="diag-row"><span>Latencia</span><span className="diag-val">{lastLatency ? `${lastLatency}ms` : "—"}</span></div>
        <div className="diag-row"><span>Emoción</span><span className="diag-val">{state.emotion}</span></div>
      </div>

      <div className="diag-section">
        <div className="diag-title">Event log</div>
        <div className="diag-log">
          {state.log.map((l, i) => (
            <div key={i}>
              <span className="ts">[{l.ts}]</span>{" "}
              <span className="ev">{l.ev}</span>{" "}
              <span>{l.txt}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ keys, desc }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px dashed var(--surface-border)" }}>
      <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>{desc}</span>
      <span style={{ display: "flex", gap: 4 }}>
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            <span className="kbd">{k}</span>
            {i < keys.length - 1 && <span style={{ color: "var(--ink-faint)" }}>+</span>}
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}

/* ============ Tweaks panel (custom — wraps starter) ============ */

function ShiroTweaksPanel({ tweaks, setTweak, dispatch, state }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Tema visual">
        <TweakSelect
          label="Estilo"
          value={tweaks.theme}
          onChange={(v) => setTweak("theme", v)}
          options={[
            { value: "kawaii",    label: "Kawaii pastel" },
            { value: "cyber",     label: "Cyberpunk" },
            { value: "editorial", label: "Editorial" },
          ]}
        />
      </TweakSection>

      <TweakSection label="Layout">
        <TweakToggle label="Modo overlay" value={tweaks.overlayMode} onChange={(v) => setTweak("overlayMode", v)} />
        <TweakToggle label="Chat panel" value={tweaks.showChat} onChange={(v) => setTweak("showChat", v)} />
        <TweakToggle label="Diagnóstico" value={tweaks.showDiag} onChange={(v) => setTweak("showDiag", v)} />
      </TweakSection>

      <TweakSection label="Probar emoción del orbe">
        <TweakSelect
          label="Emoción"
          value={state.emotion}
          onChange={(v) => dispatch({ type: "SET_EMOTION", emotion: v })}
          options={[
            { value: "neutral",     label: "Neutral" },
            { value: "alegre",      label: "Alegre" },
            { value: "pensativa",   label: "Pensativa" },
            { value: "sorprendida", label: "Sorprendida" },
          ]}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
