// Explicitly synthetic browser mechanics fixture. Never imported by the app or production solver.
import { createCanvasSnapshot, defaultCanvasView, CANVAS_HISTORY_KEY } from '../../../src/utils/canvasHistory';
import { figurePerson, identifyPerson, sessionKey, type ContactPerson, type ConnectionSession } from '../../../src/services/connectionGraph';
import type { HistoricalFigure } from '../../../src/types';
import { CONNECTION_TEST_PROMPT } from '../../../src/services/prompts';
export const fixturePeople: HistoricalFigure[] = [
  { id: 'fixture-alpha', name: 'Fixture Alpha', birthYear: 1500, deathYear: 1560, occupation: 'Synthetic test endpoint', category: 'THINKERS' },
  { id: 'fixture-middle', name: 'Fixture Middle', birthYear: 1550, deathYear: 1640, occupation: 'Synthetic test contact', category: 'SCIENTISTS' },
  { id: 'fixture-next', name: 'Fixture Next', birthYear: 1630, deathYear: 1710, occupation: 'Synthetic test contact', category: 'WRITERS' },
  { id: 'fixture-beta', name: 'Fixture Beta', birthYear: 1700, deathYear: 1760, occupation: 'Synthetic test endpoint', category: 'THINKERS' },
];
export function seedBrowserCanvases() {
  const settings = ['chrono_provider', 'chrono_settings_ollama_local', CANVAS_HISTORY_KEY, 'chrono_theme'];
  const original = Object.fromEntries(settings.map(key => [key, localStorage.getItem(key)]));
  const config = { start: 1400, end: 1800, layoutMode: 'timeline' as const, layoutVersion: 3, layoutSelection: 'manual' as const };
  const current = createCanvasSnapshot([fixturePeople[0], fixturePeople[3]], config);
  current.id = 'six-degrees-preview-timeline'; current.view = { ...defaultCanvasView(), isSidebarCollapsed: false, selectedCategories: ['THINKERS'] };
  const gallery = createCanvasSnapshot(fixturePeople, { ...config, layoutMode: 'gallery' });
  gallery.id = 'six-degrees-preview-gallery'; gallery.view = { ...current.view, selectedCategories: ['THINKERS', 'SCIENTISTS', 'WRITERS'] };
  gallery.cache['chrono_path_legacy-fixture'] = JSON.stringify({ version: 1, ids: fixturePeople.map(p => p.id), evidence: ['legacy', 'legacy', 'legacy'], createdAt: 1 });
  localStorage.setItem(CANVAS_HISTORY_KEY, JSON.stringify({ version: 1, current, history: [gallery] }));
  localStorage.setItem('chrono_provider', 'ollama'); localStorage.setItem('chrono_settings_ollama_local', JSON.stringify({ model: 'six-degrees-synthetic', baseUrl: 'http://localhost:11434' }));
  return original;
}
export function installSyntheticTransport(delayMs = 1200) {
  const originalFetch = window.fetch.bind(window);
  const calls: string[] = [];
  window.fetch = async (input, init) => {
    if (!String(input).includes('localhost:11434')) return originalFetch(input, init);
    if (String(input).endsWith('/tags')) return Response.json({ models: [{ name: 'six-degrees-synthetic' }, { name: 'six-degrees-synthetic-2' }] });
    const request = JSON.parse(String(init?.body || '{}')), prompt = request.messages?.find((m: { role: string }) => m.role === 'user')?.content || '';
    calls.push(prompt.split('\n')[0]);
    await new Promise<void>((resolve, reject) => {
      const signal = init?.signal; const timer = setTimeout(resolve, delayMs);
      if (signal?.aborted) { clearTimeout(timer); reject(signal.reason); }
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    let response: unknown = null;
    if (prompt.startsWith('Assess a historical canvas request')) response = {
      isValid: true, errorMessage: null, inferredStartYear: 1500, inferredEndYear: 1560,
      themeDescription: 'Synthetic Follow a Figure: Fixture Alpha and its fixture contacts.', activeCategories: ['THINKERS', 'SCIENTISTS'],
    };
    if (prompt.startsWith('Select historically significant people')) response = fixturePeople.slice(0, 2).map(figurePerson);
    if (prompt.startsWith('Identify the one')) response = { ...figurePerson(fixturePeople[3]) };
    if (prompt.startsWith('Six Degrees: discover')) {
      const sources = JSON.parse(prompt.match(/Sources: ([^\n]+)/)?.[1] || '[]');
      response = sources.flatMap((s: { name: string; ref: string; previouslyProposedPairsWith: Array<{ name: string }> }) => {
        const index = fixturePeople.findIndex(p => p.name === s.name);
        return [index - 1, index + 1].filter(i => i >= 0 && i < fixturePeople.length && !s.previouslyProposedPairsWith.some(p => p.name === fixturePeople[i].name))
          .map(i => ({ source: s.ref, person: { ...figurePerson(fixturePeople[i]), aliases: [] }, claim: 'Synthetic fixture correspondence: independent assessment pending.' }));
      });
    }
    if (prompt.startsWith('Six Degrees: independently')) {
      const pairs = JSON.parse(prompt.match(/Pairs: ([^\n]+)/)?.[1] || '[]');
      response = pairs.map((p: { ref: string; first: { name: string }; second: { name: string } }) => {
        const a = fixturePeople.findIndex(f => f.name === p.first.name), b = fixturePeople.findIndex(f => f.name === p.second.name);
        const accepted = a >= 0 && b >= 0 && Math.abs(a - b) === 1;
        return { ref: p.ref, verdict: accepted ? 'accepted' : 'unresolved', interactionType: 'correspondence', evidence: accepted ? `${p.first.name} and ${p.second.name} exchanged synthetic fixture letters.` : '', uncertainty: accepted ? '' : 'Unsupported synthetic fixture pair.', year: null };
      });
    }
    if (prompt.startsWith('Explain this accepted')) response = { supported: true, summary: 'Synthetic Six Degrees narrative from the accepted contact record.', sections: [{ title: 'Test evidence', content: 'This tests the dedicated Why action and does not establish historical contact.' }] };
    if (prompt.startsWith('Provide a detailed historical')) response = { summary: 'Synthetic biography.', famousQuote: '', sections: [{ title: 'Test biography', content: 'Synthetic biography test.' }] };
    if (prompt.startsWith('Explain the historical')) response = { isRelevant: true, evidence: 'Synthetic general relationship.', summary: 'Synthetic general relationship.', sections: [{ title: 'Test', content: 'Synthetic general relationship.' }] };
    if (prompt.startsWith('Identify significant historical')) {
      const candidates = JSON.parse(prompt.match(/Candidates: ([^\n]+)/)?.[1] || '[]');
      response = { relatedIds: candidates.slice(0, 1).map(p => p.id) };
    }
    if (prompt.startsWith('Discover up to')) response = [{ name: 'Fixture Expansion', birthYear: 1530, deathYear: 1610, occupation: 'Synthetic expansion', category: 'THINKERS', description: 'Synthetic collaboration with Fixture Alpha.' }];
    return Response.json({ message: { content: prompt === CONNECTION_TEST_PROMPT ? 'OK' : JSON.stringify(response) }, done: true });
  };
  return { calls, restore: () => { window.fetch = originalFetch; } };
}

// Run from browser-setup.html after leaving the app, whose normal page-exit save
// would otherwise overwrite restored history. Never clear unrelated browser data.
export async function restoreBrowserFixture(original: Record<string, string | null>) {
  for (const key of ['chrono_provider', 'chrono_settings_ollama_local', CANVAS_HISTORY_KEY, 'chrono_theme']) {
    if (!(key in original)) continue;
    if (original[key] === null) localStorage.removeItem(key);
    else localStorage.setItem(key, original[key]);
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('chronoweave-six-degrees-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('knowledge');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('knowledge', 'readwrite'), store = tx.objectStore('knowledge');
      const read = store.get('state');
      read.onsuccess = () => {
        const state = read.result;
        if (state?.version !== 2) return;
        const synthetic = new Set<string>(state.knowledge.people.filter((p: ContactPerson) => p.id.startsWith('sd2-fixture%20')).map((p: ContactPerson) => p.id));
        state.knowledge.people = state.knowledge.people.filter((p: ContactPerson) => !synthetic.has(p.id));
        state.knowledge.contacts = state.knowledge.contacts.filter((c: { pair: string[] }) => c.pair.every(id => !synthetic.has(id)));
        state.sessions = state.sessions.filter((s: ConnectionSession) => !s.canvasId.startsWith('six-degrees-preview-'));
        store.put(state, 'state');
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
