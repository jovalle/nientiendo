import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const { URL, console: output } = globalThis;

const [script, styles] = await Promise.all([
  readFile(new URL('../site/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../site/styles.css', import.meta.url), 'utf8'),
]);

assert.match(styles, /background-color: var\(--shell\);/);
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
const document = {
  documentElement: root,
  addEventListener(name, callback) {
    listeners[name] = callback;
  },
  querySelector() {
    return themeColor;
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

output.log('PASS: theme fallback keeps the no-View-Transition path functional and animated');
