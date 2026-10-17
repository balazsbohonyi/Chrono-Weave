import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SixDegreesInfoDialog, { SIX_DEGREES_INFO, SIX_DEGREES_INFO_LABEL, SixDegreesInfoButton } from '../src/components/SixDegreesInfo';
import ConnectionExplorer from '../src/components/ConnectionExplorer';
import ConnectionStage from '../src/components/ConnectionStage';
import ConnectionPanel, { ConnectionHeader } from '../src/components/ConnectionPanel';
import ConnectionPicker from '../src/components/ConnectionPicker';
import { classifyConnectionTarget } from '../src/services/connectionPath';
import { figurePerson, identifyPerson, sessionKey, type ContactPerson, type ConnectionSession } from '../src/services/connectionGraph';
import type { ActiveConnection } from '../src/hooks/useConnection';
import type { HistoricalFigure } from '../src/types';
import { A, B } from './connectionFixtures';

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const label = `aria-label="${SIX_DEGREES_INFO_LABEL}"`;
const person = (id: string, name: string, birthYear: number, deathYear: number): HistoricalFigure =>
  ({ id, name, birthYear, deathYear, occupation: 'Painter', category: 'ARTISTS' });
const [a, m, b] = [person('a', 'Anna Alpha', 1500, 1560), person('m', 'Marco Middle', 1520, 1590), person('b', 'Bruno Beta', 1580, 1650)];
const connected: ActiveConnection = { id: 1, chain: [a, m, b], links: [{ from: a, to: m, evidence: 'Shared a workshop.' }, { from: m, to: b, evidence: 'Taught him.' }] };

test('the dialog explains the original idea, the twist across centuries, how links are accepted and how to read the result', () => {
  const markup = renderToStaticMarkup(<SixDegreesInfoDialog onClose={() => {}} />);
  assert.match(markup, /role="dialog"/); assert.match(markup, /aria-modal="true"/); assert.match(markup, /aria-labelledby=/);
  const words = text(markup);
  for (const heading of ['The original idea', 'The twist here', 'How a link is accepted', 'Reading the result']) assert.ok(words.includes(heading), heading);
  assert.match(words, /Karinthy/); assert.match(words, /Milgram/);
  // The twist: centuries apart, people no longer alive, and every link between people alive at the same time.
  assert.match(words, /centuries apart/); assert.match(words, /no longer alive/); assert.match(words, /alive at the same time/);
  assert.match(words, /named battle or campaign/);
  assert.match(words, /not proven to be the shortest/);
  // The example chain names every person, and the dialog stays free of implementation detail.
  for (const { name } of SIX_DEGREES_INFO.example.people) assert.ok(words.includes(name), name);
  assert.doesNotMatch(words, /\b21\b|Gemini|OpenRouter|Ollama/);
  assert.match(markup, /aria-label="Close"/);
});

test('the two pictures sit inside the twist, between its two paragraphs, and not above the first section', () => {
  const markup = renderToStaticMarkup(<SixDegreesInfoDialog onClose={() => {}} />);
  const at = (needle: string) => markup.indexOf(needle);
  assert.equal(markup.match(/class="sdi-diagrams"/g)?.length, 1);
  // The original idea comes straight after the title, then the twist: its first paragraph, the pictures, then the paragraph on overlapping lives.
  assert.ok(at('sdi-title') < at('The original idea') && at('The original idea') < at('The twist here'));
  assert.ok(at('The twist here') < at('The two ends do not have to belong') && at('The two ends do not have to belong') < at('sdi-diagrams'));
  assert.ok(at('sdi-diagrams') < at('Time is crossed by a chain of overlapping lives') && at('Time is crossed by a chain of overlapping lives') < at('sdi-example'));
});

test('every example link overlaps in time, as the twist says', () => {
  const { people } = SIX_DEGREES_INFO.example;
  assert.equal(SIX_DEGREES_INFO.example.links.length, people.length - 1);
  for (let index = 1; index < people.length; index++) {
    const [first, second] = [people[index - 1], people[index]];
    assert.ok(first.birth <= second.death && second.birth <= first.death, `${first.name} and ${second.name} were alive together`);
  }
});

test('the button names what it opens and can mark itself as a stage control', () => {
  const markup = renderToStaticMarkup(<SixDegreesInfoButton onOpen={() => {}} stageControl />);
  assert.match(markup, new RegExp(label.replace(/[?]/g, '\\?'))); assert.match(markup, /aria-haspopup="dialog"/); assert.match(markup, /data-stage-control/);
  assert.doesNotMatch(renderToStaticMarkup(<SixDegreesInfoButton onOpen={() => {}} />), /data-stage-control/);
});

