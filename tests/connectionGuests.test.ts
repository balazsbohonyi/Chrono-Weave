import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeGuestIds, addGuests, figureConnections, LEGACY_GUEST_KEY, migrateGuests, moveBackToConnections, moveToMain, normalizeGuests, removeConnectionGuests, splitGuests } from '../src/utils/connectionGuests';
import { connectionPathKey, deleteConnectionPath, listConnectionPaths, saveWovenFigureIds, wovenFigureIds } from '../src/utils/connectionPaths';
import { calculateGalleryLayout, GALLERY_CARD_HEIGHT, GALLERY_CARD_WIDTH, GALLERY_COLUMN_GAP } from '../src/utils/galleryLayout';
import { calculateCanvasTimelineLayout, calculateTimelineLayout } from '../src/utils/timelineLayout';
import { CanvasCache, createCanvasSnapshot, loadCanvasHistory, saveCanvasHistory } from '../src/utils/canvasHistory';
import { CANVAS_LAYOUT_VERSION } from '../src/utils/canvasLayout';
import { MAX_RECENT_CONNECTIONS } from '../src/constants';
import type { HistoricalFigure } from '../src/types';
import { MemoryStorage } from './helpers';
import { saveTestConnectionPath, person } from './connectionFixtures';

const hitler = person('Hitler', 1889, 1945), goering = person('Goering', 1893, 1946);
const obama = { ...person('Obama', 1961, 2026), category: 'LEADERS & BADDIES' as const };
const clinton = person('Clinton', 1946, 2026), affleck = person('Affleck', 1972, 2026);
// Saved links must join contemporaries: Kennedy bridges Hitler and the later presidents.
const kennedy = person('Kennedy', 1917, 1963);

test('guests record every connection that needs them; deleting one orphans only those no other needs', () => {
  let guests = addGuests({}, ['obama', 'clinton'], 'first');
  guests = addGuests(guests, ['clinton', 'affleck'], 'second');
  assert.deepEqual(guests, { obama: ['first'], clinton: ['first', 'second'], affleck: ['second'] });
  assert.equal(addGuests(guests, [], 'third'), guests);
  const removed = removeConnectionGuests({ guests }, 'first');
  assert.deepEqual(removed.orphaned, ['obama']);
  assert.deepEqual(removed.guests, { clinton: ['second'], affleck: ['second'] });
  // Someone moved to the main canvas stays when their last connection goes, and simply stops being a guest.
  const moved = removeConnectionGuests({ guests, movedToMain: ['affleck', 'clinton'] }, 'second');
  assert.deepEqual(moved.orphaned, []);
  assert.deepEqual(moved.guests, { obama: ['first'], clinton: ['first'] });
  assert.deepEqual(moved.movedToMain, ['clinton']);
});

test('moving a guest to the main canvas is reversible, and so is the category it brought', () => {
  const writer = { ...person('Hemingway', 1899, 1961), category: 'WRITERS' as const };
  const poet = { ...person('Pound', 1885, 1972), category: 'WRITERS' as const };
  const config = { start: 1880, end: 2030, layoutMode: 'gallery' as const, layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'manual' as const,
    guests: { Hemingway: ['k'], Pound: ['k'], Obama: ['k'] },
    weaveContext: { mode: 'theme' as const, query: 'Circle', inferredStartYear: 1889, inferredEndYear: 1946, themeDescription: 'Circle', activeCategories: ['THINKERS' as const] } };
  const figures = [hitler, writer, poet, obama];
  const moved = moveToMain(config, writer);
  assert.deepEqual(moved.movedToMain, ['Hemingway']);
  assert.deepEqual([...activeGuestIds(moved)].sort(), ['Obama', 'Pound']);
  assert.deepEqual(moved.weaveContext?.activeCategories, ['THINKERS', 'WRITERS']);
  assert.deepEqual(moved.movedCategories, ['WRITERS']);
  assert.equal(moveToMain(moved, writer), moved);
  // Reloading keeps the move: the category is now one of the canvas's.
  const storage = new MemoryStorage();
  saveCanvasHistory(storage, { version: 1, current: createCanvasSnapshot(figures, moved), history: [] });
  const reloaded = loadCanvasHistory(storage).current!.config;
  assert.deepEqual([reloaded.movedToMain, reloaded.movedCategories], [['Hemingway'], ['WRITERS']]);
  // A second writer shares the category: it leaves only once neither of them is on the main canvas.
  const both = moveToMain(moved, poet);
  assert.deepEqual(both.movedCategories, ['WRITERS']);
  const one = moveBackToConnections(both, writer, figures);
  assert.deepEqual(one.weaveContext?.activeCategories, ['THINKERS', 'WRITERS']);
  const none = moveBackToConnections(one, poet, figures);
  assert.deepEqual(none.movedToMain, []);
  assert.deepEqual(none.weaveContext?.activeCategories, ['THINKERS']);
  assert.deepEqual(none.movedCategories, []);
  // A category the canvas had before is never taken away; someone who was never moved is left alone.
  const thinker = { ...person('Russell', 1872, 1970), category: 'THINKERS' as const };
  const withThinker = { ...config, guests: { ...config.guests, Russell: ['k'] } };
  const back = moveBackToConnections(moveToMain(withThinker, thinker), thinker, [...figures, thinker]);
  assert.deepEqual(back.weaveContext?.activeCategories, ['THINKERS']);
  assert.equal(moveBackToConnections(config, hitler, figures), config);
  assert.equal(moveToMain(config, hitler), config);
});

