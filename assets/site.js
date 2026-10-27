/* IdleOn Blunder Bench · shared page script.
   Load it in <head> on every page (no defer) right after assets/theme.css:
     <script src="../assets/site.js" data-page="companion"></script>
   It does four things:
   1. applies the theme chosen on the Account page before the page paints,
   2. renders the shared top bar into <nav id="site-bar"></nav>,
   3. keeps the one imported save (IndexedDB, shared by every page on this site),
   4. caches each tool's work on that save, so a tool only recalculates when the save changes. */
(function () {
  'use strict';
  const me = document.currentScript;
  const ROOT = me ? new URL('..', me.src).href : new URL('./', location.href).href;
  const PAGE = (me && me.dataset.page) || '';
  const THEME_KEY = 'idleon-tools:theme';
  const META_KEY = 'idleon-tools:save-meta';
  const DB_NAME = 'idleon-tools';
  const STORE = 'kv';

  /* 1. Theme ------------------------------------------------------------------------------- */
  const readTheme = () => { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } };
  const applyTheme = (t) => {
    const el = document.documentElement;
    if (t === 'light' || t === 'dark') el.setAttribute('data-theme', t); else el.removeAttribute('data-theme');
  };
  applyTheme(readTheme());

  /* 2. Storage ----------------------------------------------------------------------------- */
  let dbPromise = null;
  const db = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('This browser has no IndexedDB storage.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Storage could not be opened.'));
  }));
  const tx = (mode, fn) => db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage write was cancelled (is the disk full?).'));
  }));
  const idbGet = (k) => tx('readonly', (s) => s.get(k));
  const idbSet = (k, v) => tx('readwrite', (s) => s.put(v, k));
  const idbClear = () => tx('readwrite', (s) => s.clear());

  const readMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (e) { return null; } };
  const writeMeta = (m) => { try { m ? localStorage.setItem(META_KEY, JSON.stringify(m)) : localStorage.removeItem(META_KEY); } catch (e) {} };

  // Short fingerprint of the save text; tool caches are keyed by it.
  const fingerprint = (text) => {
    let h1 = 0x811c9dc5, h2 = 0x1b873593;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822507);
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + text.length.toString(36);
  };

  const listeners = new Set();
  let channel = null;
  try { channel = new BroadcastChannel('idleon-tools'); channel.onmessage = (e) => { if (e.data === 'save') emit(); }; } catch (e) {}
  window.addEventListener('storage', (e) => { if (e.key === META_KEY) emit(); if (e.key === THEME_KEY) { applyTheme(readTheme()); } });
  function emit() { renderBar(); listeners.forEach((fn) => { try { fn(readMeta()); } catch (e) { console.error(e); } }); }
  const announce = () => { if (channel) try { channel.postMessage('save'); } catch (e) {} emit(); };

  const account = {
    /** Small summary of the loaded save, or null. Synchronous. */
    meta: readMeta,
    /** Full record {id, text, label, importedAt, lastUpdated, summary}, or null. */
    getSave: () => idbGet('save').then((r) => r || null).catch(() => null),
    /** Stores a save (the JSON text). Throws if it is not an Idleon save. summary is whatever the Account page wants to show. */
    async setSave(text, label, summary) {
      let raw;
      try { raw = JSON.parse(text); } catch (e) { throw new Error('That is not valid JSON. Copy the whole export and try again.'); }
      if (!raw || typeof raw !== 'object' || !(raw.data || raw.charNames)) throw new Error('This JSON does not look like an Idleon save. It should have "data" and "charNames" at the top.');
      const rec = {
        id: fingerprint(text), text, label: label || 'Imported save', importedAt: Date.now(),
        lastUpdated: raw.lastUpdated || null, summary: summary || null,
      };
      await idbClear();
      await idbSet('save', rec);
      writeMeta({ id: rec.id, label: rec.label, importedAt: rec.importedAt, lastUpdated: rec.lastUpdated, bytes: text.length, chars: summary && summary.chars ? summary.chars.length : null });
      announce();
      return rec;
    },
    async clearSave() { await idbClear().catch(() => {}); writeMeta(null); announce(); },
    /** Calls fn(meta) whenever the save changes, in this tab or another one. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  // Tool results, keyed by tool name + save id + the tool's own version string. Only the latest save's results are kept.
  const cache = {
    get: (tool, saveId, version) => idbGet('cache:' + tool).then((c) => (c && c.saveId === saveId && c.version === version ? c.value : null)).catch(() => null),
    set: (tool, saveId, version, value) => idbSet('cache:' + tool, { saveId, version, value }).catch((e) => console.warn('cache not saved', e)),
  };

  const theme = {
    get: readTheme,
    set(t) { try { t === 'auto' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch (e) {} applyTheme(t); },
  };

  /* 3. Top bar ----------------------------------------------------------------------------- */
  const PAGES = [
    { key: 'companion', href: 'sampling-gear-companion/', label: 'Sampling and Gear Companion' },
    { key: 'stamps', href: 'stamp-planner/', label: 'Stamp Upgrade Planner' },
  ];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderBar() {
    const bar = document.getElementById('site-bar');
    if (!bar) return;
    const m = readMeta();
    const cur = (k) => (k === PAGE ? ' aria-current="page"' : '');
    bar.setAttribute('aria-label', 'IdleOn Blunder Bench');
    bar.innerHTML =
      `<a class="home" href="${ROOT}"${cur('home')}>IdleOn Blunder Bench</a>` +
      PAGES.map((p) => `<a href="${ROOT}${p.href}"${cur(p.key)}>${esc(p.label)}</a>`).join('') +
      '<span class="spacer"></span>' +
      `<a class="acct${m ? ' loaded' : ''}" href="${ROOT}account/"${cur('account')} title="${m ? 'Save loaded: ' + esc(m.label) : 'No save loaded yet'}"><span class="dot" aria-hidden="true"></span>${m ? 'Account' : 'Import save'}</a>`;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBar); else renderBar();

  /** "12 Oct 2026, 14:05" for a timestamp, used by every page for the save date. */
  const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown time');

  window.IdleonTools = { root: ROOT, page: PAGE, theme, account, cache, when, esc, fingerprint };
})();
