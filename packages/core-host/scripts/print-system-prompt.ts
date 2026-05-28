/**
 * Imprime el system prompt que el LLM recibirá, generado a partir del
 * personaje activo. Útil para iterar `default.yaml` y ver el efecto
 * sin levantar el server.
 *
 * Uso:
 *   npm run print-prompt -w @proyecto-shiro/core-host
 *   npm run print-prompt -w @proyecto-shiro/core-host -- ruta/al/personaje.yaml
 *
 * El primer argumento posicional sobrescribe el path por defecto
 * (`../core/src/character/characters/default.yaml` relativo al cwd
 * de core-host).
 */

import { buildSystemPrompt, Logger } from '@proyecto-shiro/core';
import { CharacterLoader } from '@proyecto-shiro/core/node';

const DEFAULT_CHARACTER_PATH = '../core/src/character/characters/default.yaml';

function main(): void {
  const path = process.argv[2] ?? DEFAULT_CHARACTER_PATH;
  const loader = new CharacterLoader({ logger: new Logger('error') });
  const character = loader.loadFromFile(path);
  const prompt = buildSystemPrompt(character);
  console.log(`# System prompt para "${character.identity.name}" (${path})`);
  console.log(`# ${prompt.length} caracteres\n`);
  console.log(prompt);
}

main();
