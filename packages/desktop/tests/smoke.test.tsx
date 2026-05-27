import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('desktop smoke', () => {
  it('jsdom + RTL están operativos', () => {
    render(<h1>Shiro</h1>);
    expect(screen.getByRole('heading', { name: 'Shiro' })).toBeDefined();
  });

  it('document existe', () => {
    expect(document).toBeDefined();
    expect(document.body).toBeDefined();
  });
});
