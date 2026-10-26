import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import ControlPanel from '../src/components/ControlPanel';
import Legend from '../src/components/Legend';
import Sidebar from '../src/components/Sidebar';

const panel = (away?: boolean) => renderToStaticMarkup(<ControlPanel canvasPrompt="Philosophers" searchQuery="" onOpenLauncher={() => {}} isBuilding={false} hasFigures hasCategoryFilters
  selectedCategoryCount={0} onSearch={() => {}} searchResultCount={0} currentResultIndex={0} onNextResult={() => {}} onPrevResult={() => {}} onOpenSettings={() => {}} onToggleLegend={() => {}}
  isLegendOpen={false} away={away} />);
const legend = (away?: boolean) => renderToStaticMarkup(<Legend selectedCategories={new Set()} onToggleCategory={() => {}} isOpen away={away} />);
const sidebar = (fullHeight?: boolean, isLegendOpen = false) => renderToStaticMarkup(<Sidebar selectedFigures={[]} currentYear={null} onTraceRelationships={async () => {}} onDiscover={() => {}}
  onInspect={() => {}} isCollapsed onToggleCollapse={() => {}} selectedCategories={new Set()} isLegendOpen={isLegendOpen} fullHeight={fullHeight} />);

test('while a connection plays on the stage the header and the category filters step away and leave the tab order, and come back unchanged', () => {
  assert.match(panel(true), /<header[^>]*class="canvas-header is-away"[^>]*inert=""/);
  assert.match(panel(), /class="canvas-header"/); assert.doesNotMatch(panel(), /is-away|inert/);
  assert.match(legend(true), /id="canvas-category-filters"[^>]*aria-hidden="true"[^>]*inert=""[^>]*class="[^"]*pointer-events-none is-away"/);
  assert.doesNotMatch(legend(), /is-away|inert=""/);
  // Away is a slide and a fade, then visibility, so they leave the tab order only once gone.
  const css = readFileSync('src/styles/globals.css', 'utf8');
  assert.match(css, /\.canvas-header\.is-away \{[^}]*translateY\(-100%\)[^}]*opacity: 0; visibility: hidden;[^}]*transition-delay: 0s, 0s, 400ms;/);
  assert.match(css, /#canvas-category-filters\.is-away \{ opacity: 0; visibility: hidden; transition-delay: 0s, 400ms; \}/);
});

test('the sidebar reaches the top while the stage has the whole height, and sits under the header and the filters otherwise', () => {
  assert.match(sidebar(true), /id="canvas-sidebar"[^>]*top-0 h-screen/);
  assert.doesNotMatch(sidebar(true, true), /top-\[114px\]|top-\[52px\]/);
  assert.match(sidebar(), /top-\[52px\] h-\[calc\(100vh-52px\)\]/);
  assert.match(sidebar(false, true), /top-\[114px\] h-\[calc\(100vh-114px\)\]/);
});
