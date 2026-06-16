/**
 * Orb — barrido de las 5 emociones + estados (speaking / thinking / listening).
 * Cada export = una card. El color sale del gradiente por emoción definido en
 * el tema (.theme-kawaii) que aplica <Stage>.
 */
import * as React from 'react';
import { Orb } from '@proyecto-shiro/desktop';
import { Stage } from './_stage';

export function Neutral(): JSX.Element {
  return (
    <Stage>
      <Orb emotion="neutral" size={150} />
    </Stage>
  );
}

export function Divertida(): JSX.Element {
  return (
    <Stage>
      <Orb emotion="divertida" speaking size={150} />
    </Stage>
  );
}

export function Pensativa(): JSX.Element {
  return (
    <Stage>
      <Orb emotion="pensativa" thinking size={150} />
    </Stage>
  );
}

export function Molesta(): JSX.Element {
  return (
    <Stage>
      <Orb emotion="molesta" size={150} />
    </Stage>
  );
}

export function Vulnerable(): JSX.Element {
  return (
    <Stage>
      <Orb emotion="vulnerable" listening size={150} />
    </Stage>
  );
}
