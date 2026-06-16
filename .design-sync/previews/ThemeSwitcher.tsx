/**
 * ThemeSwitcher — el selector de los 3 temas de Shiro, uno por card, con su
 * tema activo y renderizado dentro de ese mismo tema (colores reales).
 * `value`/`onChange` controlados con estado local.
 */
import * as React from 'react';
import { ThemeSwitcher } from '@proyecto-shiro/desktop';
import { Stage, type ThemeName } from './_stage';

function Demo({ initial }: { initial: ThemeName }): JSX.Element {
  const [value, setValue] = React.useState<ThemeName>(initial);
  return <ThemeSwitcher value={value} onChange={setValue} />;
}

export function Kawaii(): JSX.Element {
  return (
    <Stage theme="kawaii">
      <Demo initial="kawaii" />
    </Stage>
  );
}

export function Cyber(): JSX.Element {
  return (
    <Stage theme="cyber">
      <Demo initial="cyber" />
    </Stage>
  );
}

export function Editorial(): JSX.Element {
  return (
    <Stage theme="editorial">
      <Demo initial="editorial" />
    </Stage>
  );
}
