import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('vitest runs and basic assertions work', () => {
    expect(1 + 1).toBe(2);
  });

  it('node environment is available', () => {
    expect(typeof process).toBe('object');
    expect(process.versions.node).toBeDefined();
  });
});
