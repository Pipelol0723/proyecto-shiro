/**
 * IconSend — icono de línea de Shiro (24×24, stroke currentColor). El color sale
 * del wrapper temático; cada export muestra un uso distinto (tamaño/color).
 */
import * as React from 'react';
import { IconSend } from '@proyecto-shiro/desktop';
import { Stage } from './_stage';

export function Default(): JSX.Element {
  return (
    <Stage>
      <span style={{ color: 'var(--ink)', display: 'inline-flex' }}>
        <IconSend size={32} />
      </span>
    </Stage>
  );
}

export function Accent(): JSX.Element {
  return (
    <Stage>
      <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>
        <IconSend size={48} />
      </span>
    </Stage>
  );
}

export function Sizes(): JSX.Element {
  return (
    <Stage>
      {[16, 22, 32, 48].map((s) => (
        <span key={s} style={{ color: 'var(--ink)', display: 'inline-flex' }}>
          <IconSend size={s} />
        </span>
      ))}
    </Stage>
  );
}
