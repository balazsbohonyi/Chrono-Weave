import { buildCorrectionPrompt } from './prompts';
import { withAbort } from './utils';

export function parseJsonResponse(content: string): unknown {
  if (typeof content !== 'string' || !content.trim()) throw new SyntaxError('The model returned no JSON.');
  const trimmed = content.trim();
  try { return JSON.parse(trimmed); } catch { /* Try fenced or surrounding prose below. */ }
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fenced) {
    try { return JSON.parse(match[1].trim()); } catch { /* Try the next block. */ }
  }
  // Balance delimiters while respecting quoted strings; a greedy regex truncates
  // nested objects or accidentally includes the model's surrounding commentary.
  for (let start = 0; start < trimmed.length; start++) {
    if (trimmed[start] !== '{' && trimmed[start] !== '[') continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index++) {
      const char = trimmed[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        const opening = stack.pop();
        if (opening !== (char === '}' ? '{' : '[')) break;
        if (!stack.length) {
          try { return JSON.parse(trimmed.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  throw new SyntaxError('The model did not return valid JSON.');
}

export async function generateValidatedJson<T>(
  prompt: string, generate: (prompt: string) => Promise<string>, validate: (value: unknown) => T, signal?: AbortSignal,
): Promise<T> {
  let correction = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    // Transport/authentication errors are not JSON errors and need no correction.
    const content = await withAbort(generate(correction ? `${prompt}\n${correction}` : prompt), signal);
    signal?.throwIfAborted();
    try { return validate(parseJsonResponse(content)); }
    catch (error) {
      signal?.throwIfAborted();
      const detail = error instanceof Error ? error.message : 'Invalid model response.';
      if (attempt === 1) throw new Error(`The model returned unusable data after a retry: ${detail}`);
      correction = buildCorrectionPrompt(detail);
    }
  }
  throw new Error('The model did not return usable JSON.');
}
