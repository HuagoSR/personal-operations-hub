'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mdLite = require('../src/web/md');

test('md-lite: renders headings, lists, emphasis, inline code and links', () => {
  const html = mdLite('# 标题\n\n- **粗体** 和 `code`\n- 第二项\n\n正文 **加粗** *斜体* [链接](https://example.com)');
  assert.ok(html.includes('<div class="md-h md-h1">标题</div>'));
  assert.ok(html.includes('<ul>'));
  assert.ok(html.includes('<li><strong>粗体</strong> 和 <code>code</code></li>'));
  assert.ok(html.includes('<li>第二项</li>'));
  assert.ok(html.includes('<p>正文 <strong>加粗</strong> <em>斜体</em> <a href="https://example.com"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('md-lite: ordered lists, blockquotes, hr, soft breaks', () => {
  const html = mdLite('> 引用\n> 两行\n\n---\n\n1. 第一\n2. 第二\n\n段落内\n换行');
  assert.ok(html.includes('<blockquote>引用<br>两行</blockquote>'));
  assert.ok(html.includes('<hr class="md-hr">'));
  assert.ok(html.includes('<ol>'));
  assert.ok(html.includes('<li>第一</li>'));
  assert.ok(html.includes('段落内<br>换行'));
});

test('md-lite: fenced code block escapes HTML', () => {
  const html = mdLite('```\nconst a = "<b>&amp;</b>";\n```');
  assert.ok(html.includes('<pre class="code"><code>const a = &quot;&lt;b&gt;&amp;amp;&lt;/b&gt;&quot;'));
  assert.ok(!html.includes('<b>&amp;</b>'));
});

test('md-lite: escapes raw HTML in messages', () => {
  const html = mdLite('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('md-lite: rejects javascript: and other unsafe link schemes', () => {
  assert.ok(!mdLite('[x](javascript:alert(1))').includes('href="javascript'));
  assert.ok(!mdLite('[x](JavaScript:alert(1))').includes('href="JavaScript'));
  assert.ok(!mdLite('[x](data:text/html,<b>)').includes('href="data:'));
  assert.ok(!mdLite('[x](vbscript:msgbox)').includes('href="vbscript'));
  const rendered = mdLite('[x](javascript:alert(1))');
  assert.ok(rendered.includes('[x](javascript:alert(1))'), 'unsafe link stays as plain text');
});

test('md-lite: allows http, https and site-relative links', () => {
  assert.ok(mdLite('[a](https://e.com)').includes('href="https://e.com"'));
  assert.ok(mdLite('[a](http://e.com)').includes('href="http://e.com"'));
  assert.ok(mdLite('[a](/results.html)').includes('href="/results.html"'));
});

test('md-lite: inline code protects link and emphasis syntax', () => {
  const html = mdLite('`[not a link](javascript:x)`');
  assert.ok(html.includes('<code>[not a link](javascript:x)</code>'));
  assert.ok(!html.includes('href='));
});

test('md-lite: normalizes CRLF and handles empty input', () => {
  assert.ok(mdLite('a\r\nb').includes('a<br>b'));
  assert.ok(mdLite('a\rb').includes('a<br>b'));
  assert.strictEqual(mdLite(''), '<div class="md"></div>');
  assert.strictEqual(mdLite(null), '<div class="md"></div>');
});

test('md-lite: url with quotes/spaces cannot break out of href attribute', () => {
  const html = mdLite('[x](https://e.com/?q=" onload="alert(1))');
  assert.ok(!html.includes('href='), 'no anchor should be generated for url containing spaces');
  assert.ok(!/<a\s/i.test(html), 'no anchor tag should be generated');
  assert.ok(html.includes('&quot;'), 'quotes stay escaped in plain text');
});
