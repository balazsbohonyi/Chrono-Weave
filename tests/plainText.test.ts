import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMarkdown } from '../src/utils/plainText';

test('emphasis, strong text, code and strikethrough lose their markers but keep their words', () => {
  assert.equal(stripMarkdown('In 1657 Huygens sent Pascal *De Ratiociniis in Ludo Aleae* (on probability).'),
    'In 1657 Huygens sent Pascal De Ratiociniis in Ludo Aleae (on probability).');
  assert.equal(stripMarkdown('A **bold** claim, an _italic_ one, __strong__ again, ~~struck~~ and `code`.'), 'A bold claim, an italic one, strong again, struck and code.');
  assert.equal(stripMarkdown('***both*** at once'), 'both at once');
});

test('links and images keep their text, headings, quotes and list markers disappear', () => {
  assert.equal(stripMarkdown('See [the letter](https://example.org/a_b) and ![portrait](x.png) for more.'), 'See the letter and portrait for more.');
  assert.equal(stripMarkdown('## Context\n> They met.\n- first\n* second\n1. third'), 'Context They met. first second third');
  assert.equal(stripMarkdown('Before\n---\nAfter'), 'Before After');
});

test('plain text passes through, including underscores and asterisks that are not markup', () => {
  assert.equal(stripMarkdown('They corresponded for years.'), 'They corresponded for years.');
  assert.equal(stripMarkdown('the snake_case_name stays'), 'the snake_case_name stays');
  assert.equal(stripMarkdown('2 * 3 * 4 = 24'), '2 * 3 * 4 = 24');
  assert.equal(stripMarkdown('an escaped \\*star\\* stays'), 'an escaped *star* stays');
});

test('line breaks and runs of spaces collapse so a clamped caption flows as one paragraph', () => {
  assert.equal(stripMarkdown('  one\n\n two   three \n'), 'one two three');
  assert.equal(stripMarkdown('```\ncode block\n```\ntext'), 'code block text');
  assert.equal(stripMarkdown('a <b>bold</b> tag'), 'a bold tag');
});
