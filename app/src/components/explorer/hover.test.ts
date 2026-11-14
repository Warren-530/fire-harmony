// The hovered month store (hover.ts) and the panel's width (panelSize.ts): one update a frame, the newest job of a key,
// listeners told once per change; the width kept between 320 px and min(720 px, half the window).
import { describe, expect, it } from 'vitest';
import { hoveredMonth, inFrame, onHoveredMonth, previewMonth } from './hover';
import { PANEL_MAX, PANEL_MIN, afterPanelResize, clampPanel, panelDefault, panelMax, panelResizing, setPanelResizing } from './panelSize';

const frame = () => new Promise((r) => setTimeout(r, 40));

describe('the hovered month', () => {
  it('reaches the listeners once a frame, with the newest month', async () => {
    const seen: (number | null)[] = [];
    const off = onHoveredMonth(() => seen.push(hoveredMonth().ym));
    previewMonth(201501, 'timeline');
    previewMonth(201502, 'timeline');
    previewMonth(201503, 'chart');
    expect(seen).toEqual([]);                    // nothing before the frame
    await frame();
    expect(seen).toEqual([201503]);
    expect(hoveredMonth()).toEqual({ ym: 201503, from: 'chart' });
    previewMonth(201503, 'chart');               // no change: no call
    await frame();
    expect(seen).toEqual([201503]);
    previewMonth(null, 'calendar');              // leaving: no source
    await frame();
    expect(hoveredMonth()).toEqual({ ym: null, from: null });
    off();
  });

  it('runs the newest job of each key in the frame, with the month in the same update', async () => {
    const ran: string[] = [];
    let atNotify: string[] = [];
    const off = onHoveredMonth(() => { atNotify = [...ran]; });
    inFrame('a', () => ran.push('a1'));
    inFrame('a', () => ran.push('a2'));
    inFrame('b', () => { ran.push('b'); previewMonth(202001, 'calendar'); });
    await frame();
    expect(ran).toEqual(['a2', 'b']);
    expect(atNotify).toEqual(['a2', 'b']);       // the jobs ran before the listeners were told
    expect(hoveredMonth().ym).toBe(202001);
    previewMonth(null);
    await frame();
    off();
  });
});

describe('the panel width', () => {
  it('stays between 320 px and min(720 px, half the window)', () => {
    expect(panelMax(1440)).toBe(PANEL_MAX);
    expect(panelMax(1280)).toBe(640);
    expect(panelMax(1024)).toBe(512);
    expect(clampPanel(100, 1440)).toBe(PANEL_MIN);
    expect(clampPanel(900, 1440)).toBe(720);
    expect(clampPanel(600, 1024)).toBe(512);
    expect(clampPanel(400.4, 1280)).toBe(400);
    expect(panelDefault(1440)).toBe(384);
    expect(panelDefault(1100)).toBe(340);
  });

  it('tells the waiting parts once, when a drag ends', () => {
    let n = 0;
    const off = afterPanelResize(() => { n += 1; });
    setPanelResizing(true);
    expect(panelResizing()).toBe(true);
    setPanelResizing(true);
    expect(n).toBe(0);
    setPanelResizing(false);
    setPanelResizing(false);
    expect(n).toBe(1);
    off();
  });
});
