import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CATEGORY_BAR_TEXT_COLORS, CATEGORY_COLORS, CATEGORY_LIST } from '../src/constants';
import { parseTheme, saveTheme, THEME_STORAGE_KEY } from '../src/utils/theme';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const tokens = (selector: string) => Object.fromEntries(
  [...css.slice(css.indexOf(selector)).split('}')[0].matchAll(/--color-([\w-]+):\s*(\d+ \d+ \d+);/g)]
    .map(([, name, channels]) => [name, channels.split(' ').map(Number)]));
const light = tokens(':root {');
const dark = tokens(':root[data-theme="dark"] {');
const luminance = (channels: number[]) => channels.map(channel => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (first: number[], second: number[]) => {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test('saved theme is applied before the stylesheet, with light as the fallback', () => {
  assert.ok(html.indexOf(bootstrap) < html.indexOf('href="/src/styles/tokens.css"'));
  for (const saved of [null, 'light', 'dark', 'system', 'invalid']) {
    const root = { dataset: {} as Record<string, string> };
    runInNewContext(bootstrap, {
      document: { documentElement: root },
      localStorage: { getItem: (key: string) => { assert.equal(key, THEME_STORAGE_KEY); return saved; } },
    });
    assert.equal(root.dataset.theme, parseTheme(saved));
  }
});

test('theme bootstrap and saving tolerate blocked browser storage', () => {
  const root = { dataset: {} as Record<string, string> };
  runInNewContext(bootstrap, {
    document: { documentElement: root },
    localStorage: { getItem: () => { throw new Error('Storage blocked'); } },
  });
  assert.equal(root.dataset.theme, 'light');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage blocked'); } });
    assert.doesNotThrow(() => saveTheme('dark'));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('both palettes define the same tokens and retain the original light category colors', () => {
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
  assert.deepEqual(light.canvas, [244, 236, 216]);
  const originalFills = [
    [96, 165, 250], [251, 191, 36], [132, 204, 22], [168, 181, 200],
    [239, 68, 68], [30, 41, 59], [139, 92, 246], [16, 185, 129], [6, 182, 212],
  ];
  const originalText = ['black', 'black', 'white', 'black', 'white', 'white', 'white', 'white', 'white'];
  for (const [i, category] of CATEGORY_LIST.entries()) {
    const fill = CATEGORY_COLORS[category].match(/--color-([\w-]+)/)![1];
    const text = CATEGORY_BAR_TEXT_COLORS[category].match(/--color-([\w-]+)/)![1];
    assert.deepEqual(light[fill], originalFills[i], category);
    assert.deepEqual(light[text], originalText[i] === 'white' ? [255, 255, 255] : [0, 0, 0], category);
  }
});

test('dark category bars and search focus have readable text and stand out from the canvas', () => {
  for (const category of CATEGORY_LIST) {
    const fill = CATEGORY_COLORS[category].match(/--color-([\w-]+)/)![1];
    const text = CATEGORY_BAR_TEXT_COLORS[category].match(/--color-([\w-]+)/)![1];
    assert.ok(contrast(dark[fill], dark[text]) >= 4.5, category + ' year text');
    // Leaders use a deeper slate; white labels keep the bar readable.
    const minimumFillContrast = category === 'LEADERS & BADDIES' ? 2 : 3;
    assert.ok(contrast(dark[fill], dark.canvas) >= minimumFillContrast, category + ' bar');
  }
  assert.ok(contrast(dark['timeline-search'], dark['timeline-search-text']) >= 4.5);
  assert.ok(contrast(dark['timeline-label'], dark.canvas) >= 4.5);
  for (const text of ['content-primary', 'content-heading', 'content-body', 'content-secondary', 'content-muted', 'content-faint', 'accent-text', 'success-text', 'danger-text']) {
    assert.ok(contrast(dark[text], dark.surface) >= 4.5, text);
  }
});

test('raised surfaces and controls retain light colors and readable dark text after blending', () => {
  const lightAliases = {
    'surface-card': 'surface', 'surface-card-hover': 'surface', 'card-muted': 'content-muted',
    'card-border': 'border', 'surface-dialog-header': 'surface-subtle',
    'surface-connector': 'surface', 'connector-border': 'border',
    'card-source-border': 'success-border', 'card-target-border': 'accent-border',
    'summary-surface': 'accent-softest', 'summary-text': 'content-heading', 'summary-border': 'accent-soft',
    'action-surface': 'accent-softest', 'action-surface-hover': 'accent-soft',
    'action-border': 'accent-soft', 'action-text': 'accent-text',
    'tab-selected': 'surface', 'tab-badge': 'accent-soft', 'tab-badge-text': 'accent-heading',
  };
  for (const [role, original] of Object.entries(lightAliases)) {
    assert.deepEqual(light[role], light[original], role + ' light appearance');
  }

  const blend = (foreground: number[], background: number[], opacity: number) =>
    foreground.map((channel, i) => channel * opacity + background[i] * (1 - opacity));
  const backdrop = blend(dark.surface, dark.canvas, 0.6);
  const cardBackgrounds = [
    dark['surface-card'], dark['surface-card-hover'],
    blend(dark['surface-card'], backdrop, 0.96),
    blend(dark['surface-card'], blend(dark.surface, dark.canvas, 0.5), 0.9),
  ];
  for (const background of cardBackgrounds) {
    for (const text of ['content-primary', 'content-heading', 'content-body', 'card-muted', 'success-heading', 'accent-heading']) {
      assert.ok(contrast(dark[text], background) >= 4.5, text + ' on a raised card');
    }
  }
  assert.ok(contrast(cardBackgrounds[2], backdrop) >= 1.3, 'overlay card separation');
  const header = blend(dark['surface-dialog-header'], dark.surface, 0.8);
  assert.ok(contrast(header, dark.surface) >= 1.15, 'dialog header separation');
  assert.ok(contrast(dark['surface-connector'], dark['surface-card']) >= 1.3, 'center circle separation');
  for (const border of ['card-source-border', 'card-target-border']) {
    assert.ok(contrast(dark[border], dark['surface-card']) >= 3, border);
  }
  const summary = blend(dark['summary-surface'], dark.surface, 0.5);
  assert.ok(contrast(dark['summary-text'], summary) >= 4.5, 'blue summary text');
  for (const background of [
    dark['action-surface'], dark['action-surface-hover'],
    blend(dark['action-surface'], dark['surface-card'], 0.6),
  ]) {
    assert.ok(contrast(dark['action-text'], background) >= 4.5, 'action icon');
  }
  assert.ok(contrast(dark['content-primary'], dark['tab-selected']) >= 4.5, 'selected tab');
  assert.ok(contrast(dark['tab-badge-text'], dark['tab-badge']) >= 4.5, 'selected tab count');
  for (const palette of [light, dark]) {
    assert.ok(contrast(palette['close-text'], palette['close-surface']) >= 4.5, 'close icon');
    assert.ok(contrast(palette['close-text-hover'], palette['close-surface-hover']) >= 4.5, 'hovered close icon');
  }
});
