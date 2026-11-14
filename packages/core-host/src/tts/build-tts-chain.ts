/**
 * buildTtsChain — construye la cadena de TTS con respaldo a partir del
 * slot `tts` de `modules.config.yaml` (ADR 0034 §3, cierra R-241).
 *
 * El primario ya lo instanció el orquestador. Cada nombre de
 * `slot.fallback_chain` se instancia aquí con `loader.load(nombre,
 * slot.providers?.[nombre] ?? {}, deps)`. `SystemTTS` va siempre al final
 * (la garantía de ADR 0020: Shiro siempre tiene voz), sin duplicarse y sin
 * añadirse si ya es el activo.
 */

import type {
  ITTSModule,
  Logger,
  ModuleDeps,
  ModuleLoader,
  ModuleSlot,
} from '@proyecto-shiro/core';
import { TtsWithFallback } from './tts-with-fallback.js';

const SYSTEM_TTS = 'SystemTTS';

export interface BuildTtsChainOptions {
  /** Módulo activo, ya instanciado por el orquestador. */
  primary: ITTSModule;
  /** Slot `tts` del YAML. */
  slot: ModuleSlot;
  loader: ModuleLoader;
  deps: ModuleDeps;
  logger: Logger;
}

export function buildTtsChain(options: BuildTtsChainOptions): TtsWithFallback {
  const { primary, slot, loader, deps, logger } = options;
  const providers = slot.providers ?? {};

  // SystemTTS siempre al final, una sola vez y nunca si es el activo.
  const names = (slot.fallback_chain ?? []).filter((name) => name !== SYSTEM_TTS);
  if (slot.active !== SYSTEM_TTS) names.push(SYSTEM_TTS);

  for (const name of slot.fallback_chain ?? []) {
    if (name === slot.active) {
      throw new Error(`tts.fallback_chain repite el módulo activo '${name}'.`);
    }
    if (!loader.has(name)) {
      throw new Error(
        `tts.fallback_chain nombra '${name}', que no está registrado. ` +
          `Registrados: ${loader.listRegistered().join(', ')}.`,
      );
    }
  }

  const fallbacks = names.map((name) => {
    // SystemTTS no necesita config: no avisamos si falta su entrada.
    if (providers[name] === undefined && name !== SYSTEM_TTS) {
      logger.warn(
        `tts.providers no tiene entrada para '${name}': se instancia con config vacía y ` +
          `puede quedar como eslabón muerto.`,
      );
    }
    return loader.load<ITTSModule>(name, providers[name] ?? {}, deps);
  });

  const inChain = new Set([slot.active, ...names]);
  for (const key of Object.keys(providers)) {
    if (!inChain.has(key)) {
      logger.warn(
        `tts.providers tiene la clave '${key}', que no está en active ni en fallback_chain (¿errata?).`,
      );
    }
  }

  return new TtsWithFallback({ primary, fallbacks, logger });
}
