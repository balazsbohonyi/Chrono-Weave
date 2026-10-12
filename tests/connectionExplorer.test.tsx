import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionExplorer from '../src/components/ConnectionExplorer';
import { figurePerson, identifyPerson, sessionKey, type ContactPerson, type ConnectionSession } from '../src/services/connectionGraph';
import { A, B, M } from './connectionFixtures';
test('explorer labels hypotheses, accessible selection, stopped states and storage fallback without showing unchecked biographies', () => {
  const people: ContactPerson[]=[]; for(const p of [A,B,M]) identifyPerson(people,figurePerson({...p,shortDescription:'Unchecked biography must not appear.'}));
  const session: ConnectionSession={version:2,key:sessionKey('one',people[0].id,people[1].id),canvasId:'one',endpoints:[people[0].id,people[1].id],people,
    candidates:[{from:people[0].id,to:people[2].id,status:'unresolved',claim:'A proposed contact',assessment:{pair:[people[0].id,people[2].id],verdict:'unresolved',evidence:'',uncertainty:'Uncertain meeting.',provenance:{provider:'synthetic',model:'synthetic',version:2,assessedAt:1}}}],
    rounds:[],attempts:{},segment:1,status:'paused',phase:'Search budget reached',elapsedMs:12000,updatedAt:Date.now(),diagnostics:{tasks:2,people:1,pairs:1,stopReason:'work-budget'}};
  const markup=renderToStaticMarkup(<ConnectionExplorer session={session} busy={false} onStop={()=>{}} onContinue={()=>{}} onFresh={()=>{}} onClose={()=>{}}/>);
  assert.match(markup,/aria-modal="true"/); assert.match(markup,/Continue searching/); assert.match(markup,/Unresolved/);
  assert.match(markup,/role="button" tabindex="0"/); assert.match(markup,/readable list/); assert.match(markup,/Saving across reloads is unavailable/);
  assert.doesNotMatch(markup,/Unchecked biography must not appear/); assert.doesNotMatch(markup,/completion percentage|request count/);
});
