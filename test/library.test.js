// npm test: a library that mixes shows and movies (like Anime) is read correctly.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listMixed } = require('../src/library');

test('mixed library: shows and movies told apart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-'));
  const mk = (rel, files = []) => { fs.mkdirSync(path.join(root, rel), { recursive: true }); for (const f of files) fs.writeFileSync(path.join(root, rel, f), ''); };
  mk('Death Note (2006)/Season 01', ['Death Note S01E01.mkv']);
  mk('Attack on Titan', ['[SubsPlease] Attack on Titan - 01 (1080p).mkv', '[SubsPlease] Attack on Titan - 02 (1080p).mkv']);
  mk('Your Name (2016) [1080p]', ['Your.Name.2016.1080p.mkv']);
  mk('Ghibli/Spirited Away (2001)', ['Spirited Away.mkv']);
  mk('Empty folder');
  fs.writeFileSync(path.join(root, 'Akira (1988).mkv'), '');
  fs.writeFileSync(path.join(root, 'Cowboy Bebop S01E01.mkv'), '');
  fs.writeFileSync(path.join(root, 'Cowboy Bebop S01E02.mkv'), '');
  const items = await listMixed(root, 'anime');
  const got = items.map((i) => `${i.type}:${i.name}`).sort();
  assert.deepStrictEqual(got, ['movie:Akira (1988).mkv', 'movie:Spirited Away (2001)', 'movie:Your Name (2016) [1080p]', 'tv:Attack on Titan', 'tv:Cowboy Bebop', 'tv:Death Note (2006)']);
  fs.rmSync(root, { recursive: true, force: true });
});
