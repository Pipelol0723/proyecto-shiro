/**
 * Esquema del manifiesto del motor de capas (ADR 0028 §2 y §4).
 *
 * Los casos salen del material del prototipo, que es la especificación:
 * `docs/design/chibi-prototype/test-model/`. Se leen de ahí, sin copia, para
 * que el esquema y el documento no se separen.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSpriteLayersManifest } from '../../src/components/Avatar/engines/layers/manifest';

const TEST_MODEL = path.resolve(__dirname, '../../../../docs/design/chibi-prototype/test-model');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(TEST_MODEL, name), 'utf8'));
}

interface InvalidCase {
  name: string;
  set?: Record<string, unknown>;
  remove?: string[];
}

/** Aplica un caso (`set` y `remove` con rutas de puntos) sobre una copia del manifiesto. */
function applyCase(base: unknown, change: Omit<InvalidCase, 'name'>): unknown {
  const copy = structuredClone(base) as Record<string, unknown>;
  const walk = (dotted: string): { parent: Record<string, unknown>; key: string } => {
    const keys = dotted.split('.');
    const key = keys.pop() ?? '';
    let parent = copy;
    for (const k of keys) {
      if (typeof parent[k] !== 'object' || parent[k] === null) parent[k] = {};
      parent = parent[k] as Record<string, unknown>;
    }
    return { parent, key };
  };
  for (const [dotted, value] of Object.entries(change.set ?? {})) {
    const { parent, key } = walk(dotted);
    parent[key] = value;
  }
  for (const dotted of change.remove ?? []) {
    const { parent, key } = walk(dotted);
    Reflect.deleteProperty(parent, key);
  }
  return copy;
}

const full = readJson('avatar.manifest.json');
const minimal = readJson('avatar.minimal.manifest.json');
const invalidCases = (
  readJson('behavior-cases.json') as { invalidManifests: { cases: InvalidCase[] } }
).invalidManifests.cases;

function issuesOf(raw: unknown): { path: string; message: string }[] {
  const result = parseSpriteLayersManifest(raw);
  return result.ok ? [] : result.issues;
}

describe('parseSpriteLayersManifest — modelos válidos', () => {
  it('acepta el manifiesto completo del modelo de prueba', () => {
    expect(issuesOf(full)).toEqual([]);
  });

  it('acepta el manifiesto mínimo y rellena los valores por defecto', () => {
    const result = parseSpriteLayersManifest(minimal);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { manifest } = result;

    expect(manifest.provisional).toBe(false);
    expect(manifest.credits).toBe('');
    expect(manifest.face.gaze.max).toEqual([0, 0]);
    expect(manifest.face.blink.open).toBe('eyes_open');
    expect(manifest.face.blink.interval_s).toEqual([2.5, 6]);
    expect(manifest.face.blink.duration_ms).toBe(130);
    expect(manifest.emotions).toEqual({});
    expect(manifest.expressions.idle).toMatchObject({
      blush: 0,
      gaze: [0, 0],
      glow: { level: 1, pattern: 'steady' },
    });
    expect(manifest.layers.glow).toBeUndefined();
    expect(manifest.face.iris).toBeUndefined();
  });

  it('devuelve los valores escritos, no los de por defecto', () => {
    const result = parseSpriteLayersManifest(full);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.manifest.face.gaze.max).toEqual([5, 3]);
    expect(result.manifest.face.mouth_thresholds).toEqual([0.12, 0.34, 0.6]);
    expect(result.manifest.expressions.thinking?.gaze).toEqual([0.85, 0.35]);
  });
});

describe('parseSpriteLayersManifest — los casos inválidos del prototipo', () => {
  it('lee los casos del material de la sesión de diseño', () => {
    expect(invalidCases.length).toBeGreaterThanOrEqual(54);
  });

  it.each(invalidCases.map((c) => [c.name, c] as const))('rechaza: %s', (_name, change) => {
    expect(issuesOf(applyCase(full, change)).length).toBeGreaterThan(0);
  });

  it.each(invalidCases.map((c) => [c.name, c] as const))(
    'el problema de «%s» está donde el caso lo puso',
    (_name, change) => {
      const changed = [...Object.keys(change.set ?? {}), ...(change.remove ?? [])];
      const paths = issuesOf(applyCase(full, change)).map((issue) => issue.path);
      // El problema cae en la ruta cambiada, dentro de ella o en el mapa que la contiene.
      const related = (issuePath: string, target: string): boolean =>
        issuePath !== '' &&
        (issuePath === target ||
          issuePath.startsWith(`${target}.`) ||
          target.startsWith(`${issuePath}.`));
      expect(paths.some((p) => changed.some((target) => related(p, target)))).toBe(true);
    },
  );

  it('el error dice dónde está el problema', () => {
    const brows = issuesOf(applyCase(full, { set: { 'expressions.idle.brows': 'brows_nope' } }));
    expect(brows.map((issue) => issue.path)).toContain('expressions.idle.brows');

    const route = issuesOf(applyCase(full, { set: { 'layers.base': '../otro/base.png' } }));
    expect(route.map((issue) => issue.path)).toContain('layers.base');
  });
});

