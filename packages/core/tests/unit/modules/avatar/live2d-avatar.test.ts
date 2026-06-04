/**
 * Tests del `Live2DAvatar` — módulo lógico server-side del slot avatar.
 *
 * Cubre:
 *  - Schema de config: defaults, rangos, rechazos.
 *  - Resolución emoción → expressionName con character.emotions del YAML.
 *  - Fallback a `idle_expression` cuando no hay emotions / emoción mapeada.
 *  - Aplicación de `expressionAliases` (Hiyori).
 *  - `setExpression` actualiza state interno.
 *  - `startLipSync` y `stop` manejan flags correctamente.
 *  - Getters expuestos al cliente.
 *
 * NO testea render — no hay render server-side. El siguiente PR
 * cubrirá los hooks del cliente (useAvatarExpression, useLipSync) con
 * SDK mockeado.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import { HIYORI_EXPRESSION_ALIASES } from '../../../../src/modules/avatar/hiyori-expression-aliases.js';
import {
  Live2DAvatar,
  Live2DAvatarConfigSchema,
  Live2DAvatarError,
} from '../../../../src/modules/avatar/live2d-avatar.js';
import type { Character } from '../../../../src/character/schema.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

const SHIRO_EMOTIONS: Character['emotions'] = {
  neutral: { tts_stability: 0.75, avatar_expression: 'idle' },
  divertida: { tts_stability: 0.65, avatar_expression: 'smirk' },
  pensativa: { tts_stability: 0.82, avatar_expression: 'thinking' },
  molesta: { tts_stability: 0.88, avatar_expression: 'annoyed' },
  vulnerable: { tts_stability: 0.55, avatar_expression: 'soft' },
};

describe('Live2DAvatarConfigSchema', () => {
  it('aplica defaults sensatos cuando el input está vacío', () => {
    const cfg = Live2DAvatarConfigSchema.parse({});
    expect(cfg.model_path).toBe('/live2d/models/Hiyori/Hiyori.model3.json');
    expect(cfg.cubism_core_url).toBe('/live2d/Core/live2dcubismcore.js');
    expect(cfg.max_fps).toBe(30);
    expect(cfg.idle_animation).toBe(true);
    expect(cfg.idle_expression).toBe('idle');
  });

  it('rechaza max_fps no positivo o no entero', () => {
    expect(() => Live2DAvatarConfigSchema.parse({ max_fps: 0 })).toThrow();
    expect(() => Live2DAvatarConfigSchema.parse({ max_fps: -1 })).toThrow();
    expect(() => Live2DAvatarConfigSchema.parse({ max_fps: 30.5 })).toThrow();
  });

  it('rechaza model_path o cubism_core_url vacíos', () => {
    expect(() => Live2DAvatarConfigSchema.parse({ model_path: '' })).toThrow();
    expect(() => Live2DAvatarConfigSchema.parse({ cubism_core_url: '' })).toThrow();
  });

  it('rechaza idle_expression vacío', () => {
    expect(() => Live2DAvatarConfigSchema.parse({ idle_expression: '' })).toThrow();
  });

  it('acepta valores custom', () => {
    const cfg = Live2DAvatarConfigSchema.parse({
      model_path: '/custom/path/model.model3.json',
      max_fps: 60,
      idle_animation: false,
      idle_expression: 'default',
    });
    expect(cfg.model_path).toBe('/custom/path/model.model3.json');
    expect(cfg.max_fps).toBe(60);
    expect(cfg.idle_animation).toBe(false);
    expect(cfg.idle_expression).toBe('default');
  });
});

describe('Live2DAvatar construcción', () => {
  it('lanza Live2DAvatarError con mensaje legible si la config es inválida', () => {
    expect(() => new Live2DAvatar({ max_fps: -1 }, makeDeps())).toThrow(Live2DAvatarError);
    expect(() => new Live2DAvatar({ max_fps: -1 }, makeDeps())).toThrow(/max_fps/);
  });

  it('expone los getters con los valores de config aplicados', () => {
    const avatar = new Live2DAvatar(
      {
        model_path: '/x/y/z.model3.json',
        cubism_core_url: '/core.js',
        max_fps: 60,
        idle_animation: false,
        idle_expression: 'default',
      },
      makeDeps(),
    );
    expect(avatar.modelPath).toBe('/x/y/z.model3.json');
    expect(avatar.cubismCoreUrl).toBe('/core.js');
    expect(avatar.maxFps).toBe(60);
    expect(avatar.idleAnimation).toBe(false);
  });

  it('arranca mostrando la idle_expression (sin alias)', () => {
    const avatar = new Live2DAvatar({}, makeDeps());
    expect(avatar.expression).toBe('idle');
    expect(avatar.isLipSyncing).toBe(false);
  });

  it('arranca mostrando la idle_expression CON alias aplicado', () => {
    const avatar = new Live2DAvatar({}, makeDeps(), {
      expressionAliases: HIYORI_EXPRESSION_ALIASES,
    });
    // `idle` está aliased a `default` en Hiyori.
    expect(avatar.expression).toBe('default');
  });

  it('getConfig() devuelve un snapshot completo', () => {
    const avatar = new Live2DAvatar({}, makeDeps());
    const cfg = avatar.getConfig();
    expect(cfg.model_path).toBe('/live2d/models/Hiyori/Hiyori.model3.json');
    expect(cfg.max_fps).toBe(30);
    expect(cfg.idle_expression).toBe('idle');
  });
});

describe('Live2DAvatar.resolveExpression', () => {
  it('usa emotions[emotion].avatar_expression del YAML cuando existe', () => {
    const avatar = new Live2DAvatar({}, makeDeps(), { emotions: SHIRO_EMOTIONS });
    expect(avatar.resolveExpression('neutral')).toBe('idle');
    expect(avatar.resolveExpression('divertida')).toBe('smirk');
    expect(avatar.resolveExpression('pensativa')).toBe('thinking');
    expect(avatar.resolveExpression('molesta')).toBe('annoyed');
    expect(avatar.resolveExpression('vulnerable')).toBe('soft');
  });

  it('aplica expressionAliases sobre el nombre del YAML (Hiyori)', () => {
    const avatar = new Live2DAvatar({}, makeDeps(), {
      emotions: SHIRO_EMOTIONS,
      expressionAliases: HIYORI_EXPRESSION_ALIASES,
    });
    expect(avatar.resolveExpression('neutral')).toBe('default');
    expect(avatar.resolveExpression('divertida')).toBe('smile');
    expect(avatar.resolveExpression('pensativa')).toBe('default');
    expect(avatar.resolveExpression('molesta')).toBe('anger');
    expect(avatar.resolveExpression('vulnerable')).toBe('default');
  });

  it('cae a idle_expression cuando no hay character.emotions', () => {
    const avatar = new Live2DAvatar({}, makeDeps());
    expect(avatar.resolveExpression('divertida')).toBe('idle');
  });

  it('cae a idle_expression cuando la emoción NO está en emotions', () => {
    const partial: Character['emotions'] = {
      neutral: { avatar_expression: 'idle' },
      // resto sin definir
    };
    const avatar = new Live2DAvatar({}, makeDeps(), { emotions: partial });
    expect(avatar.resolveExpression('neutral')).toBe('idle');
    expect(avatar.resolveExpression('molesta')).toBe('idle');
  });

  it('cae a idle_expression cuando avatar_expression del mapeo es undefined', () => {
    const noExpr: Character['emotions'] = {
      neutral: { tts_stability: 0.75 }, // sin avatar_expression
    };
    const avatar = new Live2DAvatar({}, makeDeps(), { emotions: noExpr });
    expect(avatar.resolveExpression('neutral')).toBe('idle');
  });

  it('emoción undefined cae a idle_expression', () => {
    const avatar = new Live2DAvatar({}, makeDeps(), { emotions: SHIRO_EMOTIONS });
    expect(avatar.resolveExpression(undefined)).toBe('idle');
  });

  it('respeta idle_expression custom de la config', () => {
    const avatar = new Live2DAvatar({ idle_expression: 'default' }, makeDeps());
    expect(avatar.resolveExpression('divertida')).toBe('default');
  });
});

describe('Live2DAvatar.setExpression', () => {
  it('actualiza expression al nombre resuelto', async () => {
    const avatar = new Live2DAvatar({}, makeDeps(), { emotions: SHIRO_EMOTIONS });
    expect(avatar.expression).toBe('idle');
    await avatar.setExpression('divertida');
    expect(avatar.expression).toBe('smirk');
    await avatar.setExpression('molesta');
    expect(avatar.expression).toBe('annoyed');
  });

  it('aplica los aliases al setExpression', async () => {
    const avatar = new Live2DAvatar({}, makeDeps(), {
      emotions: SHIRO_EMOTIONS,
      expressionAliases: HIYORI_EXPRESSION_ALIASES,
    });
    await avatar.setExpression('divertida');
    expect(avatar.expression).toBe('smile');
    await avatar.setExpression('molesta');
    expect(avatar.expression).toBe('anger');
  });

  it('no hace nada visible cuando la nueva expresión es igual a la actual', async () => {
    const avatar = new Live2DAvatar({}, makeDeps(), { emotions: SHIRO_EMOTIONS });
    await avatar.setExpression('neutral'); // ya está en idle, neutral → idle
    expect(avatar.expression).toBe('idle');
  });

  it('cae a idle cuando la emoción no mapea (sin emotions)', async () => {
    const avatar = new Live2DAvatar({}, makeDeps());
    await avatar.setExpression('divertida');
    expect(avatar.expression).toBe('idle');
  });
});

describe('Live2DAvatar lifecycle (lipSync + stop)', () => {
  it('startLipSync activa el flag, ignora el buffer', async () => {
    const avatar = new Live2DAvatar({}, makeDeps());
    expect(avatar.isLipSyncing).toBe(false);
    await avatar.startLipSync(Buffer.from('fake audio'));
    expect(avatar.isLipSyncing).toBe(true);
  });

  it('stop desactiva lipSync y vuelve a idle_expression', async () => {
    const avatar = new Live2DAvatar({}, makeDeps(), { emotions: SHIRO_EMOTIONS });
    await avatar.setExpression('molesta');
    await avatar.startLipSync(Buffer.from('audio'));
    expect(avatar.expression).toBe('annoyed');
    expect(avatar.isLipSyncing).toBe(true);

    await avatar.stop();
    expect(avatar.expression).toBe('idle');
    expect(avatar.isLipSyncing).toBe(false);
  });

  it('stop aplica el alias al volver a idle (Hiyori)', async () => {
    const avatar = new Live2DAvatar({}, makeDeps(), {
      emotions: SHIRO_EMOTIONS,
      expressionAliases: HIYORI_EXPRESSION_ALIASES,
    });
    await avatar.setExpression('divertida');
    expect(avatar.expression).toBe('smile');
    await avatar.stop();
    expect(avatar.expression).toBe('default');
  });

  it('stop es idempotente — llamarlo dos veces no rompe', async () => {
    const avatar = new Live2DAvatar({}, makeDeps());
    await avatar.stop();
    await avatar.stop();
    expect(avatar.expression).toBe('idle');
    expect(avatar.isLipSyncing).toBe(false);
  });
});

describe('HIYORI_EXPRESSION_ALIASES', () => {
  it('cubre las 5 expresiones lógicas que usa Shiro hoy', () => {
    expect(HIYORI_EXPRESSION_ALIASES.idle).toBe('default');
    expect(HIYORI_EXPRESSION_ALIASES.smirk).toBe('smile');
    expect(HIYORI_EXPRESSION_ALIASES.thinking).toBe('default');
    expect(HIYORI_EXPRESSION_ALIASES.annoyed).toBe('anger');
    expect(HIYORI_EXPRESSION_ALIASES.soft).toBe('default');
  });

  it('es inmutable (Object.freeze)', () => {
    expect(Object.isFrozen(HIYORI_EXPRESSION_ALIASES)).toBe(true);
  });
});
