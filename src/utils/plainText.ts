// Escaped characters are parked in a private-use range while the markers are removed, then put back as themselves.
const ESCAPABLE = /\\([\\`*_{}\[\]()#+\-.!~|>])/g;
const PARKED = /[-]/g;

// Model-written text may carry Markdown. Where only an excerpt is shown (a clamped caption, a list row) the syntax would
// show up as stray asterisks and brackets, so this keeps the words and drops the markup. Not a Markdown parser: it
// handles what such text actually contains (emphasis, code, links, headings, quotes, list markers) and leaves the rest.
export function stripMarkdown(text: string): string {
  return text
    .replace(ESCAPABLE, (_, character: string) => String.fromCharCode(0xE000 + character.charCodeAt(0)))
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1')
    .replace(/(?<![\p{L}\p{N}])_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}])/gu, '$1')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(PARKED, character => String.fromCharCode(character.charCodeAt(0) - 0xE000))
    .replace(/\s+/g, ' ')
    .trim();
}
