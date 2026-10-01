import { describe, expect, it } from 'vitest';
import { layoutFor } from './layout.js';
import { initialModel } from './model.js';

describe('phase 1 responsive layout', () => {
  it('uses ultra-small layout for narrow terminals', () => {
    expect(layoutFor(initialModel(72, 20)).tier).toBe('ultra-small');
  });
  it('uses standard layout for normal terminals', () => {
    expect(layoutFor(initialModel(100, 30)).tier).toBe('standard');
  });
  it('uses large and huge tiers progressively', () => {
    expect(layoutFor(initialModel(140, 30)).tier).toBe('large');
    expect(layoutFor(initialModel(180, 40)).tier).toBe('huge');
  });
  it('keeps the frame dimensions internally consistent', () => {
    const layout = layoutFor(initialModel(140, 30));
    expect(layout.bodyTop).toBe(layout.hudTop + layout.hudHeight);
    expect(layout.bodyHeight).toBeGreaterThanOrEqual(0);
    expect(layout.viewportHeight).toBe(layout.mainHeight);
  });
});
