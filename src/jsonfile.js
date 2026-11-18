// Small JSON files in the data folder (never on GitHub). Writes are atomic and grouped.
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./config');

const files = new Map();

function open(name, defaults = {}) {
  if (files.has(name)) return files.get(name);
  const file = path.join(dataDir, name);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  for (const [k, v] of Object.entries(defaults)) if (data[k] === undefined) data[k] = structuredClone(v);
  let timer = null;
  const handle = {
    data,
    replace(next) { handle.data = next; handle.saveSoon(); },
    save() {
      clearTimeout(timer); timer = null;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(handle.data));
      fs.renameSync(`${file}.tmp`, file);
    },
    saveSoon(ms = 3000) { if (!timer) timer = setTimeout(() => handle.save(), ms); },
  };
  files.set(name, handle);
  return handle;
}

function flushAll() { for (const h of files.values()) try { h.save(); } catch (e) { console.error('Could not save', e.message); } }

module.exports = { open, flushAll };
