// npm test: re-edits and compilations of movies you have are left out.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-rules-'));
const { recutOf } = require('../src/engine');
const { seriesName } = require('../src/library');

const owned = { series: new Set(['The Godfather', 'The Godfather Part II', 'Kill Bill: Vol. 1', 'Aliens'].map(seriesName)) };
const movie = (title, runtime) => ({ type: 'movie', title, runtime });

test('re-edits of owned movies are left out', () => {
  assert.ok(recutOf(movie('The Godfather Trilogy: 1901-1980', 583), owned));
  assert.ok(recutOf(movie('Kill Bill: The Whole Bloody Affair', 247), owned));
  assert.ok(recutOf(movie('Some Saga Supercut', 320), owned)); // over 5 hours, whatever it is
});

test('normal movies and sequels stay', () => {
  assert.strictEqual(recutOf(movie('The Godfather Part III', 162), owned), null);
  assert.strictEqual(recutOf(movie('Alien³', 114), owned), null);
  assert.strictEqual(recutOf(movie('Once Upon a Time in America', 229), owned), null);
  assert.strictEqual(recutOf({ type: 'tv', title: 'The Godfather Saga', runtime: 400 }, owned), null);
});
