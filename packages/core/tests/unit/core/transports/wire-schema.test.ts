import { describe, expect, it } from 'vitest';
import {
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
  WIRE_PROTOCOL_VERSION,
  WireEnvelopeSchema,
} from '../../../../src/core/transports/wire-schema.js';

describe('wire-schema', () => {
  describe('makeEnvelope', () => {
    it('construye un envelope con los campos esperados', () => {
      const env = makeEnvelope('user:message', { text: 'hola', userId: 'u1' });
      expect(env.v).toBe(WIRE_PROTOCOL_VERSION);
      expect(env.kind).toBe('event');
      expect(env.name).toBe('user:message');
      expect(env.payload).toEqual({ text: 'hola', userId: 'u1' });
      expect(env.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 prefix
    });

    it('payload puede ser null', () => {
      const env = makeEnvelope('bus:ready', null);
      expect(env.payload).toBeNull();
    });

    it('payload puede ser un valor primitivo', () => {
      const env = makeEnvelope('test:scalar', 42);
      expect(env.payload).toBe(42);
    });
  });

  describe('serializeEnvelope', () => {
    it('produce un string JSON parseable', () => {
      const raw = serializeEnvelope('user:message', { text: 'hola' });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed.v).toBe(1);
      expect(parsed.kind).toBe('event');
      expect(parsed.name).toBe('user:message');
    });
  });

  describe('parseEnvelope', () => {
    it('parsea un envelope válido', () => {
      const raw = serializeEnvelope('llm:responded', { text: 'hi', emotion: 'alegre' });
      const result = parseEnvelope(raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.name).toBe('llm:responded');
        expect(result.envelope.payload).toEqual({ text: 'hi', emotion: 'alegre' });
      }
    });

    it('rechaza JSON inválido', () => {
      const result = parseEnvelope('{not json');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/JSON inv/i);
      }
    });

    it('rechaza versión incorrecta', () => {
      const raw = JSON.stringify({ v: 2, kind: 'event', name: 'x', payload: null, ts: 't' });
      const result = parseEnvelope(raw);
      expect(result.ok).toBe(false);
    });

    it('rechaza kind desconocido', () => {
      const raw = JSON.stringify({ v: 1, kind: 'subscribe', name: 'x', payload: null, ts: 't' });
      const result = parseEnvelope(raw);
      expect(result.ok).toBe(false);
    });

    it('rechaza nombre vacío', () => {
      const raw = JSON.stringify({ v: 1, kind: 'event', name: '', payload: null, ts: 't' });
      const result = parseEnvelope(raw);
      expect(result.ok).toBe(false);
    });

    it('rechaza objeto sin campo `ts`', () => {
      const raw = JSON.stringify({ v: 1, kind: 'event', name: 'x', payload: null });
      const result = parseEnvelope(raw);
      expect(result.ok).toBe(false);
    });
  });

  describe('WireEnvelopeSchema', () => {
    it('es exportado y usable directamente con safeParse', () => {
      const valid = makeEnvelope('user:message', { text: 'hi' });
      const result = WireEnvelopeSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });
});