describe('parseSpriteLayersManifest — rutas que no pueden salir de la carpeta', () => {
  it.each([
    ['puntos codificados', 'assets/%2e%2e/base.png'],
    ['barra codificada', 'assets%2fbase.png'],
    ['con consulta', 'assets/base.png?x=1'],
    ['con fragmento', 'assets/base.png#x'],
    ['vacía', ''],
    ['segmento vacío', 'assets//base.png'],
    ['esquema de datos', 'data:image/png;base64,AAAA'],
    ['dos puntos en medio', 'assets/../../base.png'],
    ['un tabulador que esconde dos puntos', '.\t./base.png'],
    ['dos puntos seguidos de un tabulador', '..\t'],
    ['un salto de línea que esconde dos puntos', 'assets/.\n./base.png'],
    ['un retorno de carro', 'assets/..\r/base.png'],
    ['un carácter nulo', '\u0000'],
    ['un espacio delante', ' assets/base.png'],
    ['un espacio detrás', 'assets/base.png '],
    ['un espacio en medio', 'assets/base final.png'],
    ['un punto solo', '.'],
    ['un segmento de un punto', 'assets/./base.png'],
    ['más larga de lo razonable', `assets/${'a'.repeat(300)}.png`],
  ])('rechaza una ruta %s', (_name, route) => {
    expect(issuesOf(applyCase(full, { set: { 'layers.base': route } })).length).toBeGreaterThan(0);
  });

  it('acepta subcarpetas y nombres con puntos, guiones, dos puntos y letras con tilde', () => {
    for (const route of ['assets/v1.2/base-final_2.png', 'assets/a:b.png', 'capas/cañón.png']) {
      expect(issuesOf(applyCase(full, { set: { 'layers.base': route } }))).toEqual([]);
    }
  });
});

describe('parseSpriteLayersManifest — claves', () => {
  it('ignora una capa que no conoce, sin cargarla', () => {
    const result = parseSpriteLayersManifest(
      applyCase(full, { set: { 'layers.sombra': '../fuera.png' } }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(Object.keys(result.manifest.layers)).not.toContain('sombra');
  });

  it('rechaza una clave desconocida dentro de una expresión', () => {
    expect(
      issuesOf(applyCase(full, { set: { 'expressions.idle.cejas': 'brows_idle' } })).length,
    ).toBeGreaterThan(0);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rechaza «%s» como nombre de pieza, de estado o de expresión',
    (key) => {
      const withKey = (mapPath: string, value: unknown): unknown => {
        const copy = structuredClone(full) as Record<string, unknown>;
        let node = copy;
        for (const k of mapPath.split('.')) node = node[k] as Record<string, unknown>;
        Object.defineProperty(node, key, { value, enumerable: true, configurable: true });
        return copy;
      };
      expect(issuesOf(withKey('face.pieces', 'assets/base.png')).length).toBeGreaterThan(0);
      expect(
        issuesOf(withKey('face.eyes', { white: null, lines: 'eyes_closed_lines' })).length,
      ).toBeGreaterThan(0);
      expect(issuesOf(withKey('emotions', 'idle')).length).toBeGreaterThan(0);
      expect(issuesOf(withKey('layers', 'assets/base.png')).length).toBeGreaterThan(0);
      expect(
        issuesOf(
          withKey('expressions', { eyes: 'eyes_open', brows: 'brows_idle', mouth: 'mouth_idle' }),
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it('acepta draw_order, aunque esté obsoleto', () => {
    expect(issuesOf(applyCase(full, { set: { draw_order: ['base', 'cara'] } }))).toEqual([]);
  });
});

describe('parseSpriteLayersManifest — cabecera del ADR 0035', () => {
  it('acepta form, cost y capabilities, que son opcionales', () => {
    const result = parseSpriteLayersManifest(
      applyCase(full, {
        set: {
          form: 'chibi',
          cost: { tier: 'light', needs_webgl: false, memory_mb: 50, download_kb: 1800 },
          capabilities: { look_at: true, glow: true, body_motion: false, framing: 'full-body' },
        },
      }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.manifest.form).toBe('chibi');
    expect(result.manifest.cost?.tier).toBe('light');
    expect(result.manifest.capabilities?.framing).toBe('full-body');
  });

  it.each([
    ['una forma que no existe', { form: 'holograma' }],
    ['un nivel de coste que no existe', { cost: { tier: 'enorme' } }],
    ['un encuadre que no existe', { capabilities: { framing: 'cabeza' } }],
    ['una clave desconocida en el coste', { cost: { tier: 'light', precio: 3 } }],
  ])('rechaza %s', (_name, set) => {
    expect(issuesOf(applyCase(full, { set })).length).toBeGreaterThan(0);
  });
});

describe('parseSpriteLayersManifest — entradas que no son un manifiesto', () => {
  it.each([null, undefined, 3, 'texto', [], true])('rechaza %j sin lanzar', (raw) => {
    expect(issuesOf(raw).length).toBeGreaterThan(0);
  });
});

describe('parseSpriteLayersManifest — topes', () => {
  it.each([
    ['una figura enorme', { size: [100000, 200], 'face.rect': [20, 30, 80, 60] }],
    ['un parpadeo sin pausa', { 'face.blink.interval_s': [0.0001, 0.0001] }],
    ['una espera entre parpadeos absurda', { 'face.blink.interval_s': [1, 100000] }],
    ['un parpadeo que no acaba', { 'face.blink.duration_ms': 1e9 }],
    ['un parpadeo instantáneo', { 'face.blink.duration_ms': 0.001 }],
    ['un recorrido de mirada mayor que la cara', { 'face.gaze.max': [500, 3] }],
    ['un draw_order kilométrico', { draw_order: Array.from({ length: 500 }, () => 'x') }],
    ['un nombre kilométrico', { name: 'x'.repeat(5000) }],
    ['una memoria declarada absurda', { cost: { tier: 'light', memory_mb: 1e300 } }],
  ])('rechaza %s', (_name, set) => {
    expect(issuesOf(applyCase(full, { set })).length).toBeGreaterThan(0);
  });

  it('una clave desconocida se nombra en el problema', () => {
    const issues = issuesOf(applyCase(full, { set: { gaze_max: [5, 3] } }));
    expect(issues.map((issue) => issue.path)).toContain('gaze_max');
  });
});
