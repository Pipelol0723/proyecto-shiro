// @ts-check
// Comprueba que las Actions de los workflows van fijadas por SHA. Se ejecuta
// con `npm run test:scripts` (node --test). Una etiqueta o rama se puede mover
// y cambiar lo que corre el CI; un SHA de 40 caracteres no.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = new URL('../.github/workflows/', import.meta.url);

/**
 * Devuelve un mensaje por cada `uses:` de acción remota que no esté fijado a
 * un SHA de 40 hex seguido de un comentario `# <versión o rama>`.
 * @param {string} text contenido del workflow
 * @param {string} file nombre del archivo, solo para el mensaje
 * @returns {string[]}
 */
export function findUnpinnedActions(text, file) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(line);
    if (!match) return;
    const [, ref, rest] = match;
    if (ref.startsWith('./')) return;
    const where = `${file}:${index + 1}`;
    if (!/^[^@\s]+@[0-9a-f]{40}$/.test(ref)) {
      problems.push(
        `${where}: «${ref}» no está fijada a un SHA de 40 caracteres hexadecimales. ` +
          'Resuelve el SHA con `gh api repos/<dueño>/<repo>/commits/<ref> --jq .sha` y escribe ' +
          '`uses: <dueño>/<repo>@<sha> # <versión>`.',
      );
    } else if (!/^\s+#\s*\S+/.test(rest)) {
      problems.push(
        `${where}: «${ref}» lleva SHA pero falta el comentario \`# <versión o rama>\` ` +
          '(Dependabot lo necesita para subir SHA y comentario a la vez).',
      );
    }
  });
  return problems;
}

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';

test('acepta una acción fijada por SHA con comentario de versión', () => {
  assert.deepEqual(
    findUnpinnedActions(`      - uses: actions/checkout@${SHA} # v7.0.1`, 'x.yml'),
    [],
  );
  assert.deepEqual(
    findUnpinnedActions(`        uses: actions/checkout@${SHA} # v7.0.1`, 'x.yml'),
    [],
  );
});

test('rechaza un tag móvil', () => {
  const problems = findUnpinnedActions('        uses: actions/checkout@v7', 'x.yml');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /x\.yml:1/);
});

test('rechaza una rama', () => {
  assert.equal(
    findUnpinnedActions('        uses: dtolnay/rust-toolchain@stable', 'x.yml').length,
    1,
  );
});

test('rechaza un SHA corto', () => {
  assert.equal(
    findUnpinnedActions('        uses: actions/checkout@3d3c42e # v7', 'x.yml').length,
    1,
  );
});

test('rechaza un SHA sin comentario de versión', () => {
  const problems = findUnpinnedActions(`        uses: actions/checkout@${SHA}`, 'x.yml');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /comentario/);
});

test('ignora las acciones locales', () => {
  assert.deepEqual(findUnpinnedActions('        uses: ./.github/actions/mia', 'x.yml'), []);
});

test('ignora un uses: dentro de un comentario', () => {
  assert.deepEqual(findUnpinnedActions('      # uses: actions/checkout@v7', 'x.yml'), []);
});

test('todas las Actions de .github/workflows van fijadas por SHA', () => {
  const problems = [];
  for (const name of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(fileURLToPath(new URL(name, WORKFLOWS_DIR)), 'utf8');
    problems.push(...findUnpinnedActions(text, `.github/workflows/${name}`));
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
});
