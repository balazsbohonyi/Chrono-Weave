// Identity key for matching a model-written name against canvas people:
// case, accents, punctuation, and spacing differences do not make a new person.
export const canonicalName = (name: string): string => name.normalize('NFKD').replace(/\p{M}/gu, '')
  .toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
