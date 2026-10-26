import { test } from 'node:test';
import assert from 'node:assert/strict';
import type React from 'react';
import { useFigureActions } from '../src/hooks/useFigureActions';
import { figure } from './helpers';

const actionItems = (props: Partial<Parameters<typeof useFigureActions>[0]> = {}) =>
  useFigureActions({ figure, onDiscover: () => {}, onTrace: () => {},
    onInspect: () => {}, onRelationship: () => {}, isDiscovering: false, ...props });
const actions = (props: Partial<Parameters<typeof useFigureActions>[0]> = {}) => actionItems(props).map(action => action.id);

test('the focus figure keeps biography and expansion actions while mapping is hidden', () => {
  assert.deepEqual(actions({ isFollowingFigure: true, focusFigureId: figure.id }), ['inspect', 'discover']);
});

test('other Follow a Figure cards retain relationship, biography and mapping but cannot expand', () => {
  assert.deepEqual(actions({ isFollowingFigure: true, focusFigureId: 'focus' }), ['relationship', 'inspect', 'trace']);
});

test('other canvas modes retain every available action even with a stale focus ID', () => {
  assert.deepEqual(actions(), ['inspect', 'trace', 'discover']);
  assert.deepEqual(actions({ isFollowingFigure: false, focusFigureId: figure.id }), ['inspect', 'trace', 'discover']);
});

test('an unresolved Follow a Figure focus cannot expand from an arbitrary card', () => {
  assert.deepEqual(actions({ isFollowingFigure: true }), ['inspect', 'trace']);
  assert.deepEqual(actions({ isFollowingFigure: true, focusFigureId: 'focus', onRelationship: undefined }), ['inspect', 'trace']);
});

test('connection guests get no View Relationship or expansion, but can move to the main canvas and back', () => {
  const move = () => {};
  assert.deepEqual(actions({ isFollowingFigure: true, focusFigureId: 'focus', isGuest: true, onPromote: move, onConnect: move }), ['inspect', 'trace', 'connect', 'promote']);
  assert.deepEqual(actions({ isGuest: true, onPromote: move }), ['inspect', 'trace', 'promote']);
  // Moved to the main canvas: an ordinary person again, who can be moved back.
  assert.deepEqual(actions({ onDemote: move }), ['inspect', 'trace', 'demote', 'discover']);
});

test('events remain limited to details regardless of the mapping policy', () => {
  const event = { ...figure, category: 'EVENTS' as const };
  assert.deepEqual(actions({ figure: event }), ['inspect']);
  assert.deepEqual(actions({ figure: event, isFollowingFigure: true, focusFigureId: figure.id }), ['inspect']);
  assert.deepEqual(actions({ figure: event, isFollowingFigure: true, focusFigureId: 'focus' }), ['relationship', 'inspect']);
});

test('View Relationship and biography use their separate callbacks and stop propagation', () => {
  const calls: string[] = [];
  let stopped = 0;
  const items = actionItems({ isFollowingFigure: true, focusFigureId: 'focus',
    onRelationship: selected => calls.push(`relationship:${selected.id}`),
    onInspect: selected => calls.push(`biography:${selected.id}`),
    onDiscover: () => calls.push('unexpected expansion') });
  const event = { stopPropagation: () => { stopped++; } } as React.MouseEvent;
  items.find(action => action.id === 'relationship')!.onClick(event);
  items.find(action => action.id === 'inspect')!.onClick(event);
  assert.deepEqual(calls, ['relationship:ada', 'biography:ada']);
  assert.equal(stopped, 2);
});

test('Connect to appears for people between mapping and expansion, only when connecting is available', () => {
  assert.deepEqual(actions({ onConnect: () => {} }), ['inspect', 'trace', 'connect', 'discover']);
  assert.deepEqual(actions(), ['inspect', 'trace', 'discover']);
  // Follow a Figure canvases allow connecting from the focus and from every other person.
  assert.deepEqual(actions({ onConnect: () => {}, isFollowingFigure: true, focusFigureId: figure.id }), ['inspect', 'connect', 'discover']);
  assert.deepEqual(actions({ onConnect: () => {}, isFollowingFigure: true, focusFigureId: 'focus' }), ['relationship', 'inspect', 'trace', 'connect']);
});

test('events never offer Connect to, because chains link people only', () => {
  const event = { ...figure, category: 'EVENTS' as const };
  assert.deepEqual(actions({ figure: event, onConnect: () => {} }), ['inspect']);
});

test('Connect to passes the person on and keeps the click away from the canvas', () => {
  const calls: string[] = [];
  let stopped = 0;
  const connect = actionItems({ onConnect: selected => calls.push(selected.id) }).find(action => action.id === 'connect')!;
  assert.equal(connect.label, 'Connect to…');
  connect.onClick({ stopPropagation: () => { stopped++; } } as React.MouseEvent);
  assert.deepEqual(calls, ['ada']);
  assert.equal(stopped, 1);
});
