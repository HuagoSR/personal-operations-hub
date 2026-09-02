/*!
 * md-lite: minimal markdown renderer for Personal Hub control web.
 * XSS-safe by construction: raw text is HTML-escaped before any tag is
 * generated; link URLs are restricted to http(s):// and site-relative paths.
 * Supports: headings (# ~ ###), bold, italic, inline code, fenced code blocks,
 * ordered/unordered lists, blockquotes, links, horizontal rules.
 * Not supported: nested lists, tables, images.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.mdLite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ESCMAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var SAFE_URL = /^(https?:\/\/|\/|#)/i;

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ESCMAP[c]; });
  }

  function inline(s) {
    var stash = [];
    var out = escHtml(s);
    out = out.replace(/`([^`\n]+)`/g, function (m, code) {
      stash.push('<code>' + code + '</code>');
      return '\u0000' + (stash.length - 1) + '\u0000';
    });
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, txt, url) {
      if (!SAFE_URL.test(url)) return m;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
    });
    out = out.replace(/\u0000(\d+)\u0000/g, function (m, i) { return stash[Number(i)]; });
    return out;
  }

  function mdLite(src) {
    var text = String(src === null || src === undefined ? '' : src).replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    var out = [];
    var para = [];
    var list = null;
    var quote = [];
    var fence = null;

    function flushPara() {
      if (!para.length) return;
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    }
    function flushList() {
      if (!list) return;
      out.push('<' + list.type + '>' + list.items.map(function (it) { return '<li>' + inline(it) + '</li>'; }).join('') + '</' + list.type + '>');
      list = null;
    }
    function flushQuote() {
      if (!quote.length) return;
      out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>');
      quote = [];
    }
    function flushAll() { flushPara(); flushList(); flushQuote(); }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (fence) {
        if (/^```\s*$/.test(line)) {
          out.push('<pre class="code"><code>' + escHtml(fence.lines.join('\n')) + '</code></pre>');
          fence = null;
        } else fence.lines.push(line);
        continue;
      }
      if (/^```/.test(line)) { flushAll(); fence = { lines: [] }; continue; }
      if (/^\s*$/.test(line)) { flushAll(); continue; }
      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushAll();
        out.push('<div class="md-h md-h' + Math.min(h[1].length, 3) + '">' + inline(h[2]) + '</div>');
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushAll(); out.push('<hr class="md-hr">'); continue; }
      var q = line.match(/^>\s?(.*)$/);
      if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
      var ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) {
        flushPara(); flushQuote();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(ul[1]);
        continue;
      }
      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara(); flushQuote();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(ol[1]);
        continue;
      }
      flushList(); flushQuote();
      para.push(line);
    }
    if (fence) out.push('<pre class="code"><code>' + escHtml(fence.lines.join('\n')) + '</code></pre>');
    flushAll();
    return '<div class="md">' + out.join('') + '</div>';
  }

  return mdLite;
});