test('everyone on a saved connection, ends and links, main canvas or guest, lists it, newest first', () => {
  const storage = new MemoryStorage(), figures = [hitler, goering, kennedy, clinton, obama];
  saveTestConnectionPath(storage, [hitler, kennedy, clinton], ['met', 'met'], 1);
  saveTestConnectionPath(storage, [hitler, kennedy, obama], ['met', 'met'], 2);
  const first = connectionPathKey('Hitler', 'Clinton'), second = connectionPathKey('Hitler', 'Obama');
  const map = figureConnections(storage, figures);
  assert.deepEqual(map.get('Hitler')!.map(entry => entry.key), [second, first]);
  assert.deepEqual(map.get('Kennedy')!.map(entry => entry.key), [second, first]);
  assert.deepEqual(map.get('Clinton')!.map(entry => entry.figures.map(p => p.id)), [['Hitler', 'Kennedy', 'Clinton']]);
  assert.equal(map.has('Goering'), false);
  // A connection whose people are no longer all on the canvas is not listed for anyone.
  assert.equal(figureConnections(storage, [hitler, kennedy, clinton]).get('Hitler')!.length, 1);
});

test('saved guests are kept only for people still on the canvas, with valid keys', () => {
  assert.deepEqual(normalizeGuests({ a: ['k', 'k', 3, ''], b: [], gone: ['k'], c: 'k' }, new Set(['a', 'b', 'c'])), { a: ['k'] });
  assert.deepEqual(normalizeGuests(null, new Set(['a'])), {});
  assert.deepEqual(splitGuests([hitler, obama, goering], new Set(['Obama'])), { core: [hitler, goering], guests: [obama] });
});

test('migration makes woven-in people guests of the saved connections they are on, or of the legacy key', () => {
  const storage = new MemoryStorage();
  saveTestConnectionPath(storage, [hitler, kennedy, clinton], ['met', 'met']);
  saveWovenFigureIds(storage, ['Kennedy', 'Clinton', 'Affleck', 'NotOnCanvas']);
  const guests = migrateGuests([hitler, goering, kennedy, clinton, affleck], storage);
  const key = connectionPathKey('Hitler', 'Clinton');
  assert.equal(listConnectionPaths(storage, [hitler, kennedy, clinton]).length, 1);
  assert.deepEqual(guests, { Kennedy: [key], Clinton: [key], Affleck: [LEGACY_GUEST_KEY] });
  assert.deepEqual(migrateGuests([hitler], new MemoryStorage()), {});
});

test('deleting a connection removes its saved path and the woven record of the people it took along', () => {
  const storage = new MemoryStorage();
  saveTestConnectionPath(storage, [hitler, kennedy, clinton], ['met', 'met']);
  saveWovenFigureIds(storage, ['Kennedy', 'Clinton']);
  assert.equal(listConnectionPaths(storage, [hitler, kennedy, clinton]).length, 1);
  deleteConnectionPath(storage, connectionPathKey('Hitler', 'Clinton'), ['Kennedy']);
  assert.deepEqual(listConnectionPaths(storage, [hitler, kennedy, clinton]), []);
  assert.deepEqual([...wovenFigureIds(storage)], ['Clinton']);
});

