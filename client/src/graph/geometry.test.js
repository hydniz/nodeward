// the shared geometry module has no workspace of its own; it is exercised from
// here because the client is its primary consumer (same import path as layout.js)
import { describe, expect, it } from 'vitest';
import { anchorPoint, cloudPath } from '../../../shared/graphGeometry.js';

describe('anchorPoint', () => {
  const box = { x: 100, y: 200, w: 80, h: 40 };

  it('places side anchors on the border', () => {
    expect(anchorPoint(box, { side: 'top', at: 0.5 })).toEqual([140, 200]);
    expect(anchorPoint(box, { side: 'bottom', at: 0 })).toEqual([100, 240]);
    expect(anchorPoint(box, { side: 'left', at: 1 })).toEqual([100, 240]);
    expect(anchorPoint(box, { side: 'right', at: 0.25 })).toEqual([180, 210]);
  });

  it('defaults to the middle of a side and to the box center', () => {
    expect(anchorPoint(box, { side: 'top' })).toEqual([140, 200]);
    expect(anchorPoint(box, {})).toEqual([140, 220]);
  });
});

describe('cloudPath', () => {
  it('is deterministic for the same seed', () => {
    const net = { x: 0, y: 0, w: 300, h: 200, seed: 7 };
    expect(cloudPath(net)).toBe(cloudPath({ ...net }));
  });

  it('produces a closed svg path', () => {
    const d = cloudPath({ x: 0, y: 0, w: 300, h: 200, seed: 1 });
    expect(d).toMatch(/^M /);
    expect(d).toMatch(/ Z$/);
    expect(d).toContain(' Q ');
  });
});
