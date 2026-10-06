import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownContent from '../src/components/MarkdownContent';
import RelationshipPopover from '../src/components/RelationshipPopover';
import { figure } from './helpers';

test('Markdown renders emphasis, paragraphs, ordered and nested lists, and links', () => {
  const html = renderToStaticMarkup(<MarkdownContent>{'**Published works** and *indirect influence*.\n\n1. Mechanics\n2. Astronomy\n   - Observations\n\n[Read more](https://example.com/history)'}</MarkdownContent>);
  assert.match(html, /<strong>Published works<\/strong>/);
  assert.match(html, /<em>indirect influence<\/em>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>Mechanics<\/li>/);
  assert.match(html, /href="https:\/\/example.com\/history" target="_blank" rel="noopener noreferrer"/);
});

test('Markdown renders tables, strikethrough, blockquotes and code without interpreting code as HTML', () => {
  const markdown = '| Figure | Field |\n| --- | --- |\n| Galileo | Mechanics |\n\n~~Old wording~~\n\n> Historical context\n\n`F = ma`\n\n```text\n<b>literal code</b>\n```';
  const html = renderToStaticMarkup(<MarkdownContent>{markdown}</MarkdownContent>);
  assert.match(html, /<table>/);
  assert.match(html, /<td>Galileo<\/td>/);
  assert.match(html, /<del>Old wording<\/del>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<code>F = ma<\/code>/);
  assert.match(html, /<pre><code class="language-text">&lt;b&gt;literal code&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>literal code<\/b>/);
});

test('inline Markdown formats section titles without adding block elements inside headings', () => {
  const html = renderToStaticMarkup(<h4><MarkdownContent inline>{'## **Documented** *connections*'}</MarkdownContent></h4>);
  assert.match(html, /<strong>Documented<\/strong> <em>connections<\/em>/);
  assert.doesNotMatch(html, /<p>|<h2>|<div>/);
});

test('model Markdown cannot inject HTML, event handlers or JavaScript links', () => {
  const html = renderToStaticMarkup(<MarkdownContent>{'Visible text.\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))\n\n[secure](https://example.com)'}</MarkdownContent>);
  assert.match(html, /Visible text/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /<script|<img|onerror=|href="javascript:/i);
});

test('both dialog modes render model Markdown from existing data without changing its stored text', () => {
  const sections = [{ title: '**Scientific influence**', content: '1. **Mechanics**\n2. *Astronomy*' }];
  const data = { summary: '**Historical summary**', famousQuote: '*A quotation.*', sections };
  const props = { isOpen: true, isLoading: false, onClose: () => undefined, onInspect: () => undefined, target: figure };
  const biography = renderToStaticMarkup(<RelationshipPopover {...props} source={null} mode="single" data={data} />);
  assert.match(biography, /<strong>Historical summary<\/strong>/);
  assert.match(biography, /<em>A quotation\.<\/em>/);
  assert.match(biography, /<strong>Scientific influence<\/strong>/);
  assert.match(biography, /<ol>/);
  const relationship = renderToStaticMarkup(<RelationshipPopover {...props} source={{ ...figure, id: 'other' }} mode="relationship" data={{ explanation: data, sourceDetail: { description: '**Source biography**', imageUrl: null }, targetDetail: { description: '*Target biography*', imageUrl: null } }} />);
  assert.match(relationship, /<strong>Historical summary<\/strong>/);
  assert.match(relationship, /<strong>Source biography<\/strong>/);
  assert.match(relationship, /<em>Target biography<\/em>/);
  assert.match(relationship, /<strong>Scientific influence<\/strong>/);
  assert.match(relationship, /<ol>/);
  assert.doesNotMatch(relationship, />Focus<|>Connected To</);
  assert.match(relationship, /role="dialog" aria-modal="true" aria-label="Relationship explanation"/);
  assert.equal((relationship.match(/data-biography-id=/g) || []).length, 2);
  assert.equal((relationship.match(/aria-label="Read biography of /g) || []).length, 2);
  assert.equal(sections[0].content, '1. **Mechanics**\n2. *Astronomy*');
});