test('an evicted saved path keeps its guests on the canvas', () => {
  const storage = new MemoryStorage(), people: HistoricalFigure[] = [hitler];
  let guests = {};
  for (let index = 0; index <= MAX_RECENT_CONNECTIONS; index++) {
    const guest = person(`Guest ${index}`, 1900, 1960);
    people.push(guest);
    saveTestConnectionPath(storage, [hitler, guest], ['met'], index + 1);
    guests = addGuests(guests, [guest.id], connectionPathKey('Hitler', guest.id));
  }
  assert.equal(listConnectionPaths(storage, people).length, MAX_RECENT_CONNECTIONS);
  // Eviction is not deletion: every guest still has the connection that brought them in.
  assert.equal(Object.keys(guests).length, MAX_RECENT_CONNECTIONS + 1);
});

test('the gallery lays guests out in a block of their own below everyone else, under a header', () => {
  const core = Array.from({ length: 12 }, (_, index) => person(`Core ${index}`, 1880, 1950));
  const layout = calculateGalleryLayout([...core, obama, clinton, affleck], new Set(['Obama', 'Clinton', 'Affleck']));
  const lowestCore = Math.max(...layout.placements.filter(item => item.figure.id.startsWith('Core')).map(item => item.y + GALLERY_CARD_HEIGHT));
  const guests = layout.placements.filter(item => !item.figure.id.startsWith('Core'));
  assert.equal(guests.length, 3);
  assert.ok(guests.every(item => item.y > lowestCore));
  assert.equal(layout.sections.length, 1);
  assert.equal(layout.sections[0].count, 3);
  assert.ok(layout.sections[0].y > lowestCore && layout.sections[0].y < Math.min(...guests.map(item => item.y)));
  assert.ok(guests.every(item => item.y + GALLERY_CARD_HEIGHT <= layout.bounds.height));
  // Without guests nothing changes.
  assert.deepEqual(calculateGalleryLayout(core, new Set()), calculateGalleryLayout(core));
  assert.deepEqual(calculateGalleryLayout(core).sections, []);
});

