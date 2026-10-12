// Compare baseline/current general prompt output. No model/network calls.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as current from '../../../src/services/prompts';
const baseline = await import(pathToFileURL(resolve(process.argv[2] || 'D:/develop/benchmarks/ChronoWeave-88ccd35','src/services/prompts.ts')).href);
const figure = {id:'p',name:'Ada Lovelace',birthYear:1815,deathYear:1852,occupation:'Mathematician',category:'SCIENTISTS' as const};
const other = {...figure,id:'q',name:'Charles Babbage',birthYear:1791,deathYear:1871};
let checks=0;
for (const key of ['HISTORIAN_SYSTEM_PROMPT','CONTACT_RULES','RELATIONSHIP_RULES','CONNECTION_TEST_PROMPT','PRE_FLIGHT_PROMPT']) {
  assert.equal(current[key],baseline[key],key); checks++;
}
for (const mode of ['time-span','era','figure','region','theme','freeform'] as const) {
  const context = {mode,query:figure.name,inferredStartYear:1750,inferredEndYear:1900,themeDescription:'A historical topic',activeCategories:['ALL' as const]};
  const calls:Array<[string,unknown[]]> = [
    ['buildPeoplePrompt',[1750,1900,10,context]],['buildEventsPrompt',[1750,1900,5,context]],
    ['buildDiscoveryPrompt',[figure,[other.name],1750,1900,context]],['buildRelatedFiguresPrompt',[figure,[other]]],
    ['buildRelationshipExplanationPrompt',[figure,other]],['buildRelationshipExplanationPrompt',[figure,other,{contactOnly:true}]],
    ['buildDeepDivePrompt',[figure]],['buildWeaveValidationPrompt',[{mode,query:figure.name}]],
    ['buildWeaveSuggestionPrompt',[[figure.name],undefined]],['buildCorrectionPrompt',['Invalid JSON.']],
  ];
  for(const [name,args] of calls){assert.equal(current[name](...args),baseline[name](...args),`${mode}/${name}`);checks++;}
}
console.log(`${checks} baseline/current general prompt comparisons passed.`);
