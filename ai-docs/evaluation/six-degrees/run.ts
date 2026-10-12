// Explicit live evaluation only; never imported by application/default tests.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { priorityCases } from './cases';
import { reviewedCases, unsupportedControls } from './reviewed-cases';
import { figurePerson, identifyPerson, type ContactPerson } from '../../../src/services/connectionGraph';
import { MemoryStorage } from '../../../tests/helpers';

const root = resolve(process.argv[2] || '.');
const engine = process.argv[3] || 'old';
const out = resolve(process.argv[4] || `ai-docs/evaluation/six-degrees/${engine}-priority.json`);
const flags = process.argv.slice(5), reviewed = flags.includes('--set=reviewed'), controls = flags.includes('--set=controls'), warm = flags.includes('--warm');
const pairs = controls ? unsupportedControls.map(c => [c.from,c.to] as const) : reviewed ? reviewedCases.map(c => [c.from,c.to] as const) : priorityCases;
const picked = flags.find(f => f.startsWith('--case='));
const indices = picked ? [Number(picked.slice(7))] : pairs.map((_,i) => i);
if (indices.some(i => !pairs[i])) throw Error('Unknown evaluation case index.');
if (flags.includes('--dry-run')) {
  console.log(JSON.stringify({engine,root,set:controls?'direct-edge-controls':reviewed?'reviewed':'priority',cases:indices.length,knowledge:warm?'warm':'cold',ceilingMs:180_000}));
  process.exit(0);
}
mkdirSync(dirname(out), {recursive:true});
const config = {provider:process.env.PROVIDER||'gemini',model:process.env.MODEL||'',apiKey:process.env.API_KEY||'',
  ollamaMode:process.env.OLLAMA_MODE||'local',baseUrl:process.env.OLLAMA_BASE_URL||'http://localhost:11434'};
const metadata = {engine,provider:config.provider,model:config.model,ceilingMs:180_000,set:controls?'direct-edge-controls':reviewed?'source-backed-reference':'priority',
  knowledge:warm?'warm, retained across cases (old engine: legacy canvas caches only)':'cold, fresh repository/cache per pair'};

// Legacy general assessment transport ignores AbortSignal. Isolate each cold old run so even
// queued/retrying legacy transport cannot exceed the ceiling or leak into the following case.
if (engine==='old' && !warm && !flags.includes('--worker')) {
  const results: unknown[]=[];
  for (const index of indices) {
    const childOut=`${out}.case-${index}.json`,start=Date.now();
    const child=spawnSync(process.execPath,[resolve(process.argv[1]),root,engine,childOut,'--worker',`--case=${index}`,...(reviewed?['--set=reviewed']:controls?['--set=controls']:[])],
      {env:process.env,timeout:180_000,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let result: unknown;
    try { result=JSON.parse(readFileSync(childOut,'utf8')).results[0]; if ((result as {startedAt:number}).startedAt<start || !(result as {startedAt:number}).startedAt) throw Error('Stale worker artifact.'); }
    catch { result={from:pairs[index][0].name,to:pairs[index][1].name,elapsedMs:Date.now()-start,outcome:{status:child.error?'deadline':'error',error:'Isolated old-engine worker did not complete within the ceiling.'},review:'unscored'}; }
    results.push(result); writeFileSync(out,JSON.stringify({...metadata,results},null,2));
    console.log(`old: case ${index} recorded`);
  }
  process.exit(0);
}

const {createAIService}=await import(pathToFileURL(resolve(root,'src/services/aiService.ts')).href);
const {findConnection}=await import(pathToFileURL(resolve(root,'src/services/connectionPath.ts')).href);
const {withAbort}=await import(pathToFileURL(resolve(root,'src/services/utils.ts')).href);
const {MemoryConnectionRepository}=await import('../../../src/utils/connectionKnowledge');
const rawService=createAIService(config);
const transport=globalThis.fetch;
globalThis.fetch=(input,init)=>transport(typeof input==='string' && input.startsWith('/api/ollama/cloud') ? `http://localhost:3000${input}` : input,init);
let tasks=0;
const taskNames=new Set(['fetchConnectionPath','fetchRelationshipExplanation','discoverPersonalContacts','assessPersonalContacts','resolveFigure']);
const service=new Proxy(rawService,{get(target,key){const value=target[key];return typeof value==='function'? (...args:unknown[])=>{if(taskNames.has(String(key))) tasks++;return value.apply(target,args);}:value;}});
const sharedRepo=new MemoryConnectionRepository(), sharedStorage=new MemoryStorage();
const results: unknown[]=[];
for (const index of indices) {
  const [from,to]=pairs[index],start=Date.now(),signal=AbortSignal.timeout(180_000); tasks=0;
  let outcome: unknown;
  try {
    if (controls) {
      // Assess the direct edge only. These controls never assert that an indirect route is impossible.
      const people: ContactPerson[] = [], first=identifyPerson(people,figurePerson(from)),second=identifyPerson(people,figurePerson(to));
      const assessment=engine==='old' ? service.fetchRelationshipExplanation(from,to,signal,{contactOnly:true})
        : service.assessPersonalContacts([{first,second}],signal);
      outcome={status:'assessed',assessment:await withAbort(assessment,signal)};
    } else outcome=await withAbort(findConnection({service,from,to,figures:[from,to],storage:warm?sharedStorage:new MemoryStorage(),
      repository:warm?sharedRepo:new MemoryConnectionRepository(),signal,canvasId:'evaluation',provenance:{provider:config.provider,model:config.model}}),signal);
  } catch(error) {
    outcome={status:signal.aborted?'deadline':'error',error:error instanceof Error?error.message.replaceAll(config.apiKey||'\u0000','[REDACTED]'):'Unknown error'};
  }
  results.push({index,startedAt:start,from:from.name,to:to.name,elapsedMs:Date.now()-start,modelTasks:tasks,outcome,
    review:'pending independent review of every returned link; transport errors are unscored',reference:reviewed?reviewedCases[index].referenceRoute:undefined,
    control:controls?unsupportedControls[index]:undefined});
  writeFileSync(out,JSON.stringify({...metadata,results},null,2));
  console.log(`${engine}: case ${index}: ${Date.now()-start}ms`);
}
