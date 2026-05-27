/**
 * Tests del reducer del companion — pure function, sin React/jsdom.
 * Validan cada acción del union de actions.
 */

import { describe, it, expect } from 'vitest';
import {
  companionReducer,
  INITIAL_STATE,
  type CompanionState,
} from '../src/state/companion-reducer';

const baseState: CompanionState = INITIAL_STATE;

describe('companionReducer', () => {
  describe('LISTEN_START', () => {
    it('activa listening y limpia sttLive y subtitle', () => {
      const result = companionReducer(
        { ...baseState, listening: false, sttLive: 'previo', subtitle: 'previo' },
        { type: 'LISTEN_START' },
      );
      expect(result.listening).toBe(true);
      expect(result.sttLive).toBe('');
      expect(result.subtitle).toBe('');
    });
  });

  describe('STT_PARTIAL', () => {
    it('actualiza sttLive sin tocar listening', () => {
      const result = companionReducer(
        { ...baseState, listening: true },
        { type: 'STT_PARTIAL', text: 'hola mu' },
      );
      expect(result.sttLive).toBe('hola mu');
      expect(result.listening).toBe(true);
    });
  });

  describe('STT_FINAL', () => {
    it('apaga listening, limpia sttLive, añade mensaje al historial', () => {
      const result = companionReducer(
        { ...baseState, listening: true, sttLive: 'hola' },
        { type: 'STT_FINAL', text: 'hola mundo', userId: 'u1' },
      );
      expect(result.listening).toBe(false);
      expect(result.sttLive).toBe('');
      expect(result.history).toHaveLength(1);
      expect(result.history[0]?.role).toBe('user');
      expect(result.history[0]?.text).toBe('hola mundo');
      expect(result.history[0]?.timestamp).toBeDefined();
    });
  });

  describe('THINK_START', () => {
    it('activa thinking y guarda el tier', () => {
      const result = companionReducer(baseState, { type: 'THINK_START', tier: 'cloud' });
      expect(result.thinking).toBe(true);
      expect(result.routedTo).toBe('cloud');
    });
  });

  describe('SHIRO_REPLY', () => {
    it('apaga thinking, activa speaking, actualiza emotion/subtitle, añade al historial', () => {
      const result = companionReducer(
        { ...baseState, thinking: true, routedTo: 'local' },
        {
          type: 'SHIRO_REPLY',
          text: 'hola tú',
          emotion: 'alegre',
          tier: 'local',
          latencyMs: 740,
        },
      );
      expect(result.thinking).toBe(false);
      expect(result.speaking).toBe(true);
      expect(result.emotion).toBe('alegre');
      expect(result.subtitle).toBe('hola tú');
      expect(result.history).toHaveLength(1);
      const msg = result.history[0];
      expect(msg?.role).toBe('shiro');
      expect(msg?.text).toBe('hola tú');
      expect(msg?.emotion).toBe('alegre');
      expect(msg?.tier).toBe('local');
      expect(msg?.latencyMs).toBe(740);
    });
  });

  describe('SPEAK_END', () => {
    it('apaga speaking y limpia subtitle, mantiene emotion', () => {
      const result = companionReducer(
        { ...baseState, speaking: true, subtitle: 'hola', emotion: 'alegre' },
        { type: 'SPEAK_END' },
      );
      expect(result.speaking).toBe(false);
      expect(result.subtitle).toBe('');
      expect(result.emotion).toBe('alegre'); // emoción se mantiene hasta nueva reply
    });
  });

  describe('SET_EMOTION', () => {
    it('cambia la emoción sin tocar el resto', () => {
      const result = companionReducer(
        { ...baseState, speaking: true },
        { type: 'SET_EMOTION', emotion: 'pensativa' },
      );
      expect(result.emotion).toBe('pensativa');
      expect(result.speaking).toBe(true);
    });
  });

  describe('RESET', () => {
    it('vuelve al state inicial', () => {
      const result = companionReducer(
        {
          ...baseState,
          listening: true,
          thinking: true,
          emotion: 'sorprendida',
          history: [{ role: 'user', text: 'hi', timestamp: '2026-01-01T00:00:00Z' }],
        },
        { type: 'RESET' },
      );
      expect(result).toEqual(INITIAL_STATE);
    });
  });

  describe('flujo completo (integración del reducer)', () => {
    it('simula una conversación completa de turno', () => {
      let state: CompanionState = INITIAL_STATE;

      state = companionReducer(state, { type: 'LISTEN_START' });
      expect(state.listening).toBe(true);

      state = companionReducer(state, { type: 'STT_PARTIAL', text: 'hola' });
      expect(state.sttLive).toBe('hola');

      state = companionReducer(state, { type: 'STT_PARTIAL', text: 'hola shiro' });
      expect(state.sttLive).toBe('hola shiro');

      state = companionReducer(state, {
        type: 'STT_FINAL',
        text: 'hola shiro',
        userId: 'me',
      });
      expect(state.listening).toBe(false);
      expect(state.history).toHaveLength(1);

      state = companionReducer(state, { type: 'THINK_START', tier: 'local' });
      expect(state.thinking).toBe(true);

      state = companionReducer(state, {
        type: 'SHIRO_REPLY',
        text: '¡hola!',
        emotion: 'alegre',
        tier: 'local',
        latencyMs: 500,
      });
      expect(state.thinking).toBe(false);
      expect(state.speaking).toBe(true);
      expect(state.emotion).toBe('alegre');

      state = companionReducer(state, { type: 'SPEAK_END' });
      expect(state.speaking).toBe(false);
      expect(state.subtitle).toBe('');
      expect(state.emotion).toBe('alegre'); // persiste
      expect(state.history).toHaveLength(2);
    });
  });
});
