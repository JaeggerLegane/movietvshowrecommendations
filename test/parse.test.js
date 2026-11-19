// npm test: checks that folder and file names are read correctly.
const test = require('node:test');
const assert = require('node:assert');
const { parseName } = require('../src/library');

const cases = [
  ['The Dark Knight (2008)', 'movie', 'The Dark Knight', 2008],
  ['The.Dark.Knight.2008.1080p.BluRay.x264-SPARKS.mkv', 'movie', 'The Dark Knight', 2008],
  ['1917 (2019)', 'movie', '1917', 2019],
  ['1917.2019.2160p.UHD.BluRay.mkv', 'movie', '1917', 2019],
  ['Blade Runner 2049 (2017)', 'movie', 'Blade Runner 2049', 2017],
  ['Blade.Runner.2049.2017.1080p.WEB-DL.mkv', 'movie', 'Blade Runner 2049', 2017],
  ['2001 A Space Odyssey (1968)', 'movie', '2001 A Space Odyssey', 1968],
  ['Heat (1995) {tmdb-949}', 'movie', 'Heat', 1995],
  ['Amélie (2001) [imdbid-tt0211915]', 'movie', 'Amélie', 2001],
  ['Mr. Robot (2015)', 'tv', 'Mr. Robot', 2015],
  ['Breaking Bad', 'tv', 'Breaking Bad', null],
  ['The.Cleaning.Lady.US.S02.1080p.WEB.h264', 'tv', 'The Cleaning Lady US', null],
  ['Alien Earth', 'tv', 'Alien Earth', null],
  ['Se7en.1995.REMASTERED.1080p.BluRay.mkv', 'movie', 'Se7en', 1995],
  ['Kill Bill Vol. 1 (2003)', 'movie', 'Kill Bill Vol. 1', 2003],
  ['Sinister 2 - 2015', 'movie', 'Sinister 2', 2015],
  // Folder names as they are on the NAS
  ['Aliens DC (1986) [1080p]', 'movie', 'Aliens', 1986],
  ['The Godfather Part III (1990) [CODA CUT] [2160p] [4K] [BluRay] [5.1] [YTS.MX]', 'movie', 'The Godfather Part III', 1990],
  ['The Girl With The Dragon Tattoo (2011) [1080p] [BluRay] [5.1] [YTS.MX]', 'movie', 'The Girl With The Dragon Tattoo', 2011],
  ['The Grudge (2004) [EXTENDED] [REPACK] [1080p] [BluRay] [5.1] [YTS.MX]', 'movie', 'The Grudge', 2004],
  ['The Good The Bad And The Ugly (1966) [2160p] [4K] [BluRay] [5.1] [YTS.MX]', 'movie', 'The Good The Bad And The Ugly', 1966],
  ['Blade Runner Final Cut (1982)', 'movie', 'Blade Runner', 1982],
  ['Apocalypse Now Redux (1979) [1080p]', 'movie', 'Apocalypse Now', 1979],
  ['Kingdom of Heaven Directors Cut (2005)', 'movie', 'Kingdom of Heaven', 2005],
  ["Aliens Director's Cut (1986)", 'movie', 'Aliens', 1986],
  ['The Final Cut (2004)', 'movie', 'The Final Cut', 2004],
  ['The Cut (2014)', 'movie', 'The Cut', 2014],
  ['Uncut Gems (2019)', 'movie', 'Uncut Gems', 2019],
];

for (const [raw, type, title, year] of cases) {
  test(raw, () => {
    const p = parseName(raw, type);
    assert.strictEqual(p.title, title);
    assert.strictEqual(p.year, year);
  });
}

test('ids in folder names', () => {
  assert.strictEqual(parseName('Heat (1995) {tmdb-949}', 'movie').ids.tmdb, 949);
  assert.strictEqual(parseName('Amélie (2001) [imdbid-tt0211915]', 'movie').ids.imdb, 'tt0211915');
});

test('series names, used to spot re-edits of movies you have', () => {
  const { seriesName } = require('../src/library');
  assert.strictEqual(seriesName('The Godfather'), 'godfather');
  assert.strictEqual(seriesName('The Godfather Part III'), 'godfather');
  assert.strictEqual(seriesName('Kill Bill: Vol. 1'), 'kill bill');
  assert.strictEqual(seriesName('Kill Bill: The Whole Bloody Affair'), 'kill bill');
  assert.strictEqual(seriesName('Rocky IV'), 'rocky');
});