test('guest tiers are laid like bricks: each half a card off the tier above, never aligned with it, and never overlapping', () => {
  const core = Array.from({ length: 30 }, (_, index) => person(`Core ${index}`, 1880, 1950));
  const coreOnly = calculateGalleryLayout(core);
  const pitch = GALLERY_CARD_WIDTH + GALLERY_COLUMN_GAP;
  for (let count = 1; count <= 40; count++) {
    const guests = Array.from({ length: count }, (_, index) => person(`Guest ${String(index).padStart(2, '0')}`, 1900, 1990));
    const layout = calculateGalleryLayout([...core, ...guests], new Set(guests.map(guest => guest.id)));
    // The main grid is laid out exactly as without guests (only centred on the wider of the two blocks).
    const shift = Math.min(...layout.placements.filter(item => item.figure.id.startsWith('Core')).map(item => item.x)) - Math.min(...coreOnly.placements.map(item => item.x));
    assert.deepEqual(layout.placements.filter(item => item.figure.id.startsWith('Core')).map(({ figure, x, y }) => [figure.id, x - shift, y]),
      coreOnly.placements.map(({ figure, x, y }) => [figure.id, x, y]));
    const tiers = new Map<number, number>();
    for (const item of layout.placements.filter(item => item.figure.id.startsWith('Guest'))) tiers.set(item.y, Math.min(tiers.get(item.y) ?? Infinity, item.x));
    const lefts = [...tiers.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    for (let tier = 1; tier < lefts.length; tier++) {
      // An odd number of half cards apart: the cards of one tier sit between those of the next.
      const halves = Math.abs(lefts[tier] - lefts[tier - 1]) / (pitch / 2);
      assert.ok(Math.abs(halves - Math.round(halves)) < 1e-9 && Math.round(halves) % 2 === 1, `${count} guests, tier ${tier}: ${halves} half cards`);
    }
    // Every tier is at most one card away from its centred place.
    const block = layout.placements.filter(item => item.figure.id.startsWith('Guest'));
    const blockLeft = Math.min(...block.map(item => item.x)), blockRight = Math.max(...block.map(item => item.x + GALLERY_CARD_WIDTH));
    for (const [y, left] of tiers) {
      const length = block.filter(item => item.y === y).length;
      assert.ok(Math.abs(left - (blockLeft + blockRight - length * pitch + GALLERY_COLUMN_GAP) / 2) <= pitch / 2 + 1e-9, `${count} guests, tier at ${y} near its centre`);
    }
    for (const [index, item] of layout.placements.entries()) {
      assert.ok(item.x >= 0 && item.x + GALLERY_CARD_WIDTH <= layout.bounds.width + 1e-9, `${count} guests: ${item.figure.id} within bounds`);
      for (const other of layout.placements.slice(index + 1)) {
        const overlap = item.x < other.x + GALLERY_CARD_WIDTH && item.x + GALLERY_CARD_WIDTH > other.x && item.y < other.y + GALLERY_CARD_HEIGHT && item.y + GALLERY_CARD_HEIGHT > other.y;
        assert.equal(overlap, false, `${count} guests`);
      }
    }
  }
});

test('the timeline puts guests in a band below everyone else, after an empty header row', () => {
  const core = [hitler, goering, person('Himmler', 1900, 1945)];
  const plain = calculateTimelineLayout(core);
  const layout = calculateCanvasTimelineLayout([...core, obama, clinton], new Set(['Obama', 'Clinton']));
  assert.equal(layout.guestRow, plain.totalRows);
  const levels = new Map(layout.layoutData.map(item => [item.figure.id, item.level]));
  for (const item of plain.layoutData) assert.equal(levels.get(item.figure.id), item.level);
  assert.ok(levels.get('Obama')! > layout.guestRow! && levels.get('Clinton')! > layout.guestRow!);
  assert.ok(layout.totalRows > layout.guestRow!);
  assert.deepEqual(calculateCanvasTimelineLayout(core, new Set()), plain);
});

test('canvas history stores guests and their visibility, and migrates canvases saved before guests', () => {
  const config = { start: 1880, end: 2030, layoutMode: 'gallery' as const, layoutVersion: CANVAS_LAYOUT_VERSION, layoutSelection: 'manual' as const,
    weaveContext: { mode: 'theme' as const, query: 'Hitler and his circle', inferredStartYear: 1889, inferredEndYear: 1946, themeDescription: 'Inner circle', activeCategories: ['THINKERS' as const] } };
  const cache = new CanvasCache();
  saveTestConnectionPath(cache, [hitler, kennedy, obama], ['met', 'met']);
  saveWovenFigureIds(cache, ['Kennedy', 'Obama']);
  // Saved before guests were recorded: the config has no guest map at all.
  const { guests: _none, ...oldConfig } = createCanvasSnapshot([hitler, kennedy, obama], config, cache.snapshot()).config;
  const old = { ...createCanvasSnapshot([hitler, kennedy, obama], config, cache.snapshot()), config: oldConfig };
  const storage = new MemoryStorage();
  saveCanvasHistory(storage, { version: 1, current: old, history: [] });
  const migrated = loadCanvasHistory(storage).current!;
  // Obama is outside the canvas categories, but as a guest the canvas keeps them.
  assert.deepEqual(migrated.figures.map(figure => figure.id), ['Hitler', 'Kennedy', 'Obama']);
  const key = connectionPathKey('Hitler', 'Obama');
  assert.deepEqual(migrated.config.guests, { Kennedy: [key], Obama: [key] });
  assert.equal(migrated.view.guestVisibility, 'show');

  const promoted = { ...migrated, config: { ...migrated.config, guests: {} }, view: { ...migrated.view, guestVisibility: 'dim' as const } };
  saveCanvasHistory(storage, { version: 1, current: promoted, history: [] });
  const reloaded = loadCanvasHistory(storage).current!;
  // Migration runs once: an empty guest map is kept, even though both are still recorded as woven in.
  assert.deepEqual(reloaded.config.guests, {});
  assert.equal(reloaded.view.guestVisibility, 'dim');
});
