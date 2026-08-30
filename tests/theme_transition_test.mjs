import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const { URL, console: output } = globalThis;

const [index, script, styles] = await Promise.all([
  readFile(new URL('../site/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../site/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../site/styles.css', import.meta.url), 'utf8'),
]);

const themeMarkPath = index.match(/<svg class="theme-mark"[^>]*>[\s\S]*?<path\s+d="([^"]+)"/)?.[1];
assert.ok(themeMarkPath);
assert.match(styles, /background-color: var\(--shell\);/);
assert.match(styles, /\.theme-mark \{[\s\S]*fill: currentColor;/);
assert.match(styles, /transition:\s*background-color 520ms ease,\s*color 520ms ease;/);
assert.match(styles, /transition:\s*opacity 520ms ease/);
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*body,[\s\S]*\.logo \{[\s\S]*transition: none;/,
);

const listeners = {};
const triggerListeners = [];
const root = { dataset: {}, classList: { add() {}, remove() {} } };
const themeColor = { content: '' };
const favicon = { href: '', type: 'image/png' };
const document = {
  documentElement: root,
  addEventListener(name, callback) {
    listeners[name] = callback;
  },
  querySelector(selector) {
    return selector === 'meta[name="theme-color"]' ? themeColor : favicon;
  },
  querySelectorAll() {
    return [
      {
        addEventListener(name, callback) {
          triggerListeners.push(callback);
        },
      },
    ];
  },
};

vm.runInNewContext(script, {
  document,
  matchMedia: () => ({ matches: false }),
});
listeners.DOMContentLoaded();
triggerListeners[0]();

assert.equal(root.dataset.theme, '1');
assert.equal(themeColor.content, '#000000');
assert.equal(favicon.type, 'image/svg+xml');
const faviconSvg = decodeURIComponent(favicon.href);
assert.match(faviconSvg, /<rect[^>]*fill="#000000"/);
assert.match(faviconSvg, /<path fill="#e60012"/);
assert.ok(faviconSvg.includes(`d="${themeMarkPath}"`));

output.log('PASS: theme fallback updates the page, logo mark, and favicon colors');
