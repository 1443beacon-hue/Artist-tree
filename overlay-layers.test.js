import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
// Collect the final declarations for these exact, non-conditional selectors.
function declarations(selector) {
  const result = {};
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const clean = selectors.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (clean !== selector) continue;
    for (const entry of body.split(';')) {
      const colon = entry.indexOf(':');
      if (colon > 0) result[entry.slice(0, colon).trim()] = entry.slice(colon + 1).trim();
    }
  }
  return result;
}

test('search suggestions stack above the explorer toolbar instead of sharing its paint order', () => {
  const search = declarations('.search-results'), toolbar = declarations('.explorer-toolbar');
  assert.equal(search.position, 'absolute');
  assert.ok(Number.isFinite(Number(search['z-index'])));
  assert.ok(Number(search['z-index']) > Number(toolbar['z-index']),
    'Back, Save, and Start over must neither show through nor intercept clicks in search suggestions');
});

test('the layering fix preserves a bounded, scrollable result menu and the map save popover', () => {
  const search = declarations('.search-results'), popover = declarations('.map-save-popover');
  assert.equal(search['max-height'], '370px');
  assert.equal(search['overflow-y'], 'auto');
  assert.notEqual(search['pointer-events'], 'none');
  assert.equal(popover.position, 'fixed');
  assert.equal(popover['overflow-y'], 'auto');
});
