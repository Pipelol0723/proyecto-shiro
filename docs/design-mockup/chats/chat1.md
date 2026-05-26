# Avatar TTS STT Frontend

_Started 2026-05-26 16:41 UTC_

---

## User

revisa el siguiente proyecto y crea el mockup del front end (avatar, tts, stt) preguntame lo que necesites.

## User

revisa el siguiente proyecto y crea el mockup del front end (avatar, tts, stt) preguntame lo que necesites.
https://github.com/Pipelol0723/proyecto-shiro

## User

revisa el siguiente proyecto y crea el mockup del front end (avatar, tts, stt) preguntame lo que necesites.
https://github.com/Pipelol0723/proyecto-shiro

## Assistant

_[tool: github_get_tree]_

_[tool: github_read_file]_

_[tool: github_read_file]_

_[tool: github_get_tree]_

_[tool: github_get_tree]_

_[tool: github_get_tree]_

_[tool: github_read_file]_

_[tool: github_read_file]_

_[tool: questions_v2]_

Ya revisé el repo a fondo. Shiro es un AI companion modular con avatar Live2D (VTuber), voz en tiempo real (Whisper STT + ElevenLabs/Kokoro TTS), router híbrido (Qwen local / Claude cloud), memoria persistente con Letta, y empaquetado como app desktop con Tauri. La personalidad: curiosa, cálida, directa, con humor, español neutro.

Antes de empezar a maquetar, necesito definir el tipo de UI que buscas. Te dejo preguntas para acotarlo:

## User

Questions answered:
- form_factor: Ambos: ventana principal + modo compacto/overlay alterno
- visual_style: Explorar varias opciones (te doy 3 variantes en tweaks)
- avatar_placement: 3
- core_screens: Conversación principal (avatar + voz + chat), Configuración de módulos (swap LLM/TTS/STT — el YAML como UI), Editor de personaje (los campos del default.yaml), Selector/cargador de avatar Live2D, Onboarding inicial / setup
- voice_interaction: Las tres opciones (usuario elige en settings)
- voice_visuals: Transcripción en vivo mientras hablas, Indicador de emoción actual (neutral/alegre/pensativa/sorprendida), Burbujas de diálogo flotantes estilo VTuber stream, Subtítulos de lo que Shiro está diciendo, Indicador de 'pensando' (router clasificando local vs cloud)
- emotion_display: Sólo en el avatar (cambia expresión, sin UI extra)
- chat_history: Toggle: el usuario lo expande/colapsa
- avatar_placeholder: Imagen abstracta — orbe/blob animado que pulsa con la voz
- interactivity: Prototipo clickable: puedo hablar (simulado), Shiro 'responde' con animaciones falsas, cambia emociones
- tweaks_extras: Mostrar/ocultar panel de diagnóstico, Toggle modo overlay vs ventana completa

## Assistant

_[tool: update_todos]_

_[tool: copy_starter_component]_

¡Perfecto, con eso me alcanza! Voy a construir un prototipo clickable con avatar orbe pulsante, las 5 pantallas, 3 variantes visuales en Tweaks y simulación completa de voz.

Plan:
- Pantalla principal: orbe arriba (cambia color/forma según emoción), subtítulos al centro, dock de entrada abajo
- Sidebar con: Conversación, Módulos, Personaje, Avatar, Setup
- Tres temas visuales swap-eables (Kawaii / Cyberpunk / Editorial)
- Simulación completa: hablas → transcripción vivo → "router pensando" → orbe responde animado + subtítulos + TTS fake
- Tweaks: diagnóstico on/off, modo overlay vs ventana

_[tool: write_file]_

Voy a construir los archivos. Empiezo por la estructura base, luego el orbe, luego las pantallas.

_[tool: write_file]_

Ahora el orbe — el alma del avatar:

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

Ahora el app shell con sidebar, panel de diagnóstico y el reducer central:

_[tool: write_file]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Ahora el HTML principal:

_[tool: write_file]_

_[tool: show_html]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: done]_

Clean. Vamos a mostrar al usuario:

_[tool: fork_verifier_agent]_

Listo. Construí el mockup completo de Shiro como prototipo interactivo. Esto es lo que tenés:

**Pantalla principal (Conversación)**
- Orbe animado tipo metaball que reacciona a estado: pulsa con voz, cambia color según emoción (neutral/alegre/pensativa/sorprendida), partículas orbitando cuando "piensa"
- 3 modos de voz cambiables: Push-to-talk · VAD always-on · Toggle
- Transcripción STT en vivo + subtítulos de Shiro hablando + burbuja flotante estilo VTuber
- Indicador "Pensando con Qwen/Claude" según el router híbrido
- Panel de chat toggleable con tags por mensaje (Qwen/Claude + latencia + emoción)

**Otras pantallas**
- **Módulos** — el `modules.config.yaml` como UI editable, slots swap-eables (LLM, Router, STT, TTS, Memory, Avatar) con cadenas de fallback visibles
- **Personaje** — editor de los campos del `default.yaml` + mapeo de emociones a TTS/avatar
- **Avatar** — selector de modelos Live2D con upload zone y parámetros (scale, lip sync sensitivity)
- **Onboarding** — wizard de 6 pasos para primer setup

**Panel de diagnóstico** (toggleable) — status de cada módulo, CPU/GPU/VRAM, log de eventos del EventBus, última latencia/ruta

**Probá esto:**
1. Click en el micrófono → simula flujo completo STT → router → TTS
2. Activá **Tweaks** desde la barra y cambiá tema entre **Kawaii / Cyberpunk / Editorial** — son tres direcciones radicalmente distintas
3. Activá el modo **overlay** para ver cómo se vería flotando sobre el escritorio
4. Forzá cualquier emoción desde el panel de Tweaks para ver el orbe

¿Qué dirección visual te gusta más? ¿Hay algo del flujo que quieras profundizar (ej. cómo se ve cuando falla un fallback, el lip sync más explícito, etc.)?

## User

Verifier agent check completed

## Assistant

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: done]_

Arreglado el overlap entre el mode-switch y los subtítulos. Ahora viven en un layout flex vertical con gap, sin posicionamiento absoluto.

