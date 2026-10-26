import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeStep } from '../src/components/connectionNetwork/escapeLadder';
import { barPhase, phaseText } from '../src/components/connectionNetwork/barPhase';

const state = (changes: Partial<Parameters<typeof escapeStep>[0]> = {}) => ({ maximized: false, panelOpen: false, hasSelection: false, sheetOpen: false, hasQuery: false, ...changes });

test('Esc outside full screen peels back a contact, the sheet and the search before it closes, as it always did', () => {
  assert.equal(escapeStep(state({ hasSelection: true, sheetOpen: true, hasQuery: true })), 'back');
  assert.equal(escapeStep(state({ sheetOpen: true, hasQuery: true })), 'dismiss-sheet');
  assert.equal(escapeStep(state({ hasQuery: true })), 'clear-query');
  assert.equal(escapeStep(state()), 'close');
  // The floating panel belongs to full screen only: a stale `panelOpen` does not change the docked ladder.
  assert.equal(escapeStep(state({ panelOpen: true })), 'close');
});

test('Esc in full screen hides the floating panel in one press, then restores, whatever is selected or searched', () => {
  assert.equal(escapeStep(state({ maximized: true, panelOpen: true, hasSelection: true, hasQuery: true })), 'hide-panel');
  // The hidden panel keeps its selection and search: the next press must not spend itself on steps nobody can see.
  assert.equal(escapeStep(state({ maximized: true, hasSelection: true, hasQuery: true, sheetOpen: true })), 'restore');
  assert.equal(escapeStep(state({ maximized: true })), 'restore');
});

test('the full ladder from a selected person in full screen: hide, restore, step back, close', () => {
  let current = state({ maximized: true, panelOpen: true, hasSelection: true });
  assert.equal(escapeStep(current), 'hide-panel');
  current = { ...current, panelOpen: false };
  assert.equal(escapeStep(current), 'restore');
  current = { ...current, maximized: false };
  assert.equal(escapeStep(current), 'back');
  current = { ...current, hasSelection: false };
  assert.equal(escapeStep(current), 'close');
});

test('the bar phase comes from one value: no session, solved, found, searching, otherwise paused', () => {
  const phase = (changes: Partial<Parameters<typeof barPhase>[0]> = {}) => barPhase({ hasSession: true, busy: false, success: false, solved: false, ...changes });
  assert.equal(phase({ hasSession: false, busy: true }), 'opening');
  assert.equal(phase({ busy: true }), 'searching');
  assert.equal(phase(), 'paused');
  assert.equal(phase({ success: true }), 'found');
  assert.equal(phase({ success: true, busy: true }), 'found');
  assert.equal(phase({ solved: true }), 'solved');
  assert.equal(phase({ solved: true, success: true }), 'solved');
});

test('the phase text is what the header always said', () => {
  assert.equal(phaseText(true, 'Asking about Newton', 'Searching'), 'Asking about Newton');
  assert.equal(phaseText(true, undefined, 'Searching'), 'Searching');
  assert.equal(phaseText(true, undefined, undefined), 'Identifying endpoint');
  assert.equal(phaseText(false, 'Search budget reached', 'Searching'), 'Search budget reached');
  assert.equal(phaseText(false, undefined, 'Searching'), 'Paused');
});
