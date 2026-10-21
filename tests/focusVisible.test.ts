import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFocusVisible } from '../src/utils/focusVisible';

test('only focus that shows a focus ring counts, so a tooltip is not opened by focus the page moved after a mouse click', () => {
  const asks: string[] = [];
  const target = (visible: boolean) => ({ matches: (selector: string) => { asks.push(selector); return visible; } }) as unknown as EventTarget;
  assert.equal(isFocusVisible(target(true)), true);
  assert.equal(isFocusVisible(target(false)), false);
  assert.deepEqual(asks, [':focus-visible', ':focus-visible']);
});

test('a browser that does not know :focus-visible keeps showing the tooltip on every focus, and things that cannot match show nothing', () => {
  assert.equal(isFocusVisible({ matches: () => { throw new SyntaxError('not a valid selector'); } } as unknown as EventTarget), true);
  assert.equal(isFocusVisible(null), false);
  assert.equal(isFocusVisible({} as EventTarget), false);
});