test('the explorer header, the stage header, the sidebar and the picker each carry the button, and only when they can open it', () => {
  const people: ContactPerson[] = []; for (const p of [A, B]) identifyPerson(people, figurePerson(p));
  const session: ConnectionSession = { version: 2, key: sessionKey('one', people[0].id, people[1].id), canvasId: 'one', endpoints: [people[0].id, people[1].id], people, candidates: [],
    rounds: [], attempts: {}, segment: 1, status: 'paused', phase: 'Paused', elapsedMs: 0, updatedAt: 1, diagnostics: { tasks: 0, people: 0, pairs: 0, stopReason: 'work-budget' } };
  const explorer = (extra = {}) => renderToStaticMarkup(<ConnectionExplorer session={session} busy={false} onStop={() => {}} onContinue={() => {}} onFresh={() => {}} onClose={() => {}} {...extra} />);
  const withInfo = explorer({ onOpenInfo: () => {} });
  assert.match(withInfo, new RegExp(label.replace(/[?]/g, '\\?')));
  // It sits right after the kicker, before the people.
  assert.ok(withInfo.indexOf('Contact exploration</p>') < withInfo.indexOf('aria-label="What is Six'));
  assert.doesNotMatch(explorer(), /What is Six Degrees/);
  // While the explanation is open the overlay stands back.
  assert.match(explorer({ suspended: true }), /class="connection-explorer"[^>]*inert/);

  const stage = (onOpenInfo?: () => void) => renderToStaticMarkup(<ConnectionStage connection={{ nodeIds: ['a', 'm', 'b'], playId: 1, animate: false }} chain={[a, m, b]} links={connected.links}
    currentIndex={null} focus={null} inset={{ top: 52, right: 0 }} canExit hidden={false} onStep={() => {}} onEnd={() => {}} onExit={() => {}} onReplay={() => {}} onExplain={() => {}} onInspect={() => {}} onOpenInfo={onOpenInfo} />);
  const stageMarkup = stage(() => {});
  assert.match(stageMarkup, /What is Six Degrees of Separation\?/);
  // It sits right after the degrees badge, and is a bare icon: the round buttons are only Replay and Close.
  assert.ok(stageMarkup.indexOf('degrees apart') < stageMarkup.indexOf('What is Six Degrees') && stageMarkup.indexOf('What is Six Degrees') < stageMarkup.indexOf('Replay the connection'));
  assert.match(stageMarkup, /class="six-info-button is-plain"/); assert.doesNotMatch(stageMarkup, /close-button six-info-button/);
  assert.doesNotMatch(stage(), /What is Six Degrees/);

  const header = renderToStaticMarkup(<ConnectionHeader connection={connected} onClose={() => {}} onOpenInfo={() => {}} />);
  assert.match(header, /What is Six Degrees of Separation\?/);
  assert.ok(header.indexOf('What is Six Degrees') < header.indexOf('Hide this connection'));
  assert.doesNotMatch(renderToStaticMarkup(<ConnectionHeader connection={connected} onClose={() => {}} />), /What is Six Degrees/);

  const panel = (onOpenInfo?: () => void) => renderToStaticMarkup(<ConnectionPanel connection={null} currentIndex={null} recent={[]} canvasIds={new Set()} isBusy={false}
    onClose={() => {}} onReplay={() => {}} onFocusPerson={() => {}} onExplain={() => {}} renderActions={() => null} onOpenInfo={onOpenInfo} />);
  assert.match(text(panel(() => {})), /How does this work\?/);
  assert.doesNotMatch(text(panel()), /How does this work\?/);

  const source = person('s', 'Leonardo da Vinci', 1452, 1519);
  const picker = (onOpenInfo?: () => void) => renderToStaticMarkup(<ConnectionPicker source={source} figures={[source]} error={null} initialDraft="" topOffset={64}
    statusFor={figure => classifyConnectionTarget(source, figure)} onPick={() => {}} onSubmitName={() => {}} onCancel={() => {}} onOpenInfo={onOpenInfo} />);
  assert.match(picker(() => {}), /What is Six Degrees of Separation\?/);
  assert.doesNotMatch(picker(), /What is Six Degrees/);
});
