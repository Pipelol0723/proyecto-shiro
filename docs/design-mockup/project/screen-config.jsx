/* screen-config.jsx — Modules + Character + Avatar Loader screens */

const { useState: useS } = React;

/* ============ MODULES (YAML-as-UI) ============ */

const SLOTS = [
  {
    key: "llm",
    name: "LLM",
    desc: "Modelo de lenguaje. El router decide cuál usar por mensaje.",
    multi: true,
    sub: [
      {
        key: "local",
        label: "Local",
        impls: ["OllamaLLM"],
        fields: [
          { k: "model", label: "Model", val: "qwen2.5:7b" },
          { k: "host", label: "Host", val: "http://localhost:11434" },
          { k: "temperature", label: "Temperature", val: "0.7" },
        ],
      },
      {
        key: "cloud",
        label: "Cloud",
        impls: ["AnthropicLLM"],
        fields: [
          { k: "model", label: "Model", val: "claude-sonnet-4-6" },
          { k: "max_tokens", label: "Max tokens", val: "1024" },
          { k: "api_key", label: "API key", val: "ANTHROPIC_API_KEY (.env)", lock: true },
        ],
      },
    ],
  },
  {
    key: "router",
    name: "Router",
    desc: "Clasifica cada mensaje y decide LLM local vs cloud.",
    impls: ["HybridRouter"],
    fields: [
      { k: "classifier_model", label: "Classifier", val: "qwen2.5:7b" },
      { k: "cloud_threshold", label: "Cloud threshold", val: "0.6", type: "slider", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    key: "stt",
    name: "STT",
    desc: "Voz → texto. Microservicio Python con faster-whisper.",
    impls: ["WhisperSTT"],
    fields: [
      { k: "service_url", label: "Service URL", val: "http://localhost:8765" },
      { k: "language", label: "Language", val: "es" },
      { k: "vad_silence_ms", label: "VAD silence (ms)", val: "800" },
    ],
  },
  {
    key: "tts",
    name: "TTS",
    desc: "Texto → voz, con cadena de fallbacks si falla el primero.",
    impls: ["ElevenLabsTTS", "KokoroTTS", "SystemTTS"],
    fallback: ["KokoroTTS", "SystemTTS"],
    fields: [
      { k: "voice_id", label: "Voice ID", val: "" },
      { k: "model", label: "Model", val: "eleven_multilingual_v2" },
      { k: "stability", label: "Stability", val: "0.5", type: "slider", min: 0, max: 1, step: 0.05 },
      { k: "similarity_boost", label: "Similarity", val: "0.75", type: "slider", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    key: "memory",
    name: "Memory",
    desc: "Persistencia entre sesiones. Letta + LocalMemory de fallback.",
    impls: ["LettaMemory", "LocalMemory"],
    fallback: ["LocalMemory"],
    fields: [
      { k: "letta_url", label: "Letta URL", val: "http://localhost:8283" },
      { k: "local_db_path", label: "Local DB", val: "./data/memory.db" },
    ],
  },
  {
    key: "avatar",
    name: "Avatar",
    desc: "Render visual del companion. Live2D ahora, VRM a futuro.",
    impls: ["Live2DAvatar", "VRMAvatar"],
    fields: [
      { k: "model_path", label: "Model path", val: "./assets/avatars/default/model.model3.json" },
      { k: "idle_animation", label: "Idle animation", val: "true", type: "toggle" },
    ],
  },
];

function ModulesScreen() {
  const [data, setData] = useS(() => JSON.parse(JSON.stringify(SLOTS)));
  const [active, setActive] = useS({
    llm_local: "OllamaLLM",
    llm_cloud: "AnthropicLLM",
    router: "HybridRouter",
    stt: "WhisperSTT",
    tts: "ElevenLabsTTS",
    memory: "LettaMemory",
    avatar: "Live2DAvatar",
  });

  return (
    <div className="screen">
      <h1 className="screen-title">Módulos</h1>
      <p className="screen-subtitle">
        Cada slot es swap-eable sin tocar código. Lo que ves acá es <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)" }}>config/modules.config.yaml</code> en formato UI.
      </p>

      <div className="slot-list">
        {SLOTS.map((slot) => (
          <div key={slot.key} className="slot">
            <div className="slot-head">
              <div>
                <div className="slot-name">{slot.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>{slot.desc}</div>
              </div>
              {!slot.multi && (
                <div className="slot-impl-tabs">
                  {slot.impls.map((imp) => (
                    <button
                      key={imp}
                      className={`impl-tab ${active[slot.key] === imp ? "active" : ""}`}
                      onClick={() => setActive({ ...active, [slot.key]: imp })}
                    >
                      {imp}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {slot.multi ? (
              <div style={{ display: "grid", gap: 14 }}>
                {slot.sub.map((sub) => (
                  <div key={sub.key} style={{ background: "var(--surface-hover)", borderRadius: 10, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{sub.label}</span>
                      <div className="slot-impl-tabs">
                        {sub.impls.map((imp) => (
                          <button
                            key={imp}
                            className={`impl-tab ${active[`${slot.key}_${sub.key}`] === imp ? "active" : ""}`}
                            onClick={() => setActive({ ...active, [`${slot.key}_${sub.key}`]: imp })}
                          >
                            {imp}
                          </button>
                        ))}
                      </div>
                    </div>
                    <FieldGrid fields={sub.fields} />
                  </div>
                ))}
              </div>
            ) : (
              <FieldGrid fields={slot.fields} />
            )}

            {slot.fallback && (
              <div className="slot-fallback">
                <span>Si falla, cae a:</span>
                {slot.fallback.map((f, i) => (
                  <React.Fragment key={f}>
                    <span className="fb-chip">{f}</span>
                    {i < slot.fallback.length - 1 && <span>→</span>}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldGrid({ fields }) {
  return (
    <div className="slot-fields">
      {fields.map((f) => (
        <div className="slot-field" key={f.k}>
          <label>{f.label}</label>
          {f.type === "toggle" ? (
            <label className="toggle" style={{ marginTop: 4 }}>
              <input type="checkbox" defaultChecked={f.val === "true"} />
              <span className="slider"></span>
            </label>
          ) : f.type === "slider" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="range" min={f.min} max={f.max} step={f.step} defaultValue={f.val} style={{ flex: 1, accentColor: "var(--accent)" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", minWidth: 36 }}>{f.val}</span>
            </div>
          ) : (
            <input type="text" defaultValue={f.val} readOnly={f.lock} style={{ opacity: f.lock ? 0.6 : 1 }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ============ CHARACTER EDITOR ============ */

const DEFAULT_CHAR = {
  name: "Shiro",
  pronouns: "ella",
  age_apparent: "~20",
  origin: "AI Companion creada por su usuario",
  traits: ["curiosa", "cálida", "directa", "con sentido del humor"],
  speech_style: "natural, coloquial, en español neutro. Frases cortas. Evita formalismos.",
  likes: ["aprender cosas nuevas", "música electrónica", "café por la mañana"],
  dislikes: ["sonar como un asistente robótico", "respuestas con bullets sin necesidad", "corregir al usuario de forma condescendiente"],
  backstory: "Shiro es un AI companion personal. No finge ser humana, pero tampoco finge ser un \"asistente\". Es ella misma: una entidad con opiniones, curiosidad genuina y capacidad de discrepar amablemente.",
  greeting: "casual, mencionando algo de la última conversación si la hay",
  uncertainty: "lo admite sin rodeos y propone cómo averiguarlo",
};

function CharacterScreen() {
  const [c, setC] = useS(DEFAULT_CHAR);
  const upd = (k, v) => setC({ ...c, [k]: v });

  return (
    <div className="screen">
      <h1 className="screen-title">Personaje</h1>
      <p className="screen-subtitle">
        Estos campos se inyectan como system prompt en cada conversación. Edita la personalidad de Shiro.
      </p>

      <div className="char-form">
        <div className="char-field">
          <label>Nombre</label>
          <input value={c.name} onChange={(e) => upd("name", e.target.value)} />
        </div>
        <div className="char-field">
          <label>Pronombres</label>
          <input value={c.pronouns} onChange={(e) => upd("pronouns", e.target.value)} />
        </div>
        <div className="char-field">
          <label>Edad aparente</label>
          <input value={c.age_apparent} onChange={(e) => upd("age_apparent", e.target.value)} />
        </div>
        <div className="char-field">
          <label>Origen</label>
          <input value={c.origin} onChange={(e) => upd("origin", e.target.value)} />
        </div>

        <div className="char-field full">
          <label>Rasgos dominantes</label>
          <ChipList items={c.traits} onChange={(v) => upd("traits", v)} placeholder="agregar rasgo…" />
        </div>

        <div className="char-field full">
          <label>Estilo de habla</label>
          <textarea rows={2} value={c.speech_style} onChange={(e) => upd("speech_style", e.target.value)} />
        </div>

        <div className="char-field">
          <label>Le gusta</label>
          <ChipList items={c.likes} onChange={(v) => upd("likes", v)} placeholder="agregar…" />
        </div>
        <div className="char-field">
          <label>Evita</label>
          <ChipList items={c.dislikes} onChange={(v) => upd("dislikes", v)} placeholder="agregar…" />
        </div>

        <div className="char-field full">
          <label>Backstory</label>
          <textarea rows={4} value={c.backstory} onChange={(e) => upd("backstory", e.target.value)} />
        </div>

        <div className="char-field">
          <label>Estilo de saludo</label>
          <input value={c.greeting} onChange={(e) => upd("greeting", e.target.value)} />
        </div>
        <div className="char-field">
          <label>Frente a incertidumbre</label>
          <input value={c.uncertainty} onChange={(e) => upd("uncertainty", e.target.value)} />
        </div>

        {/* Emotion mapping */}
        <div className="char-field full" style={{ marginTop: 12 }}>
          <label>Mapeo de emociones → TTS + Avatar</label>
          <div className="emotion-grid">
            {[
              { name: "neutral",     color: "var(--neutral-color)",    stab: 0.5, expr: "idle" },
              { name: "alegre",      color: "var(--alegre-color)",     stab: 0.4, expr: "smile" },
              { name: "pensativa",   color: "var(--pensativa-color)",  stab: 0.7, expr: "thinking" },
              { name: "sorprendida", color: "var(--sorprendida-color)",stab: 0.3, expr: "surprised" },
            ].map((e) => (
              <div className="emo-card" key={e.name}>
                <div className="emo-swatch" style={{ "--emo-color": e.color }}></div>
                <div className="emo-body">
                  <div className="emo-name">{e.name}</div>
                  <div className="emo-meta">stability {e.stab} · expr: {e.expr}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
        <button className="btn">Guardar personaje</button>
        <button className="btn ghost">Exportar YAML</button>
      </div>
    </div>
  );
}

function ChipList({ items, onChange, placeholder }) {
  const [draft, setDraft] = useS("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="chips">
      {items.map((it, i) => (
        <span className="chip-tag" key={i}>
          {it}
          <button onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
        placeholder={placeholder}
      />
    </div>
  );
}

/* ============ AVATAR LOADER ============ */

const SAMPLE_AVATARS = [
  { id: "default", name: "Shiro Default", source: "Built-in", license: "MIT", active: true },
  { id: "hiyori",  name: "Hiyori",        source: "Live2D Sample", license: "Free / Cubism" },
  { id: "haru",    name: "Haru",          source: "Live2D Sample", license: "Free / Cubism" },
  { id: "natori",  name: "Natori",        source: "Live2D Sample", license: "Free / Cubism" },
];

function AvatarLoaderScreen() {
  const [sel, setSel] = useS("default");
  return (
    <div className="screen">
      <h1 className="screen-title">Avatar</h1>
      <p className="screen-subtitle">
        Cargá un modelo <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)" }}>.model3.json</code> de Live2D, o usá uno de los samples. El Cubism Core debe estar instalado en <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>./vendor/cubism/</code>.
      </p>

      <div className="avatar-grid">
        {SAMPLE_AVATARS.map((a) => (
          <div key={a.id} className={`avatar-card ${sel === a.id ? "active" : ""}`} onClick={() => setSel(a.id)}>
            <div className="avatar-card-preview">
              <div className="avatar-thumb" />
              {sel === a.id && (
                <div style={{ position: "absolute", top: 8, right: 8, background: "var(--accent)", color: "white", borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>
                  ACTIVO
                </div>
              )}
            </div>
            <div className="avatar-card-name">{a.name}</div>
            <div className="avatar-card-meta">{a.source} · {a.license}</div>
          </div>
        ))}

        <div className="avatar-card avatar-upload">
          {Icon.upload}
          <div style={{ fontWeight: 600, fontSize: 14 }}>Importar .model3.json</div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>o arrastrá una carpeta del modelo</div>
        </div>
      </div>

      <div style={{ marginTop: 36 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Parámetros del avatar</h2>
        <div className="slot-list" style={{ maxWidth: 600 }}>
          <div className="slot">
            <FieldGrid fields={[
              { k: "scale", label: "Scale", val: "1.0", type: "slider", min: 0.5, max: 2, step: 0.05 },
              { k: "y_offset", label: "Y offset", val: "0", type: "slider", min: -200, max: 200, step: 5 },
              { k: "idle_animation", label: "Idle animation", val: "true", type: "toggle" },
              { k: "lip_sync_sensitivity", label: "Lip sync sens.", val: "0.7", type: "slider", min: 0, max: 1, step: 0.05 },
            ]} />
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ModulesScreen, CharacterScreen, AvatarLoaderScreen });
