// What the Wikipedia query API did to the titles it was sent: it may normalise them ("isaac newton" -> "Isaac newton") and follow redirects
// ("Isaac newton" -> "Isaac Newton"). Maps each input to the title of the page its answer is about, so a result keyed by page title can be
// matched back to what was asked. Shared by the portrait lookup and the Wikidata identity lookup.
export interface TitleChanges {
  normalized?: Array<{ from: string; to: string }>;
  redirects?: Array<{ from: string; to: string }>;
}

export function mapInputsToTitles(inputs: readonly string[], changes: TitleChanges): Map<string, string> {
  const nameToTitle = new Map<string, string>(inputs.map(name => [name, name]));
  // Input -> normalised title.
  (changes.normalized ?? []).forEach(n => {
    if (nameToTitle.get(n.from) === n.from) nameToTitle.set(n.from, n.to);
  });
  // Normalised title -> final title.
  (changes.redirects ?? []).forEach(r => {
    for (const [input, currentTarget] of nameToTitle.entries()) {
      if (currentTarget === r.from) nameToTitle.set(input, r.to);
    }
  });
  return nameToTitle;
}
