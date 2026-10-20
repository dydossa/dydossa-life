/* dydossa life (min): the same data as the main site, a different face.
   A desktop with a flower of sections, one window at a time, dialogs for every form,
   a taskbar with a menu button, the open window, a tray and a clock.
   Data: Supabase tables `items` + `entries` (plants), `dreams` + `dream_files` (dreams),
   private buckets `photos` and `files`. Nothing here changes how the data is stored. */
(function () {
  'use strict';

  var CFG = window.DYDOSSA_CONFIG;
  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  var SECTION = 'plants';
  var BUCKET = 'photos';
  var FILES_BUCKET = 'files';
  var FILE_MAX = 50 * 1024 * 1024;
  var TRASH_MS = 48 * 3600 * 1000;
  var THEME_KEY = 'dydossa-min-theme';
  var EMAIL_KEY = 'dydossa-min-email';

  var I = window.ICONS.small, HEX = window.ICONS.hex, EMBLEM = window.ICONS.emblem;
  var TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12.5l3-3 4.5 4.5 8.5-8.5 3 3L10 20z"/></svg>';
  var ARROW_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 5v5h9v4h-9v5L3 12z"/></svg>';
  var ARROW_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5v5h-9v4h9v5L21 12z"/></svg>';
  var GRIP = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M1 1h3v3H1zM6 1h3v3H6zM1 6.5h3v3H1zM6 6.5h3v3H6zM1 12h3v3H1zM6 12h3v3H6z"/></svg>';
  var FOLD = '<svg class="arr" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l5 4-5 4z"/></svg>';
  var XMARK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 1l3.8 3.8L9.8 1 11 2.2 7.2 6 11 9.8 9.8 11 6 7.2 2.2 11 1 9.8 4.8 6 1 2.2z"/></svg>';

  /* ---------- dates ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
  function today() { var d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  function diffDays(a, b) { return Math.round((a - b) / 86400000); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function fmtDate(s) {
    var d = parse(s), o = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return new Intl.DateTimeFormat('uk-UA', o).format(d);
  }
  function fmtShort(s) { return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(parse(s)).replace('.', ''); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return b + ' Б';
    if (b < 1024 * 1024) return Math.round(b / 1024) + ' КБ';
    return (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- state ---------- */
  var state = { plants: [], trash: [], dreams: [], dreamTrash: [] };
  var ui = {
    screen: 'home', min: false, loaded: false, failed: false, busy: false,
    pview: 'grid', dview: 'list', dreamId: null, folder: null, showDone: false,
    statIds: null, range: 90, confirm: null, dlg: null, menu: false
  };
  var session = null;
  var photo = { blob: null, url: null, remove: false };

  // signed links live 6 hours; keep them across reloads (shared with the main site) so images stay cached
  var URLS_KEY = 'dydossa-life-urls', URL_TTL = 6 * 3600 * 1000, URL_MARGIN = 40 * 60 * 1000;
  var urlCache = {}, fileUrls = {}, urlExp = {};
  (function () {
    try {
      var saved = JSON.parse(localStorage.getItem(URLS_KEY) || '{}'), now = Date.now();
      Object.keys(saved).forEach(function (k) {
        var v = saved[k];
        if (!v || v[2] < now + URL_MARGIN) return;
        if (v[0] === 'f') fileUrls[k] = v[1]; else urlCache[k] = v[1];
        urlExp[k] = v[2];
      });
    } catch (e) {}
  })();
  var saveUrlsT = 0;
  function saveUrls() {
    clearTimeout(saveUrlsT);
    saveUrlsT = setTimeout(function () {
      var out = {}, now = Date.now();
      Object.keys(urlExp).forEach(function (k) {
        if (urlExp[k] < now + URL_MARGIN) return;
        if (urlCache[k]) out[k] = ['p', urlCache[k], urlExp[k]];
        else if (fileUrls[k]) out[k] = ['f', fileUrls[k], urlExp[k]];
      });
      try { localStorage.setItem(URLS_KEY, JSON.stringify(out)); } catch (e) {}
    }, 400);
  }
  function fresh(k) { return urlExp[k] && urlExp[k] > Date.now() + URL_MARGIN; }
  var lastRefresh = 0;

  /* ---------- plants: data ---------- */
  function freeSlot(plants) {
    var used = {};
    plants.forEach(function (p) { used[p.slot] = 1; });
    for (var i = 0; i < 8; i++) if (!used[i]) return i;
    return plants.length % 8;
  }
  function findPlant(id) { return state.plants.find(function (p) { return p.id === id; }); }
  function findAny(id) {
    var p = findPlant(id);
    if (p) return p;
    var t = state.trash.find(function (x) { return x.plant.id === id; });
    return t ? t.plant : null;
  }
  function color(p) { return 'var(--s' + ((p.slot % 8) + 1) + ')'; }
  function sortedLogs(p) { return p.logs.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.ts - a.ts; }); }
  function ascLogs(p) { return p.logs.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts - b.ts; }); }
  function lastDate(p) { var l = sortedLogs(p)[0]; return l ? l.date : null; }
  function photosOf(p) { return sortedLogs(p).filter(function (l) { return l.photo; }); }
  function status(p) {
    var last = lastDate(p);
    if (!last) return { text: 'Потрібен перший полив', frac: 1, due: true, never: true, left: 0 };
    var left = diffDays(parse(addDays(last, p.interval)), today());
    var frac = Math.min(1, Math.max(0, diffDays(today(), parse(last)) / p.interval));
    if (left < 0) return { text: 'Прострочено на ' + (-left) + ' дн.', frac: 1, due: true, left: left, last: last };
    if (left === 0) return { text: 'Полити сьогодні', frac: 1, due: true, left: 0, last: last };
    return { text: 'Полити через ' + left + ' дн.', frac: frac, due: false, left: left, last: last };
  }
  function urgency(p) { var s = status(p); return s.never ? -9999 : s.left; }
  function dueCount() { return state.plants.filter(function (p) { return status(p).due; }).length; }

  async function signPaths(paths) {
    var need = paths.filter(function (p) { return !urlCache[p] || !fresh(p); });
    if (!need.length) return;
    var at = Date.now();
    var r = await sb.storage.from(BUCKET).createSignedUrls(need, 6 * 3600);
    if (r.error || !r.data) return;
    r.data.forEach(function (x) { if (x.signedUrl && x.path) { urlCache[x.path] = x.signedUrl; urlExp[x.path] = at + URL_TTL; } });
    saveUrls();
  }
  async function destroyItem(p) {
    var paths = p.logs.map(function (l) { return l.path; }).filter(Boolean);
    if (paths.length) { var rm = await sb.storage.from(BUCKET).remove(paths); if (rm.error) throw rm.error; }
    var r = await sb.from('items').delete().eq('id', p.id);
    if (r.error) throw r.error;
  }
  async function fetchAll() {
    var ri = await sb.from('items').select('id,name,interval_days,color_slot,deleted_at,created_at').eq('section', SECTION).order('created_at', { ascending: true });
    if (ri.error) throw ri.error;
    var entries = [];
    if (ri.data.length) {
      var re = await sb.from('entries').select('id,item_id,entry_date,photo_path,created_at').in('item_id', ri.data.map(function (i) { return i.id; })).order('entry_date', { ascending: true });
      if (re.error) throw re.error;
      entries = re.data;
    }
    var byItem = {};
    entries.forEach(function (e) {
      (byItem[e.item_id] = byItem[e.item_id] || []).push({ id: e.id, date: e.entry_date, path: e.photo_path, photo: null, ts: Date.parse(e.created_at) || 0 });
    });
    var plants = [], trash = [];
    ri.data.forEach(function (it) {
      var p = { id: it.id, name: it.name, interval: it.interval_days, slot: it.color_slot, logs: byItem[it.id] || [] };
      if (it.deleted_at) trash.push({ plant: p, deletedAt: Date.parse(it.deleted_at) }); else plants.push(p);
    });
    var now = Date.now(), keep = [];
    for (var i = 0; i < trash.length; i++) {
      if (now - trash[i].deletedAt >= TRASH_MS) { try { await destroyItem(trash[i].plant); } catch (e) { console.error(e); keep.push(trash[i]); } }
      else keep.push(trash[i]);
    }
    trash = keep;
    var all = plants.concat(trash.map(function (t) { return t.plant; })), paths = [];
    all.forEach(function (p) { p.logs.forEach(function (l) { if (l.path) paths.push(l.path); }); });
    await signPaths(paths);
    all.forEach(function (p) { p.logs.forEach(function (l) { l.photo = l.path ? (urlCache[l.path] || null) : null; }); });
    state.plants = plants;
    state.trash = trash;
  }
  async function addWatering(plantId, date, blob) {
    var path = null;
    if (blob) {
      path = session.user.id + '/' + uuid() + '.jpg';
      var up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
    }
    var r = await sb.from('entries').insert({ item_id: plantId, entry_date: date, photo_path: path });
    if (r.error) { if (path) await sb.storage.from(BUCKET).remove([path]); throw r.error; }
  }
  async function savePlant(id, name, n) {
    var r = id ? await sb.from('items').update({ name: name, interval_days: n }).eq('id', id)
      : await sb.from('items').insert({ section: SECTION, name: name, interval_days: n, color_slot: freeSlot(state.plants) });
    if (r.error) throw r.error;
  }
  async function trashPlant(id) {
    var r = await sb.from('items').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (r.error) throw r.error;
  }
  async function restorePlant(id) {
    var t = state.trash.find(function (x) { return x.plant.id === id; });
    var patch = { deleted_at: null };
    if (t && state.plants.some(function (q) { return q.slot === t.plant.slot; })) patch.color_slot = freeSlot(state.plants);
    var r = await sb.from('items').update(patch).eq('id', id);
    if (r.error) throw r.error;
  }
  async function deleteEntry(plantId, logId) {
    var p = findAny(plantId), l = p && p.logs.find(function (x) { return x.id === logId; });
    if (l && l.path) await sb.storage.from(BUCKET).remove([l.path]);
    var r = await sb.from('entries').delete().eq('id', logId);
    if (r.error) throw r.error;
  }

  /* ---------- dreams: data ---------- */
  function findDream(id) {
    return state.dreams.find(function (d) { return d.id === id; }) || (state.dreamTrash.find(function (t) { return t.dream.id === id; }) || {}).dream || null;
  }
  function curDream() { return ui.dreamId ? findDream(ui.dreamId) : null; }
  function stepsDone(d) { return d.steps.filter(function (s) { return s.d; }).length; }
  function filesOf(d) { return d.files || []; }
  function childrenOf(d, parent) {
    var rank = { folder: 0, note: 1, file: 2 };
    return filesOf(d).filter(function (f) { return (f.parent || null) === (parent || null); })
      .sort(function (a, b) { return rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, 'uk'); });
  }
  function subtree(d, id) {
    var out = [], queue = [id];
    while (queue.length) {
      var cur = queue.shift();
      filesOf(d).forEach(function (f) { if (f.id === cur) out.push(f); if (f.parent === cur) queue.push(f.id); });
    }
    return out;
  }
  function findFile(d, id) { return filesOf(d).find(function (f) { return f.id === id; }) || null; }
  function mapStep(d, sid, fn) { return d.steps.map(function (x) { return x.id === sid ? fn(x) : x; }); }

  // the main site colours a dream's page from its photo: keep saving that colour so both stay in step
  function rgbHue(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (!d) return 0;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; return h < 0 ? h + 360 : h;
  }
  function dominantColor(src) {
    return new Promise(function (resolve) {
      var url = src instanceof Blob ? URL.createObjectURL(src) : src;
      var img = new Image();
      if (!(src instanceof Blob)) img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var c = document.createElement('canvas'); c.width = c.height = 40;
          var x = c.getContext('2d'); x.drawImage(img, 0, 0, 40, 40);
          var px = x.getImageData(0, 0, 40, 40).data, buckets = {}, best = null;
          for (var i = 0; i < px.length; i += 4) {
            var r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            var sat = mx ? (mx - mn) / mx : 0, v = mx / 255;
            if (v < 0.18 || sat < 0.22) continue;
            var k = Math.round(rgbHue(r, g, b) / 20) % 18;
            var bk = buckets[k] = buckets[k] || { w: 0, r: 0, g: 0, b: 0 };
            var w = sat * (0.4 + v); bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
          }
          Object.keys(buckets).forEach(function (k) { if (!best || buckets[k].w > best.w) best = buckets[k]; });
          if (!best || best.w < 0.8) { resolve('#808080'); return; }
          resolve('#' + [best.r, best.g, best.b].map(function (n) { return ('0' + Math.round(n / best.w).toString(16)).slice(-2); }).join(''));
        } catch (e) { resolve(null); }
        if (src instanceof Blob) URL.revokeObjectURL(url);
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  async function fetchDreams() {
    var r = await sb.from('dreams').select('id,title,why,status,color,done_on,cover_path,steps,created_at,deleted_at').order('created_at', { ascending: true });
    if (r.error) throw r.error;
    var rf = await sb.from('dream_files').select('id,dream_id,parent_id,kind,name,body,path,mime,size,created_at,updated_at');
    if (rf.error) throw rf.error;
    var byDream = {};
    rf.data.forEach(function (f) {
      (byDream[f.dream_id] = byDream[f.dream_id] || []).push({
        id: f.id, parent: f.parent_id || null, kind: f.kind, name: f.name, body: f.body || '', path: f.path,
        mime: f.mime || '', size: f.size, ts: Date.parse(f.updated_at || f.created_at) || 0
      });
    });
    var list = [], trash = [], now = Date.now();
    for (var i = 0; i < r.data.length; i++) {
      var x = r.data[i];
      var d = { id: x.id, title: x.title, why: x.why || '', status: x.status, color: x.color || null, doneOn: x.done_on, path: x.cover_path, photo: null,
        steps: Array.isArray(x.steps) ? x.steps : [], files: byDream[x.id] || [], ts: Date.parse(x.created_at) || 0 };
      if (!x.deleted_at) { list.push(d); continue; }
      var at = Date.parse(x.deleted_at);
      if (now - at >= TRASH_MS) { try { await destroyDream(d); } catch (e) { console.error(e); trash.push({ dream: d, deletedAt: at }); } }
      else trash.push({ dream: d, deletedAt: at });
    }
    var all = list.concat(trash.map(function (t) { return t.dream; }));
    await signPaths(all.map(function (d) { return d.path; }).filter(Boolean));
    all.forEach(function (d) { d.photo = d.path ? (urlCache[d.path] || null) : null; });
    var fpaths = [];
    list.forEach(function (d) { d.files.forEach(function (f) { if (f.path && (!fileUrls[f.path] || !fresh(f.path))) fpaths.push(f.path); }); });
    if (fpaths.length) {
      var fat = Date.now();
      var su = await sb.storage.from(FILES_BUCKET).createSignedUrls(fpaths, 6 * 3600);
      if (!su.error && su.data) su.data.forEach(function (s) { if (s.signedUrl && s.path) { fileUrls[s.path] = s.signedUrl; urlExp[s.path] = fat + URL_TTL; } });
      saveUrls();
    }
    state.dreams = list;
    state.dreamTrash = trash;
  }
  async function uploadPhoto(blob) {
    var path = session.user.id + '/' + uuid() + '.jpg';
    var up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    return path;
  }
  async function removeFiles(paths) {
    if (!paths.length) return;
    var rm = await sb.storage.from(FILES_BUCKET).remove(paths);
    if (rm.error) throw rm.error;
  }
  async function destroyDream(d) {
    await removeFiles(filesOf(d).map(function (f) { return f.path; }).filter(Boolean));
    if (d.path) { var rm = await sb.storage.from(BUCKET).remove([d.path]); if (rm.error) throw rm.error; }
    var r = await sb.from('dreams').delete().eq('id', d.id);
    if (r.error) throw r.error;
  }
  async function updateDream(id, patch) {
    var r = await sb.from('dreams').update(patch).eq('id', id);
    if (r.error) throw r.error;
  }
  async function saveDream(id, fields, ph) {
    var old = id ? findDream(id) : null;
    var row = { title: fields.title, why: fields.why }, newPath = null;
    if (ph.blob) { newPath = await uploadPhoto(ph.blob); row.cover_path = newPath; row.color = await dominantColor(ph.blob); }
    else if (ph.remove) { row.cover_path = null; row.color = null; }
    var r = id ? await sb.from('dreams').update(row).eq('id', id) : await sb.from('dreams').insert(row);
    if (r.error) { if (newPath) await sb.storage.from(BUCKET).remove([newPath]); throw r.error; }
    if (old && old.path && (newPath || ph.remove)) await sb.storage.from(BUCKET).remove([old.path]);
  }
  function setStatus(d, st) { return updateDream(d.id, { status: st, done_on: st === 'done' ? (d.doneOn || null) : null }); }
  function saveSteps(d, steps) {
    var patch = { steps: steps };
    if (d.status === 'dream' && steps.some(function (s) { return s.d; })) patch.status = 'progress';
    return updateDream(d.id, patch);
  }
  async function addFolder(d, parent, name) {
    var r = await sb.from('dream_files').insert({ dream_id: d.id, parent_id: parent, kind: 'folder', name: name });
    if (r.error) throw r.error;
  }
  async function saveNote(d, id, parent, name, body) {
    var row = { name: name, body: body, updated_at: new Date().toISOString() };
    var r = id ? await sb.from('dream_files').update(row).eq('id', id)
      : await sb.from('dream_files').insert(Object.assign({ dream_id: d.id, parent_id: parent, kind: 'note' }, row));
    if (r.error) throw r.error;
  }
  async function addFiles(d, parent, files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var ext = (f.name.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0].toLowerCase();
      var path = session.user.id + '/' + d.id + '/' + uuid() + ext;
      var up = await sb.storage.from(FILES_BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) throw up.error;
      var r = await sb.from('dream_files').insert({ dream_id: d.id, parent_id: parent, kind: 'file', name: f.name.slice(0, 120) || 'файл', path: path, mime: f.type || '', size: f.size });
      if (r.error) { await sb.storage.from(FILES_BUCKET).remove([path]); throw r.error; }
    }
  }
  async function deleteMaterial(d, id) {
    await removeFiles(subtree(d, id).map(function (f) { return f.path; }).filter(Boolean));
    var r = await sb.from('dream_files').delete().eq('id', id);
    if (r.error) throw r.error;
  }
  async function renameMaterial(id, name) {
    var r = await sb.from('dream_files').update({ name: name, updated_at: new Date().toISOString() }).eq('id', id);
    if (r.error) throw r.error;
  }

  /* ---------- loading and saving ---------- */
  async function refresh() {
    await fetchAll();
    try { await fetchDreams(); } catch (e) { console.error(e); }
    lastRefresh = Date.now();
    ui.loaded = true; ui.failed = false;
    render();
  }
  // one change: save it, reload, say so
  async function run(fn, okMsg, icon) {
    if (ui.busy) return false;
    ui.busy = true;
    try {
      await fn();
      await refresh();
      if (okMsg) toast(okMsg, icon);
      return true;
    } catch (e) {
      console.error(e);
      toast('Не вийшло. Перевір інтернет і спробуй ще раз.', 'warn');
      return false;
    } finally { ui.busy = false; }
  }

  /* ---------- sections and the desktop flower ---------- */
  var SECTIONS = {
    plants: { title: 'Рослини', ready: true },
    dreams: { title: 'Мрії', ready: true },
    piano: { title: 'Піаніно', ready: false },
    ants: { title: 'Мурахи', ready: false }
  };
  // nine places around the emblem, clockwise from the top
  var SLOTS = ['plants', 'dreams', 'piano', null, null, null, null, null, 'ants'];
  var FRAME_PTS = [[50, 3], [91, 26.5], [91, 73.5], [50, 97], [9, 73.5], [9, 26.5]];

  var flowerEl = document.getElementById('flower');
  function sized(svg, x, y, s) { return svg.replace('<svg ', '<svg x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" '); }
  function renderFlower() {
    var R = 262, S = 150, due = ui.loaded ? dueCount() : 0;
    var out = '<svg viewBox="-345 -345 690 690" role="group" aria-label="Розділи">' +
      '<defs><pattern id="cone" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="s1" width="7" height="14" fill="#FFD200"/><rect x="7" width="7" height="14" fill="#1A1A1A"/></pattern></defs>' +
      '<g class="fl-hub">' + sized(EMBLEM(), -96, -96, 192) + '</g>';
    SLOTS.forEach(function (id, n) {
      var a = n * 40 * Math.PI / 180, cx = R * Math.sin(a), cy = -R * Math.cos(a), x = cx - S / 2, y = cy - S / 2;
      var sec = id ? SECTIONS[id] : null;
      if (!sec) { out += '<g class="fl-it empty" aria-hidden="true">' + sized(HEX(null), x, y, S) + '</g>'; return; }
      var pts = FRAME_PTS.map(function (p) { return (x + p[0] * S / 100).toFixed(1) + ',' + (y + p[1] * S / 100).toFixed(1); }).join(' ');
      out += '<g class="fl-it ' + (sec.ready ? 'ready' : 'soon') + '" data-action="open" data-section="' + id + '" role="button" tabindex="0" aria-label="' + esc(sec.title) + (sec.ready ? '' : ', скоро') + '">' +
        sized(HEX(id), x, y, S) + '<polygon class="fl-sel" points="' + pts + '"/>' +
        '<text class="fl-lbl" x="' + cx.toFixed(1) + '" y="' + (cy + S / 2 + 26).toFixed(1) + '" text-anchor="middle">' + esc(sec.title) + '</text>';
      if (!sec.ready) out += '<rect x="' + (cx - 30).toFixed(1) + '" y="' + (cy + S * 0.3).toFixed(1) + '" width="60" height="14" fill="url(#cone)" stroke="#1A1A1A" stroke-width="2"/>';
      if (id === 'plants' && due) {
        var w = due > 9 ? 46 : 36;
        out += '<g class="fl-badge"><rect x="' + (cx + S * 0.2).toFixed(1) + '" y="' + (cy - S * 0.5).toFixed(1) + '" width="' + w + '" height="34" rx="17"/>' +
          '<text x="' + (cx + S * 0.2 + w / 2).toFixed(1) + '" y="' + (cy - S * 0.5 + 26).toFixed(1) + '" text-anchor="middle">' + due + '</text></g>';
      }
      out += '</g>';
    });
    flowerEl.innerHTML = out + '</svg>';
  }

  /* ---------- the taskbar, the menu, the tray ---------- */
  var startBtn = document.getElementById('start-btn');
  var startM = document.getElementById('startm');
  var tasksEl = document.getElementById('tasks');
  var trayWater = document.getElementById('tray-water');
  var trayTheme = document.getElementById('tray-theme');
  var smTheme = document.getElementById('sm-theme');
  var clockEl = document.getElementById('clock');
  startBtn.innerHTML = EMBLEM();
  document.getElementById('sm-tile').innerHTML = EMBLEM();
  document.getElementById('sm-out').innerHTML = I('power');
  document.getElementById('sm-out').title = 'Вийти';
  document.getElementById('sm-list').innerHTML = ['plants', 'dreams', 'sep', 'ants', 'piano'].map(function (id) {
    if (id === 'sep') return '<div class="sm-sep" role="separator"></div>';
    var s = SECTIONS[id];
    return '<button type="button" class="sm-it' + (s.ready ? '' : ' soon') + '" data-action="open" data-section="' + id + '">' + HEX(id) + '<span>' + esc(s.title) + '</span></button>';
  }).join('');

  function renderTask() {
    var open = ui.screen !== 'home';
    tasksEl.innerHTML = open ? '<button type="button" class="taskb" data-action="task" aria-pressed="' + !ui.min + '">' + HEX(ui.screen) + '<span>' + esc(winTitle()) + '</span></button>' : '';
    var due = ui.loaded ? dueCount() : 0;
    trayWater.hidden = !due;
    trayWater.innerHTML = I('drop') + '<b>' + due + '</b>';
    trayWater.title = due + ' ' + plural(due, 'рослина чекає', 'рослини чекають', 'рослин чекають') + ' поливу';
    trayWater.setAttribute('aria-label', trayWater.title);
  }
  function tickClock() {
    var d = new Date();
    clockEl.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    clockEl.dateTime = d.toISOString();
    clockEl.title = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  }
  setInterval(tickClock, 15000);
  tickClock();
  function setMenu(on) {
    ui.menu = on;
    startM.hidden = !on;
    startBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  /* ---------- window ---------- */
  var winEl = document.getElementById('win');
  var winTitleEl = document.getElementById('win-title');
  var winIcon = document.getElementById('win-icon');
  var barEl = document.getElementById('win-bar');
  var pane = document.getElementById('pane');
  var statusEl = document.getElementById('win-status');
  var lastKey = '';

  function winTitle() {
    if (ui.screen === 'dreams' && ui.dreamId && ui.dview === 'list') { var d = curDream(); if (d) return d.title; }
    if (ui.screen === 'plants' && ui.pview === 'trash') return 'Рослини: корзина';
    if (ui.screen === 'dreams' && ui.dview === 'trash') return 'Мрії: корзина';
    return SECTIONS[ui.screen] ? SECTIONS[ui.screen].title : '';
  }
  function tb(action, icon, label, o) {
    o = o || {};
    return '<button type="button" class="tbtn' + (o.cls ? ' ' + o.cls : '') + '" data-action="' + action + '"' + (o.data || '') +
      (o.pressed !== undefined ? ' aria-pressed="' + !!o.pressed + '"' : '') + (o.disabled ? ' disabled' : '') +
      ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' + I(icon) + (o.badge ? '<b>' + o.badge + '</b>' : '') + (o.text ? '<span>' + esc(o.text) + '</span>' : '') + '</button>';
  }
  var SEP = '<span class="sep" aria-hidden="true"></span>';
  function backBtn(action, label) { return '<button type="button" class="back" data-action="' + action + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + ARROW_L + '</button>'; }
  function cell(icon, text, cls, title) { return '<span class="sb-c' + (cls ? ' ' + cls : '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (icon ? I(icon) : '') + (text !== undefined ? '<span>' + text + '</span>' : '') + '</span>'; }
  function voidBox(icon, extra) { return '<div class="void">' + (icon ? I(icon) : '') + (extra || '') + '</div>'; }

  function renderWin() {
    var open = ui.screen !== 'home' && !ui.min;
    winEl.hidden = !open;
    document.getElementById('os').classList.toggle('winopen', open);
    if (!open) { paintBars(); return; }
    winTitleEl.textContent = winTitle();
    winIcon.innerHTML = HEX(ui.screen);
    var key = [ui.screen, ui.pview, ui.dview, ui.dreamId, ui.folder].join('|');
    var keepScroll = key === lastKey ? pane.scrollTop : 0;
    var keep = keepFields();
    pane.className = 'pane';
    if (!ui.loaded) {
      barEl.innerHTML = '';
      statusEl.innerHTML = cell(null, '', 'grow');
      pane.innerHTML = ui.failed
        ? voidBox('warn', '<p>Не вдалося завантажити дані.</p><button type="button" class="btn" data-action="retry">' + I('restore') + 'Ще раз</button>')
        : voidBox(null, '<span class="xbar busy"><i></i></span>');
    } else if (ui.screen === 'plants') renderPlantsWin();
    else if (ui.screen === 'dreams') renderDreamsWin();
    restoreFields(keep);
    pane.scrollTop = keepScroll;
    lastKey = key;
    paintBars();
  }
  // typed text survives a redraw of the window
  function keepFields() {
    var out = {};
    ['step-input'].forEach(function (k) { var el = document.getElementById(k); if (el && pane.contains(el)) out[k] = el.value; });
    var a = document.activeElement;
    out.__focus = a && pane.contains(a) && a.id ? a.id : null;
    return out;
  }
  function restoreFields(keep) {
    Object.keys(keep).forEach(function (k) { if (k === '__focus') return; var el = document.getElementById(k); if (el) el.value = keep[k]; });
    if (keep.__focus) { var f = document.getElementById(keep.__focus); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ---------- plants window ---------- */
  function renderPlantsWin() {
    var nT = state.trash.length;
    barEl.innerHTML = (ui.pview === 'trash' ? backBtn('pview', 'Назад') + SEP : '') +
      tb('add', 'plus', 'Нова рослина') + SEP +
      tb('pview', 'grid', 'Рослини', { pressed: ui.pview === 'grid', data: ' data-v="grid"' }) +
      tb('pview', 'chart', 'Щоденник', { pressed: ui.pview === 'diary', data: ' data-v="diary"' }) +
      '<span class="grow"></span>' +
      tb('pview', 'trash', 'Корзина', { pressed: ui.pview === 'trash', data: ' data-v="trash"', badge: nT || '' });
    if (ui.pview === 'diary') { pane.innerHTML = diaryHtml(); drawScope(); }
    else if (ui.pview === 'trash') pane.innerHTML = trashHtml(state.trash.map(function (t) {
      var pics = photosOf(t.plant);
      return { id: t.plant.id, title: t.plant.name, photo: pics.length ? pics[0].photo : null, deletedAt: t.deletedAt,
        sub: t.plant.logs.length + ' ' + plural(t.plant.logs.length, 'полив', 'поливи', 'поливів') + (pics.length ? ' · ' + pics.length + ' фото' : ''),
        icon: 'plant', restore: 'restore', open: pics.length ? 'gallery' : null };
    }));
    else pane.innerHTML = plantsGrid();
    var due = dueCount(), pics = state.plants.reduce(function (a, p) { return a + photosOf(p).length; }, 0);
    statusEl.innerHTML = (due ? cell('drop', due, 'warn', 'Чекають поливу') : cell('check', '', '', 'Сьогодні поливати нічого')) +
      cell('plant', state.plants.length, '', 'Рослин') + cell('image', pics, '', 'Фото') + cell(null, '', 'grow');
  }
  function plantsGrid() {
    var list = state.plants.slice().sort(function (a, b) { return urgency(a) - urgency(b); });
    return '<div class="thv">' + list.map(function (p) {
      var s = status(p), photos = photosOf(p), cover = photos.length ? photos[0].photo : null;
      var pct = s.due ? 100 : Math.round(Math.max(0.04, 1 - s.frac) * 100);
      var left = s.due ? I('warn') + (s.never || s.left === 0 ? '' : (-s.left)) : I('clock') + s.left;
      return '<article class="th' + (s.due ? ' due' : '') + '">' +
        '<div class="th-imgwrap"><button type="button" class="th-img" data-action="gallery" data-id="' + p.id + '" aria-label="Фото: ' + esc(p.name) + '" title="Фото">' +
          (cover ? '<img loading="lazy" decoding="async" src="' + esc(cover) + '" alt="">' : I('plant')) +
          (photos.length ? '<span class="th-n">' + I('image') + photos.length + '</span>' : '') + '</button>' +
          '<button type="button" class="th-water" data-action="water" data-id="' + p.id + '" aria-label="Полити: ' + esc(p.name) + '" title="Полити">' + I('drop') + '</button></div>' +
        '<button type="button" class="th-name" data-action="edit" data-id="' + p.id + '" title="Змінити">' + esc(p.name) + '</button>' +
        '<div class="th-meta" title="' + esc(s.text) + '"><span class="xbar' + (s.due ? ' warn' : '') + '"><i style="width:' + pct + '%"></i></span><span class="th-left">' + left + '</span></div>' +
        '</article>';
    }).join('') +
      '<article class="th add"><button type="button" class="th-img" data-action="add" aria-label="Нова рослина" title="Нова рослина">' + I('plus') + '</button></article></div>';
  }

  // the bin: one table for both sections, with how long each thing has left
  function trashHtml(items) {
    if (!items.length) return voidBox('trash');
    var now = Date.now();
    items.sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    return '<table class="lv"><thead><tr><th class="c-pic"></th><th>' + I('file') + '</th><th class="c-num">' + I('clock') + '</th><th class="c-act"></th></tr></thead><tbody>' +
      items.map(function (t) {
        var leftMs = Math.max(0, TRASH_MS - (now - t.deletedAt)), hrs = Math.max(1, Math.ceil(leftMs / 3600000));
        var left = hrs >= 24 ? Math.floor(hrs / 24) + ' д ' + (hrs % 24 ? (hrs % 24) + ' г' : '') : hrs + ' г';
        var pic = t.photo ? '<img loading="lazy" decoding="async" src="' + esc(t.photo) + '" alt="">' : I(t.icon);
        return '<tr><td class="c-pic">' + (t.open ? '<button type="button" class="lv-pic" data-action="' + t.open + '" data-id="' + t.id + '" aria-label="Фото">' + pic + '</button>' : '<span class="lv-pic">' + pic + '</span>') + '</td>' +
          '<td><span class="lv-name">' + esc(t.title) + '</span>' + (t.sub ? '<span class="lv-sub">' + esc(t.sub) + '</span>' : '') + '</td>' +
          '<td class="c-num"><span class="lv-time" title="Зникне через ' + esc(left.trim()) + '"><span class="xbar mini' + (hrs <= 12 ? ' warn' : '') + '"><i style="width:' + Math.round(leftMs / TRASH_MS * 100) + '%"></i></span>' + esc(left.trim()) + '</span></td>' +
          '<td class="c-act"><button type="button" class="btn ico" data-action="' + t.restore + '" data-id="' + t.id + '" aria-label="Відновити" title="Відновити">' + I('restore') + '</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- plants: the diary (an oscilloscope of waterings and the history) ---------- */
  var RANGES = [{ v: 30, t: '30' }, { v: 90, t: '90' }, { v: 365, t: '365' }, { v: 0, t: '∞' }];
  function selectedIds() {
    var all = state.plants.map(function (p) { return p.id; });
    if (!ui.statIds) return all;
    return ui.statIds.filter(function (id) { return all.indexOf(id) !== -1; });
  }
  function spanDays(ids) {
    if (ui.range) return ui.range;
    var min = null;
    ids.forEach(function (id) { findPlant(id).logs.forEach(function (l) { if (!min || l.date < min) min = l.date; }); });
    return Math.max(30, min ? diffDays(today(), parse(min)) + 3 : 30);
  }
  function diaryHtml() {
    if (!state.plants.length) return voidBox('chart');
    var ids = selectedIds();
    var picks = state.plants.map(function (p) {
      var on = ids.indexOf(p.id) !== -1;
      return '<button type="button" class="pick" role="checkbox" aria-checked="' + on + '" data-action="stat-toggle" data-id="' + p.id + '">' +
        '<span class="xchk" aria-hidden="true">' + TICK + '</span><span class="swatch" style="background:' + color(p) + '"></span>' + esc(p.name) + '</button>';
    }).join('');
    var ranges = RANGES.map(function (r) {
      return '<button type="button" class="btn" data-action="stat-range" data-v="' + r.v + '" aria-pressed="' + (ui.range === r.v) + '" title="' + (r.v ? r.v + ' днів' : 'Увесь час') + '">' + (r.v ? '' : '') + r.t + '</button>';
    }).join('');
    var all = [];
    state.plants.forEach(function (p) { p.logs.forEach(function (l) { all.push({ p: p, l: l }); }); });
    all.sort(function (a, b) { return a.l.date < b.l.date ? 1 : a.l.date > b.l.date ? -1 : b.l.ts - a.l.ts; });
    var rows = all.map(function (x) {
      var key = 'log:' + x.l.id, asking = ui.confirm === key;
      return '<tr><td class="c-pic">' + (x.l.photo
          ? '<button type="button" class="lv-pic" data-action="gallery" data-id="' + x.p.id + '" data-log="' + x.l.id + '" aria-label="Фото"><img loading="lazy" decoding="async" src="' + esc(x.l.photo) + '" alt=""></button>'
          : '<span class="lv-pic">' + I('drop') + '</span>') + '</td>' +
        '<td><span class="swatch" style="background:' + color(x.p) + '"></span>' + esc(x.p.name) + '</td>' +
        '<td class="c-num" title="' + esc(fmtDate(x.l.date)) + '">' + esc(fmtShort(x.l.date)) + '</td>' +
        '<td class="c-act"><button type="button" class="st-x' + (asking ? ' sure' : '') + '" data-action="del-log" data-plant="' + x.p.id + '" data-log="' + x.l.id + '" aria-label="Видалити запис" title="Видалити запис">' + (asking ? '?' : I('x')) + '</button></td></tr>';
    }).join('');
    return '<div class="diary"><fieldset class="grp"><legend>' + I('chart') + '</legend>' +
      '<div class="picks">' + picks + '</div><div class="ranges" role="group" aria-label="Період, днів">' + I('calendar') + ranges + '</div>' +
      '<div class="scope" id="scope"></div></fieldset>' +
      (all.length ? '<table class="lv"><thead><tr><th class="c-pic">' + I('image') + '</th><th>' + I('plant') + '</th><th class="c-num">' + I('calendar') + '</th><th class="c-act"></th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
      '</div>';
  }
  var PLANT_HEX = ['#39D353', '#FFC93C', '#4FC3F7', '#FF6FAE', '#B388FF', '#FF8A3D', '#3DE0C8', '#E8E86A'];
  function drawScope() {
    var box = document.getElementById('scope');
    if (!box) return;
    var ids = selectedIds();
    var W = Math.max(260, Math.floor(box.clientWidth - 8) || 300);
    if (!ids.length) { box.innerHTML = '<svg viewBox="0 0 ' + W + ' 60" width="' + W + '" height="60"><rect width="100%" height="100%" fill="url(#scope-grid)"/></svg>'; ensureGrid(box); return; }
    var span = spanDays(ids), tIso = iso(today()), startIso = addDays(tIso, -span);
    var L = 8, Rr = 12, top = 6, laneH = 48, axisH = 26, plotW = W - L - Rr, H = top + ids.length * laneH + axisH, gb = top + ids.length * laneH;
    function X(d) { return L + (diffDays(parse(d), parse(startIso)) / span) * plotW; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Поливи на часовій шкалі">' +
      '<defs><pattern id="scope-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#0A5A0A" stroke-width="1"/></pattern></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#scope-grid)"/>';
    var n = W < 420 ? 3 : 5, pts = [];
    for (var i = 0; i < n; i++) {
      var off = Math.round(span * i / (n - 1)), tx = L + (off / span) * plotW;
      s += '<text class="sc-txt dim" x="' + tx.toFixed(1) + '" y="' + (gb + 19) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' +
        esc(i === n - 1 ? 'сьогодні' : fmtShort(addDays(startIso, off))) + '</text>';
    }
    ids.forEach(function (id, li) {
      var p = findPlant(id), c = PLANT_HEX[p.slot % 8], y0 = top + li * laneH, by = y0 + 34;
      s += '<text class="sc-txt" x="' + (L + 2) + '" y="' + (y0 + 16) + '" style="fill:' + c + '">' + esc(p.name) + '</text>';
      var asc = ascLogs(p), inR = [];
      asc.forEach(function (l, k) { if (l.date >= startIso && l.date <= tIso) inR.push({ l: l, gap: k > 0 ? diffDays(parse(l.date), parse(asc[k - 1].date)) : null }); });
      for (var k = 1; k < inR.length; k++) s += '<line class="sc-line" x1="' + X(inR[k - 1].l.date).toFixed(1) + '" x2="' + X(inR[k].l.date).toFixed(1) + '" y1="' + by + '" y2="' + by + '" style="stroke:' + c + '"/>';
      inR.forEach(function (e) {
        var cx = X(e.l.date), idx = pts.length;
        pts.push({ p: p, date: e.l.date, gap: e.gap, cx: cx, cy: by });
        s += '<rect class="sc-dot" x="' + (cx - 4).toFixed(1) + '" y="' + (by - 4) + '" width="8" height="8" style="fill:' + c + '"/>' +
          '<rect class="sc-hit" data-i="' + idx + '" tabindex="0" x="' + (cx - 14).toFixed(1) + '" y="' + (by - 14) + '" width="28" height="28"/>';
      });
    });
    box.innerHTML = s + '</svg>';
    var tip = document.createElement('div');
    tip.className = 'tip'; tip.hidden = true;
    box.appendChild(tip);
    function show(el) {
      var pt = pts[Number(el.getAttribute('data-i'))];
      tip.innerHTML = '<b>' + esc(pt.p.name) + '</b>' + esc(fmtDate(pt.date)) + (pt.gap === null ? '' : ' · ' + pt.gap + ' дн.');
      tip.hidden = false;
      var k = box.clientWidth / W;
      tip.style.left = Math.min(box.clientWidth - tip.offsetWidth / 2 - 2, Math.max(tip.offsetWidth / 2 + 2, pt.cx * k + 4)) + 'px';
      tip.style.top = (pt.cy * k + 4) + 'px';
    }
    box.querySelectorAll('.sc-hit').forEach(function (h) {
      h.addEventListener('pointerenter', function () { show(h); });
      h.addEventListener('pointerdown', function () { show(h); });
      h.addEventListener('focus', function () { show(h); });
      h.addEventListener('pointerleave', function () { tip.hidden = true; });
      h.addEventListener('blur', function () { tip.hidden = true; });
    });
  }
  function ensureGrid(box) {
    var svg = box.querySelector('svg');
    if (svg && !svg.querySelector('pattern')) svg.insertAdjacentHTML('afterbegin', '<defs><pattern id="scope-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#0A5A0A" stroke-width="1"/></pattern></defs>');
  }

  /* ---------- dreams window ---------- */
  function renderDreamsWin() {
    var d = curDream();
    if (ui.dreamId && !d) ui.dreamId = null;
    if (ui.dview === 'trash') {
      barEl.innerHTML = backBtn('dview', 'Назад') + SEP + tb('dream-add', 'star', 'Нова мрія', { disabled: true }) + '<span class="grow"></span>' +
        tb('dview', 'trash', 'Корзина', { pressed: true, data: ' data-v="trash"', badge: state.dreamTrash.length || '' });
      pane.innerHTML = trashHtml(state.dreamTrash.map(function (t) {
        var n = t.dream.steps.length, m = t.dream.files.filter(function (f) { return f.kind !== 'folder'; }).length;
        return { id: t.dream.id, title: t.dream.title, photo: t.dream.photo, deletedAt: t.deletedAt, icon: 'star', restore: 'dream-restore', open: null,
          sub: [n ? n + ' ' + plural(n, 'крок', 'кроки', 'кроків') : '', m ? m + ' ' + plural(m, 'матеріал', 'матеріали', 'матеріалів') : ''].filter(Boolean).join(' · ') };
      }));
      statusEl.innerHTML = cell('trash', state.dreamTrash.length) + cell(null, '', 'grow');
      return;
    }
    if (d) { renderDreamPage(d); return; }
    barEl.innerHTML = tb('dream-add', 'plus', 'Нова мрія') + '<span class="grow"></span>' +
      tb('dview', 'trash', 'Корзина', { pressed: false, data: ' data-v="trash"', badge: state.dreamTrash.length || '' });
    var cur = state.dreams.filter(function (x) { return x.status !== 'done'; }).sort(function (a, b) { return (a.status === 'progress' ? 0 : 1) - (b.status === 'progress' ? 0 : 1) || a.ts - b.ts; });
    var fin = state.dreams.filter(function (x) { return x.status === 'done'; });
    pane.innerHTML = '<div class="thv">' + cur.map(dreamTh).join('') +
      '<article class="th add"><button type="button" class="th-img" data-action="dream-add" aria-label="Нова мрія" title="Нова мрія">' + I('plus') + '</button></article></div>' +
      (fin.length ? '<h2 class="grp-h">' + I('star') + I('check') + '<span>' + fin.length + '</span></h2><div class="thv">' + fin.map(dreamTh).join('') + '</div>' : '');
    statusEl.innerHTML = cell('star', state.dreams.length, '', 'Мрій') + cell('check', fin.length, '', 'Здійснено') + cell(null, '', 'grow');
  }
  function dreamTh(d) {
    var n = d.steps.length, k = stepsDone(d), done = d.status === 'done';
    return '<article class="th' + (done ? ' done' : '') + '">' +
      '<div class="th-imgwrap"><button type="button" class="th-img" data-action="dream-open" data-id="' + d.id + '" aria-label="' + esc(d.title) + '">' +
        (d.photo ? '<img loading="lazy" decoding="async" src="' + esc(d.photo) + '" alt="">' : HEX('dreams')) + '</button>' +
        (done ? '<span class="th-flag">' + I('star') + '</span>' : '') + '</div>' +
      '<button type="button" class="th-name" data-action="dream-open" data-id="' + d.id + '">' + esc(d.title) + '</button>' +
      (n && !done ? '<div class="th-meta" title="' + k + ' з ' + n + '"><span class="xbar"><i style="width:' + Math.round(k / n * 100) + '%"></i></span><span class="th-left">' + k + '/' + n + '</span></div>' : '') +
      '</article>';
  }

  function renderDreamPage(d) {
    var n = d.steps.length, k = stepsDone(d), done = d.status === 'done';
    var nFiles = filesOf(d).filter(function (f) { return f.kind !== 'folder'; }).length;
    var days = Math.max(1, Math.round((Date.now() - d.ts) / 86400000));
    barEl.innerHTML = backBtn('dream-back', 'Усі мрії') + SEP +
      tb('dream-edit', 'edit', 'Назва, фото, чому') +
      tb('dream-done', 'star', done ? 'Здійснилась (натисни, щоб повернути)' : 'Мрія здійснилась', { pressed: done, cls: 'on-star' }) +
      '<span class="grow"></span>' +
      tb('dream-delete', 'trash', ui.confirm === 'dream' ? 'Натисни ще раз, щоб видалити' : 'У корзину', { cls: ui.confirm === 'dream' ? 'sure' : '' });
    pane.className = 'pane dpane';
    var side = '<aside class="dp-side">' +
      '<div class="tpb"><div class="tpb-b"><div class="cover">' + (d.photo ? '<img src="' + esc(d.photo) + '" alt="">' : HEX('dreams')) + '</div></div></div>' +
      '<div class="tpb"><div class="tpb-h">' + I('check') + '<span>' + (done ? '★' : (n ? k + ' / ' + n : '0')) + '</span></div><div class="tpb-b">' +
        '<div class="prog"><span class="xbar"><i style="width:' + (done ? 100 : n ? Math.round(k / n * 100) : 0) + '%"></i></span></div>' +
        '<div class="facts"><span class="fact" title="Днів з мрією">' + I('calendar') + counter(days) + '</span><span class="fact" title="Матеріали">' + I('file') + nFiles + '</span></div>' +
      '</div></div>' +
      (done ? '<div class="tpb"><div class="tpb-h">' + I('star') + '<span>' + (d.doneOn ? esc(fmtDate(d.doneOn)) : '') + '</span></div><div class="tpb-b"><div class="donebox">' +
        '<input type="date" class="fld" id="done-date" value="' + esc(d.doneOn || '') + '" max="' + iso(today()) + '" aria-label="Коли здійснилась">' +
        (d.doneOn ? '<button type="button" class="btn ico" data-action="done-date-clear" aria-label="Прибрати дату" title="Прибрати дату">' + I('x') + '</button>' : '') + '</div></div></div>' : '') +
      (d.why ? '<div class="tpb"><div class="tpb-h">' + I('quote') + '</div><div class="tpb-b"><p class="why">' + esc(d.why) + '</p></div></div>' : '') +
      '</aside>';
    pane.innerHTML = '<div class="dp">' + side + '<div class="dp-main">' + stepsHtml(d) + matsHtml(d) + '</div></div>';
    statusEl.innerHTML = cell('check', n ? k + '/' + n : '0', '', 'Кроки') + cell('file', nFiles, '', 'Матеріали') + cell('calendar', days, '', 'Днів з мрією') + cell(null, '', 'grow');
  }
  function counter(n, w) { return '<span class="counter" aria-label="' + n + '">' + String(n).padStart(w || 3, '0').split('').map(function (c) { return '<b>' + c + '</b>'; }).join('') + '</span>'; }

  function stepRow(st, done) {
    var subs = st.s || [], sd = subs.filter(function (x) { return x.d; }).length, asking = ui.confirm === 'step:' + st.id;
    var meta = (subs.length ? I('check') + sd + '/' + subs.length : '') + (st.n ? I('note') : '');
    return '<li class="st' + (done ? ' done' : '') + '" data-sid="' + esc(st.id) + '">' +
      (done ? '' : '<span class="grip" data-grip aria-hidden="true">' + GRIP + '</span>') +
      '<button type="button" class="xchk" role="checkbox" aria-checked="' + !!st.d + '" data-action="step-toggle" data-step="' + esc(st.id) + '" aria-label="' + esc(st.t) + '">' + TICK + '</button>' +
      '<button type="button" class="st-t" data-action="step-open" data-step="' + esc(st.id) + '"><span>' + esc(st.t) + '</span>' + (meta ? '<small>' + meta + '</small>' : '') + '</button>' +
      '<button type="button" class="st-x' + (asking ? ' sure' : '') + '" data-action="step-del" data-step="' + esc(st.id) + '" aria-label="Прибрати крок" title="Прибрати крок">' + (asking ? '?' : I('x')) + '</button></li>';
  }
  function stepsHtml(d) {
    var open = d.steps.filter(function (s) { return !s.d; }), done = d.steps.filter(function (s) { return s.d; });
    var html = '<fieldset class="grp"><legend>' + I('check') + '<span class="sr">Кроки</span></legend>' +
      '<ul class="steps" id="steps">' + open.map(function (st) { return stepRow(st, false); }).join('') + '</ul>' +
      '<form id="step-form" class="addrow"><input type="text" class="fld" id="step-input" maxlength="140" placeholder="Новий крок" autocomplete="off" enterkeyhint="done" aria-label="Новий крок">' +
      '<button type="submit" class="btn ico" aria-label="Додати крок" title="Додати крок">' + I('plus') + '</button></form>';
    if (done.length) {
      html += '<button type="button" class="fold" data-action="steps-fold" aria-expanded="' + ui.showDone + '">' + FOLD + I('check') + done.length + '</button>';
      if (ui.showDone) html += '<ul class="steps">' + done.map(function (st) { return stepRow(st, true); }).join('') + '</ul>';
    }
    return html + '</fieldset>';
  }
  function matsHtml(d) {
    if (ui.folder && !findFile(d, ui.folder)) ui.folder = null;
    var trail = [], cur = ui.folder ? findFile(d, ui.folder) : null;
    while (cur) { trail.unshift(cur); cur = cur.parent ? findFile(d, cur.parent) : null; }
    var addr = '<div class="addr">' + I('folder') + '<span><button type="button" data-action="m-folder" data-m="">/</button>' +
      trail.map(function (f, i) { return ' ' + (i < trail.length - 1 ? '<button type="button" data-action="m-folder" data-m="' + f.id + '">' + esc(f.name) + '</button>' : esc(f.name)) + ' /'; }).join('') + '</span></div>';
    var items = childrenOf(d, ui.folder);
    var bar = '<div class="mbar">' + tb('m-up', 'up', 'Вгору', { disabled: !ui.folder }) + SEP +
      tb('m-upload', 'upload', 'Додати файл') + tb('m-note-new', 'noteadd', 'Нова нотатка') + tb('m-folder-new', 'folderadd', 'Нова папка') + '</div>';
    var icv = items.length ? '<div class="icv">' + items.map(function (f) {
      var url = f.path ? fileUrls[f.path] : null, isImg = f.kind === 'file' && /^image\//.test(f.mime) && url, inner;
      if (f.kind === 'folder') inner = I('folder');
      else if (f.kind === 'note') inner = I('note');
      else if (isImg) inner = '<span class="ic-pic"><img loading="lazy" decoding="async" src="' + esc(url) + '" alt=""></span>';
      else {
        var ext = ((f.name.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || '').toUpperCase();
        inner = I('file') + (ext ? '<i class="ic-ext">' + esc(ext) + '</i>' : '');
      }
      var label = '<span>' + esc(f.name) + '</span>';
      var open = f.kind === 'file'
        ? '<a class="ic-open" href="' + esc(url || '#') + '" target="_blank" rel="noopener" title="' + esc(f.name + (f.size != null ? ' · ' + fmtSize(f.size) : '')) + '">' + inner + label + '</a>'
        : '<button type="button" class="ic-open" data-action="' + (f.kind === 'folder' ? 'm-folder' : 'm-note') + '" data-m="' + f.id + '" title="' + esc(f.name) + '">' + inner + label + '</button>';
      return '<div class="ic">' + open + '<button type="button" class="ic-more" data-action="m-prop" data-m="' + f.id + '" aria-label="Змінити: ' + esc(f.name) + '" title="Змінити">' + I('edit') + '</button></div>';
    }).join('') + '</div>' : '<button type="button" class="void" data-action="m-upload" style="border:0;background:transparent;width:100%;min-height:110px" aria-label="Додати файл">' + I('upload') + '</button>';
    return '<fieldset class="grp mats" id="mats"><legend>' + I('folder') + '<span class="sr">Матеріали</span></legend>' + addr + bar + icv + '</fieldset>';
  }

  /* ---------- dialogs ---------- */
  var modal = document.getElementById('modal');
  var dlg = document.getElementById('dlg');
  var fCam = document.getElementById('f-cam'), fLib = document.getElementById('f-lib'), fFiles = document.getElementById('f-files');
  var isTouch = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function shell(icon, title, body, wide) {
    dlg.className = 'dlg' + (wide ? ' wide' : '');
    dlg.innerHTML = '<header class="tb"><span class="tb-i" aria-hidden="true">' + icon + '</span><h2 class="tb-t" id="dlg-title">' + esc(title) + '</h2>' +
      '<button type="button" class="tb-b x" data-action="dlg-close" aria-label="Закрити">' + XMARK + '</button></header><div class="dlg-b">' + body + '</div>';
  }
  function pickRow(prefix) {
    return '<div class="picks-row">' +
      (isTouch ? '<button type="button" class="btn" data-action="' + prefix + 'cam" aria-label="Зробити фото" title="Зробити фото">' + I('camera') + '</button>' : '') +
      '<button type="button" class="btn" data-action="' + prefix + 'lib" aria-label="' + (isTouch ? 'З галереї' : 'Вибрати фото') + '" title="' + (isTouch ? 'З галереї' : 'Вибрати фото') + '">' + I('image') + '</button></div>' +
      '<div class="pv" id="pv"' + (photo.url ? '' : ' hidden') + '><img id="pv-img" alt=""' + (photo.url ? ' src="' + esc(photo.url) + '"' : '') + '>' +
      '<button type="button" class="btn ico" data-action="photo-clear" aria-label="Прибрати фото" title="Прибрати фото">' + I('x') + '</button></div>';
  }
  function resetPhoto() {
    if (photo.url && photo.blob) URL.revokeObjectURL(photo.url);
    photo = { blob: null, url: null, remove: false };
    fCam.value = ''; fLib.value = '';
  }
  function openDlg(type, id, extra) {
    resetPhoto();
    ui.confirm = null;
    ui.dlg = Object.assign({ type: type, id: id || null }, extra || {});
    setMenu(false);
    paintDlg(true);
    modal.hidden = false;
    var first = null;
    if (!isTouch) first = dlg.querySelector('.dlg-b input:not([type="date"]), .dlg-b textarea');
    if (!first) first = dlg.querySelector('.tb-b.x');
    setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }
  function closeDlg() {
    modal.hidden = true;
    dlg.innerHTML = '';
    ui.dlg = null; ui.confirm = null;
    resetPhoto();
  }
  function paintDlg(first) {
    var t = ui.dlg && ui.dlg.type;
    if (!t) return;
    if (t === 'water') {
      var p = findPlant(ui.dlg.id); if (!p) return closeDlg();
      shell(I('drop'), p.name, '<form id="f-water">' +
        '<div class="row">' + I('calendar') + '<input type="date" class="fld" id="w-date" value="' + iso(today()) + '" max="' + iso(today()) + '" required aria-label="Дата поливу"></div>' +
        '<div class="seg" id="w-days">' + [['0', 'сьогодні'], ['1', 'вчора'], ['2', '−2']].map(function (x) {
          return '<button type="button" class="btn" data-action="w-day" data-d="' + x[0] + '" aria-pressed="' + (x[0] === '0') + '">' + x[1] + '</button>';
        }).join('') + '</div>' + pickRow('w-') +
        '<div class="acts"><button type="submit" class="btn def" id="dlg-ok">' + I('drop') + 'OK</button></div></form>');
    } else if (t === 'plant') {
      var q = ui.dlg.id ? findPlant(ui.dlg.id) : null;
      shell(I('plant'), q ? q.name : 'Нова рослина', '<form id="f-plant">' +
        '<input type="text" class="fld big-name" id="p-name" maxlength="60" required autocomplete="off" placeholder="Назва" aria-label="Назва" value="' + esc(q ? q.name : '') + '">' +
        '<div class="row" title="Поливати раз на скільки днів">' + I('repeat') + '<div class="spin">' +
          '<button type="button" class="btn" data-action="int-step" data-d="-1" aria-label="Менше">−</button>' +
          '<input type="number" class="fld" id="p-int" min="1" max="365" inputmode="numeric" required aria-label="Днів між поливами" value="' + (q ? q.interval : 7) + '">' +
          '<button type="button" class="btn" data-action="int-step" data-d="1" aria-label="Більше">+</button></div></div>' +
        '<div class="seg" id="p-pre">' + [3, 7, 14, 21, 30].map(function (v) { return '<button type="button" class="btn" data-action="int-set" data-v="' + v + '">' + v + '</button>'; }).join('') + '</div>' +
        '<div class="acts">' + (q ? '<button type="button" class="btn ico danger" data-action="plant-del" aria-label="У корзину" title="У корзину">' + I('trash') + '</button><span class="grow"></span>' : '') +
        '<button type="submit" class="btn def" id="dlg-ok">OK</button></div></form>');
      paintPresets();
    } else if (t === 'gallery') {
      paintGallery();
    } else if (t === 'dream') {
      var d = ui.dlg.id ? findDream(ui.dlg.id) : null;
      if (first && d && d.photo) photo.url = d.photo;
      shell(I('star'), d ? d.title : 'Нова мрія', '<form id="f-dream">' +
        '<input type="text" class="fld big-name" id="d-title" maxlength="80" required autocomplete="off" placeholder="Мрія" aria-label="Мрія" value="' + esc(d ? d.title : '') + '">' +
        pickRow('d-') +
        '<div class="row" style="align-items:flex-start" title="Чому я цього хочу">' + I('quote') + '<textarea class="fld" id="d-why" rows="3" maxlength="2000" placeholder="Чому?" aria-label="Чому я цього хочу">' + esc(d ? d.why : '') + '</textarea></div>' +
        '<div class="acts"><button type="submit" class="btn def" id="dlg-ok">OK</button></div></form>');
    } else if (t === 'step') {
      var dd = curDream(), st = dd && dd.steps.filter(function (x) { return x.id === ui.dlg.id; })[0];
      if (!st) return closeDlg();
      var subs = st.s || [];
      shell(I('check'), st.t, '<input type="text" class="fld big-name" id="s-title" maxlength="140" aria-label="Назва кроку" value="' + esc(st.t) + '">' +
        '<ul class="subs">' + subs.map(function (x) {
          return '<li class="sub' + (x.d ? ' done' : '') + '"><button type="button" class="xchk" role="checkbox" aria-checked="' + !!x.d + '" data-action="sub-toggle" data-sub="' + esc(x.id) + '" aria-label="' + esc(x.t) + '">' + TICK + '</button>' +
            '<input type="text" class="fld sub-t" data-sub="' + esc(x.id) + '" maxlength="140" value="' + esc(x.t) + '" aria-label="Підкрок">' +
            '<button type="button" class="st-x" data-action="sub-del" data-sub="' + esc(x.id) + '" aria-label="Прибрати" title="Прибрати">' + I('x') + '</button></li>';
        }).join('') + '</ul>' +
        '<form id="f-sub" class="addrow"><input type="text" class="fld" id="sub-input" maxlength="140" placeholder="Підкрок" autocomplete="off" enterkeyhint="done" aria-label="Новий підкрок">' +
        '<button type="submit" class="btn ico" aria-label="Додати підкрок" title="Додати підкрок">' + I('plus') + '</button></form>' +
        '<div class="row" style="align-items:flex-start" title="Нотатка">' + I('note') + '<textarea class="fld" id="s-note" rows="4" maxlength="2000" placeholder="…" aria-label="Нотатка">' + esc(st.n || '') + '</textarea></div>' +
        '<div class="acts"><button type="button" class="btn ico danger" data-action="step-del" data-step="' + esc(st.id) + '" aria-label="Видалити крок" title="Видалити крок">' + I('trash') + '</button><span class="grow"></span>' +
        '<button type="button" class="btn def" data-action="dlg-close">OK</button></div>');
    } else if (t === 'note') {
      var dn = curDream(), note = ui.dlg.id ? dn && findFile(dn, ui.dlg.id) : null;
      shell(I('note'), note ? note.name : 'Нова нотатка', '<form id="f-note">' +
        '<input type="text" class="fld big-name" id="n-title" maxlength="120" placeholder="Назва" aria-label="Назва нотатки" value="' + esc(note ? note.name : '') + '">' +
        '<textarea class="fld notepad" id="n-body" rows="12" maxlength="20000" aria-label="Текст нотатки">' + esc(note ? note.body : '') + '</textarea>' +
        '<div class="acts">' + (note ? '<button type="button" class="btn ico danger" data-action="m-del" data-m="' + note.id + '" aria-label="Видалити" title="Видалити">' + I('trash') + '</button><span class="grow"></span>' : '') +
        '<button type="submit" class="btn def" id="dlg-ok">OK</button></div></form>', true);
    } else if (t === 'folder') {
      shell(I('folderadd'), 'Нова папка', '<form id="f-folder"><div class="row">' + I('folder') +
        '<input type="text" class="fld" id="fo-name" maxlength="120" required autocomplete="off" placeholder="Назва" aria-label="Назва папки"></div>' +
        '<div class="acts"><button type="submit" class="btn def" id="dlg-ok">OK</button></div></form>');
    } else if (t === 'prop') {
      var dp = curDream(), f = dp && findFile(dp, ui.dlg.id);
      if (!f) return closeDlg();
      var url = f.path ? fileUrls[f.path] : null;
      var icon = f.kind === 'folder' ? 'folder' : f.kind === 'note' ? 'note' : 'file';
      shell(I(icon), f.name, '<form id="f-prop"><div class="row">' + I(icon) +
        '<input type="text" class="fld" id="pr-name" maxlength="120" required autocomplete="off" aria-label="Назва" value="' + esc(f.name) + '"></div>' +
        (f.kind === 'file' ? '<p class="hint">' + esc(fmtSize(f.size)) + (f.mime ? ' · ' + esc(f.mime) : '') + '</p>' : '') +
        '<div class="acts"><button type="button" class="btn ico danger" data-action="m-del" data-m="' + f.id + '" aria-label="Видалити" title="Видалити">' + I('trash') + '</button>' +
        (url ? '<a class="btn ico" href="' + esc(url) + '" target="_blank" rel="noopener" aria-label="Відкрити" title="Відкрити">' + I('open') + '</a>' : '') +
        '<span class="grow"></span><button type="submit" class="btn def" id="dlg-ok">OK</button></div></form>');
    }
  }

  // the picture viewer: one photo, round arrows, the date and the gap since the watering before
  function paintGallery() {
    var p = findAny(ui.dlg.id);
    if (!p) return closeDlg();
    var photos = photosOf(p);
    if (!photos.length) { shell(I('image'), p.name, voidBox('image')); return; }
    var i0 = Math.min(Math.max(0, ui.dlg.i || 0), photos.length - 1), l = photos[i0];
    ui.dlg.i = i0;
    var asc = ascLogs(p), ai = asc.indexOf(l), gap = ai > 0 ? diffDays(parse(l.date), parse(asc[ai - 1].date)) : null;
    shell(I('image'), p.name, '<div class="viewer"><div class="stage" id="stage"><img src="' + esc(l.photo) + '" alt="Фото від ' + esc(fmtDate(l.date)) + '" draggable="false"></div>' +
      '<div class="vbar"><button type="button" class="back" data-action="gal-step" data-d="-1" aria-label="Попереднє"' + (i0 === 0 ? ' disabled' : '') + '>' + ARROW_L + '</button>' +
      '<span class="tag" title="' + esc(fmtDate(l.date)) + '">' + I('drop') + esc(fmtShort(l.date)) + '</span>' +
      (gap !== null ? '<span class="tag" title="Днів від попереднього поливу">' + I('repeat') + gap + '</span>' : '') +
      (photos.length > 1 ? '<span class="tag">' + (i0 + 1) + ' / ' + photos.length + '</span>' : '') +
      '<button type="button" class="back" data-action="gal-step" data-d="1" aria-label="Наступне"' + (i0 === photos.length - 1 ? ' disabled' : '') + '>' + ARROW_R + '</button></div>' +
      (photos.length > 1 ? '<div class="strip" id="strip">' + photos.map(function (x, i) {
        return '<button type="button" data-action="gal-open" data-i="' + i + '"' + (i === i0 ? ' aria-current="true"' : '') + ' aria-label="Фото від ' + esc(fmtDate(x.date)) + '"><img loading="lazy" decoding="async" src="' + esc(x.photo) + '" alt=""></button>';
      }).join('') + '</div>' : '') + '</div>', true);
    var cur = dlg.querySelector('.strip [aria-current]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function galStep(dir) {
    if (!ui.dlg || ui.dlg.type !== 'gallery') return;
    var n = photosOf(findAny(ui.dlg.id) || { logs: [] }).length, next = (ui.dlg.i || 0) + dir;
    if (next < 0 || next >= n) return;
    ui.dlg.i = next; paintGallery();
  }
  function paintPresets() {
    var inp = document.getElementById('p-int');
    if (!inp) return;
    var v = String(parseInt(inp.value, 10) || '');
    dlg.querySelectorAll('#p-pre .btn').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false'); });
  }
  function paintDays() {
    var w = document.getElementById('w-date');
    if (!w) return;
    dlg.querySelectorAll('#w-days .btn').forEach(function (b) {
      var d = today(); d.setDate(d.getDate() - Number(b.getAttribute('data-d')));
      b.setAttribute('aria-pressed', iso(d) === w.value ? 'true' : 'false');
    });
  }
  function showPreview() {
    var pv = document.getElementById('pv'), img = document.getElementById('pv-img');
    if (!pv || !img) return;
    pv.hidden = !photo.url;
    if (photo.url) img.src = photo.url; else img.removeAttribute('src');
  }

  // shrink a picked photo in the browser so uploads stay small
  function fileToBlob(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }
  function onPick(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    fileToBlob(f, 1600).then(function (blob) {
      if (photo.url && photo.blob) URL.revokeObjectURL(photo.url);
      photo = { blob: blob, url: URL.createObjectURL(blob), remove: false };
      showPreview();
    }).catch(function () { toast('Не вдалося прочитати це фото.', 'warn'); });
  }
  fCam.addEventListener('change', function () { onPick(fCam); });
  fLib.addEventListener('change', function () { onPick(fLib); });
  fFiles.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fFiles.files || []);
    fFiles.value = '';
    uploadMaterials(files);
  });
  function uploadMaterials(files) {
    var d = curDream();
    if (!d || !files.length || ui.busy) return;
    var big = files.filter(function (f) { return f.size > FILE_MAX; });
    if (big.length) { toast('Файл більший за 50 МБ: ' + big[0].name, 'warn'); return; }
    var parent = ui.folder;
    toast(files.length > 1 ? 'Завантажую ' + files.length + ' файли…' : 'Завантажую файл…', 'upload');
    run(function () { return addFiles(d, parent, files); }, files.length > 1 ? 'Файли додано' : 'Файл додано', 'check');
  }

  /* ---------- the balloon ---------- */
  var toastEl = document.getElementById('toast'), toastT = 0;
  function toast(msg, icon) {
    toastEl.innerHTML = I(icon || 'check') + '<span>' + esc(msg) + '</span>';
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.hidden = true; }, 2800);
  }
  toastEl.addEventListener('click', function () { toastEl.hidden = true; });

  /* ---------- moving around ---------- */
  var navDepth = 0;
  function pushNav(st) { try { navDepth++; st.n = navDepth; history.pushState(st, ''); } catch (e) {} }
  function openSection(id) {
    var s = SECTIONS[id];
    setMenu(false);
    if (!s) return;
    if (!s.ready) { toast('Скоро', 'flag'); return; }
    if (ui.screen === id) { ui.min = false; render(); return; }
    ui.screen = id; ui.min = false; ui.confirm = null; ui.dreamId = null; ui.folder = null;
    if (ui.pview === 'trash') ui.pview = 'grid';
    ui.dview = 'list';
    pushNav({ s: id });
    render();
  }
  var skipPop = 0;
  function closeWin() {
    ui.screen = 'home'; ui.dreamId = null; ui.min = false; ui.confirm = null;
    render();
    // step the browser history back too, so the phone's back gesture does not reopen the window
    if (navDepth > 0) { var k = navDepth; navDepth = 0; skipPop++; history.go(-k); }
  }
  function openDream(id) {
    ui.dreamId = id; ui.folder = null; ui.showDone = false; ui.confirm = null;
    pushNav({ s: 'dreams', d: id });
    render();
  }
  function dreamBack() {
    if (history.state && history.state.d) { history.back(); return; }
    ui.dreamId = null; ui.confirm = null; render();
  }
  window.addEventListener('popstate', function (e) {
    var st = e.state || {};
    navDepth = st.n || 0;
    if (skipPop) { skipPop--; return; }
    if (ui.dlg) closeDlg();
    setMenu(false);
    ui.screen = st.s || 'home';
    ui.dreamId = st.d || null;
    ui.folder = null; ui.min = false; ui.confirm = null;
    if (ui.screen === 'dreams') ui.dview = 'list';
    render();
  });

  // old web counters on the desktop: every watering ever, every dream that came true
  var hitsEl = document.getElementById('hits');
  function renderHits() {
    if (!ui.loaded) { hitsEl.innerHTML = ''; return; }
    var w = state.plants.reduce(function (a, p) { return a + p.logs.length; }, 0);
    var done = state.dreams.filter(function (d) { return d.status === 'done'; }).length;
    hitsEl.innerHTML = '<span class="hit" title="Поливів усього">' + I('drop') + counter(w, 5) + '</span>' +
      '<span class="hit" title="Мрій здійснено">' + I('star') + counter(done, 3) + '</span>';
  }
  function render() {
    renderFlower();
    renderHits();
    renderWin();
    renderTask();
  }
  // the phone's top bar follows what is on screen
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  function paintBars() {
    var winOpen = ui.screen !== 'home' && !ui.min;
    var c = isDark() ? (winOpen ? '#3E3E42' : '#0F1318') : (winOpen ? '#0058EE' : '#3A6EA5');
    if (metaTheme.getAttribute('content') !== c) {
      var m = document.createElement('meta'); m.name = 'theme-color'; m.content = c;
      metaTheme.parentNode.replaceChild(m, metaTheme); metaTheme = m;
    }
    document.documentElement.style.background = c;
  }

  /* ---------- confirm by pressing twice ---------- */
  function confirmTwice(el, key) {
    if (ui.confirm === key) { ui.confirm = null; return true; }
    clearSure();
    ui.confirm = key;
    el.classList.add('sure');
    if (!el.querySelector('em')) el.insertAdjacentHTML('beforeend', '<em>?</em>');
    return false;
  }
  function clearSure() {
    document.querySelectorAll('.sure').forEach(function (b) { b.classList.remove('sure'); var em = b.querySelector('em'); if (em) em.remove(); });
  }

  /* ---------- clicks ---------- */
  var pressOnBackdrop = false;
  document.addEventListener('pointerdown', function (e) { pressOnBackdrop = e.target === modal; }, true);
  document.addEventListener('click', function (e) {
    if (e.target === modal) { if (pressOnBackdrop) closeDlg(); return; }
    if (ui.menu && !e.target.closest('#startm') && !e.target.closest('#start-btn')) setMenu(false);
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action'), id = el.getAttribute('data-id'), m = el.getAttribute('data-m');
    // a pending "press again to delete" is dropped by anything else
    if (ui.confirm && ['plant-del', 'step-del', 'm-del', 'dream-delete', 'del-log'].indexOf(act) === -1) {
      var hadList = /^(log|step):/.test(ui.confirm) || ui.confirm === 'dream';
      ui.confirm = null; clearSure();
      if (hadList && !ui.dlg) renderWin();
    }
    var d = curDream();
    switch (act) {
      case 'open': openSection(el.getAttribute('data-section')); return;
      case 'start': setMenu(!ui.menu); return;
      case 'task': ui.min = !ui.min; render(); return;
      case 'minimize': ui.min = true; render(); return;
      case 'close-win': closeWin(); return;
      case 'theme': toggleTheme(); return;
      case 'signout': setMenu(false); sb.auth.signOut().then(showLogin, showLogin); return;
      case 'retry': start(); return;
      case 'dlg-close': closeDlg(); return;

      // plants
      case 'pview': ui.pview = el.getAttribute('data-v') || 'grid'; ui.confirm = null; render(); return;
      case 'add': openDlg('plant'); return;
      case 'edit': openDlg('plant', id); return;
      case 'water': openDlg('water', id); return;
      case 'gallery': {
        var gp = findAny(id), li = el.getAttribute('data-log'), gi = 0;
        if (gp && li) gi = Math.max(0, photosOf(gp).map(function (x) { return x.id; }).indexOf(li));
        openDlg('gallery', id, { i: gi }); return;
      }
      case 'gal-step': galStep(Number(el.getAttribute('data-d'))); return;
      case 'gal-open': ui.dlg.i = Number(el.getAttribute('data-i')); paintGallery(); return;
      case 'w-day': {
        var wd = today(); wd.setDate(wd.getDate() - Number(el.getAttribute('data-d')));
        document.getElementById('w-date').value = iso(wd); paintDays(); return;
      }
      case 'w-cam': case 'd-cam': fCam.click(); return;
      case 'w-lib': case 'd-lib': fLib.click(); return;
      case 'photo-clear': if (photo.blob && photo.url) URL.revokeObjectURL(photo.url); photo = { blob: null, url: null, remove: true }; fCam.value = ''; fLib.value = ''; showPreview(); return;
      case 'int-step': {
        var inp = document.getElementById('p-int');
        inp.value = Math.max(1, Math.min(365, (parseInt(inp.value, 10) || 1) + Number(el.getAttribute('data-d')))); paintPresets(); return;
      }
      case 'int-set': document.getElementById('p-int').value = el.getAttribute('data-v'); paintPresets(); return;
      case 'plant-del':
        if (!confirmTwice(el, 'plant')) return;
        var pid = ui.dlg && ui.dlg.id;
        run(function () { return trashPlant(pid); }, 'Рослина в корзині на 2 дні', 'trash').then(function (ok) { if (ok) closeDlg(); });
        return;
      case 'restore': run(function () { return restorePlant(id); }, 'Рослину відновлено', 'restore'); return;
      case 'del-log': {
        var plantId = el.getAttribute('data-plant'), logId = el.getAttribute('data-log'), key = 'log:' + logId;
        if (ui.confirm !== key) { ui.confirm = key; renderWin(); return; }
        ui.confirm = null;
        run(function () { return deleteEntry(plantId, logId); }, 'Запис видалено', 'trash');
        return;
      }
      case 'stat-toggle': {
        var cur = selectedIds(), at = cur.indexOf(id);
        if (at === -1) cur.push(id); else cur.splice(at, 1);
        ui.statIds = cur; renderWin(); return;
      }
      case 'stat-range': ui.range = Number(el.getAttribute('data-v')); renderWin(); return;

      // dreams
      case 'dview': ui.dview = ui.dview === 'trash' ? 'list' : (el.getAttribute('data-v') || 'list'); ui.dreamId = null; ui.confirm = null; render(); return;
      case 'dream-add': openDlg('dream'); return;
      case 'dream-open': openDream(id); return;
      case 'dream-back': dreamBack(); return;
      case 'dream-restore': run(function () { return updateDream(id, { deleted_at: null }); }, 'Мрію відновлено', 'restore'); return;
    }
    if (!d) return;
    switch (act) {
      case 'dream-edit': openDlg('dream', d.id); return;
      case 'dream-done':
        if (d.status === 'done') run(function () { return setStatus(d, stepsDone(d) ? 'progress' : 'dream'); });
        else run(function () { return setStatus(d, 'done'); }, 'Вітаю! Мрія здійснилась', 'star');
        return;
      case 'done-date-clear': run(function () { return updateDream(d.id, { done_on: null }); }); return;
      case 'dream-delete':
        if (ui.confirm !== 'dream') { ui.confirm = 'dream'; renderWin(); return; }
        ui.confirm = null;
        run(function () { return updateDream(d.id, { deleted_at: new Date().toISOString() }); }, 'Мрія в корзині на 2 дні', 'trash').then(function (ok) {
          if (ok) { if (history.state && history.state.d) history.back(); else { ui.dreamId = null; render(); } }
        });
        return;
      case 'steps-fold': ui.showDone = !ui.showDone; renderWin(); return;
      case 'step-open': openDlg('step', el.getAttribute('data-step')); return;
      case 'step-toggle': {
        var sid = el.getAttribute('data-step');
        el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
        run(function () { return saveSteps(d, mapStep(d, sid, function (s) { return { id: s.id, t: s.t, d: !s.d, n: s.n, s: s.s || [] }; })); });
        return;
      }
      case 'step-del': {
        var sd = el.getAttribute('data-step');
        if (ui.dlg) { if (!confirmTwice(el, 'step:' + sd)) return; closeDlg(); }
        else if (ui.confirm !== 'step:' + sd) { ui.confirm = 'step:' + sd; renderWin(); return; }
        ui.confirm = null;
        run(function () { return saveSteps(d, d.steps.filter(function (s) { return s.id !== sd; })); });
        return;
      }
      case 'sub-toggle': case 'sub-del': {
        var sid2 = ui.dlg && ui.dlg.id, sub = el.getAttribute('data-sub');
        run(function () {
          return saveSteps(d, mapStep(d, sid2, function (x) {
            var subs = act === 'sub-del' ? (x.s || []).filter(function (y) { return y.id !== sub; })
              : (x.s || []).map(function (y) { return y.id === sub ? { id: y.id, t: y.t, d: !y.d } : y; });
            return { id: x.id, t: x.t, d: x.d, n: x.n, s: subs };
          }));
        }).then(function () { repaintStepDlg(); });
        return;
      }
      case 'm-folder': ui.folder = m || null; renderWin(); return;
      case 'm-up': { var fu = ui.folder ? findFile(d, ui.folder) : null; ui.folder = fu ? fu.parent || null : null; renderWin(); return; }
      case 'm-upload': fFiles.click(); return;
      case 'm-note-new': openDlg('note', null); return;
      case 'm-note': openDlg('note', m); return;
      case 'm-folder-new': openDlg('folder'); return;
      case 'm-prop': openDlg('prop', m); return;
      case 'm-del':
        if (!confirmTwice(el, 'm:' + m)) return;
        closeDlg();
        run(function () { return deleteMaterial(d, m); }, 'Видалено', 'trash');
        return;
    }
  });
  // the step dialog stays open while its parts change; redraw it in place, keeping what is being typed
  function repaintStepDlg() {
    if (!ui.dlg || ui.dlg.type !== 'step') return;
    var keep = {};
    ['sub-input', 's-note', 's-title'].forEach(function (k) { var el = document.getElementById(k); if (el) keep[k] = el.value; });
    var focus = document.activeElement && document.activeElement.id;
    paintDlg(false);
    Object.keys(keep).forEach(function (k) { var el = document.getElementById(k); if (el) el.value = keep[k]; });
    if (focus) { var f = document.getElementById(focus); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ---------- forms ---------- */
  document.addEventListener('submit', function (e) {
    var f = e.target, id = f && f.id;
    if (!id) return;
    e.preventDefault();
    if (ui.busy) return;
    var d = curDream(), ok = document.getElementById('dlg-ok');
    function busyOk(on) { if (ok) ok.disabled = on; }
    if (id === 'f-water') {
      var pid = ui.dlg.id, date = document.getElementById('w-date').value || iso(today()), blob = photo.blob;
      if (date > iso(today())) return;
      busyOk(true);
      run(function () { return addWatering(pid, date, blob); }, 'Полив записано', 'drop').then(function (r) { if (r) closeDlg(); else busyOk(false); });
    } else if (id === 'f-plant') {
      var name = document.getElementById('p-name').value.trim(), n = Math.max(1, Math.min(365, parseInt(document.getElementById('p-int').value, 10) || 1));
      if (!name) return;
      var qid = ui.dlg.id;
      busyOk(true);
      run(function () { return savePlant(qid, name, n); }, qid ? 'Збережено' : 'Рослину додано', 'plant').then(function (r) { if (r) closeDlg(); else busyOk(false); });
    } else if (id === 'f-dream') {
      var title = document.getElementById('d-title').value.trim();
      if (!title) return;
      var did = ui.dlg.id, why = document.getElementById('d-why').value.trim(), ph = { blob: photo.blob, remove: photo.remove };
      busyOk(true);
      run(function () { return saveDream(did, { title: title, why: why }, ph); }, did ? 'Збережено' : 'Мрію додано', 'star').then(function (r) { if (r) closeDlg(); else busyOk(false); });
    } else if (id === 'step-form') {
      var inp = document.getElementById('step-input'), t = inp.value.trim();
      if (!t || !d) return;
      run(function () { return saveSteps(d, d.steps.concat([{ id: uuid(), t: t, d: false }])); }).then(function (r) {
        var i2 = document.getElementById('step-input'); if (r && i2) { i2.value = ''; i2.focus(); }
      });
    } else if (id === 'f-sub') {
      var si = document.getElementById('sub-input'), tt = si.value.trim(), sid = ui.dlg && ui.dlg.id;
      if (!tt || !d) return;
      si.value = '';
      run(function () { return saveSteps(d, mapStep(d, sid, function (x) { return { id: x.id, t: x.t, d: x.d, n: x.n, s: (x.s || []).concat([{ id: uuid(), t: tt, d: false }]) }; })); })
        .then(function (r) { repaintStepDlg(); var i3 = document.getElementById('sub-input'); if (i3) { if (!r) i3.value = tt; i3.focus(); } });
    } else if (id === 'f-note') {
      if (!d) return;
      var nt = document.getElementById('n-title').value.trim() || 'Без назви', nb = document.getElementById('n-body').value, nid = ui.dlg.id, par = ui.folder;
      busyOk(true);
      run(function () { return saveNote(d, nid, par, nt, nb); }, 'Нотатку збережено', 'note').then(function (r) { if (r) closeDlg(); else busyOk(false); });
    } else if (id === 'f-folder') {
      var fn = document.getElementById('fo-name').value.trim();
      if (!fn || !d) return;
      var fp = ui.folder;
      busyOk(true);
      run(function () { return addFolder(d, fp, fn); }, 'Папку створено', 'folder').then(function (r) { if (r) closeDlg(); else busyOk(false); });
    } else if (id === 'f-prop') {
      var pn = document.getElementById('pr-name').value.trim(), mid = ui.dlg.id;
      if (!pn || !d) return;
      busyOk(true);
      run(function () { return renameMaterial(mid, pn); }).then(function (r) { if (r) closeDlg(); else busyOk(false); });
    } else if (id === 'login-form') {
      doLogin();
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'p-int') paintPresets();
    else if (e.target.id === 'w-date') paintDays();
  });
  document.addEventListener('change', function (e) {
    var t = e.target, d = curDream();
    if (t.id === 'w-date') { paintDays(); return; }
    if (t.id === 'done-date') {
      if (!d || t.value > iso(today()) || (d.doneOn || '') === t.value) return;
      var v = t.value;
      run(function () { return updateDream(d.id, { done_on: v || null }); });
      return;
    }
    if (!d || !ui.dlg || ui.dlg.type !== 'step') return;
    var sid = ui.dlg.id;
    if (t.id === 's-title' || t.id === 's-note') {
      var val = t.value;
      if (t.id === 's-title' && !val.trim()) return;
      run(function () {
        return saveSteps(d, mapStep(d, sid, function (x) {
          return { id: x.id, t: t.id === 's-title' ? val.trim() : x.t, d: x.d, n: t.id === 's-note' ? val.trim() : x.n, s: x.s || [] };
        }));
      }).then(function () { var h = dlg.querySelector('#dlg-title'); if (h && t.id === 's-title') h.textContent = val.trim(); });
    } else if (t.classList.contains('sub-t')) {
      var sub = t.getAttribute('data-sub'), sv = t.value.trim();
      if (!sv) return;
      run(function () { return saveSteps(d, mapStep(d, sid, function (x) { return { id: x.id, t: x.t, d: x.d, n: x.n, s: (x.s || []).map(function (y) { return y.id === sub ? { id: y.id, t: sv, d: y.d } : y; }) }; })); });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (ui.dlg) closeDlg();
      else if (ui.menu) setMenu(false);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('fl-it')) {
      e.preventDefault(); openSection(e.target.getAttribute('data-section')); return;
    }
    if (ui.dlg && ui.dlg.type === 'gallery') {
      if (e.key === 'ArrowLeft') { e.preventDefault(); galStep(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); galStep(1); }
    }
  });
  // swipe the photo left or right
  (function () {
    var sx = null, sy = 0;
    document.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('#stage')) { sx = e.clientX; sy = e.clientY; } });
    document.addEventListener('pointerup', function (e) {
      if (sx === null) return;
      var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) galStep(dx < 0 ? 1 : -1);
    });
  })();
  // drop files from the computer onto the materials frame
  (function () {
    var depth = 0;
    function zone(e) { return e.target && e.target.closest ? e.target.closest('#mats') : null; }
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
    function mark(on) { var z = document.getElementById('mats'); if (z) z.classList.toggle('drag', on); }
    document.addEventListener('dragenter', function (e) { if (zone(e) && hasFiles(e)) { e.preventDefault(); depth++; mark(true); } });
    document.addEventListener('dragover', function (e) { if (zone(e) && hasFiles(e)) e.preventDefault(); });
    document.addEventListener('dragleave', function (e) { if (zone(e)) { depth = Math.max(0, depth - 1); if (!depth) mark(false); } });
    document.addEventListener('drop', function (e) {
      if (!zone(e) || !hasFiles(e)) return;
      e.preventDefault(); depth = 0; mark(false);
      uploadMaterials(Array.prototype.slice.call(e.dataTransfer.files));
    });
  })();
  // drag a step by its grip to put it elsewhere in the list
  (function () {
    var drag = null;
    document.addEventListener('pointerdown', function (e) {
      var g = e.target.closest && e.target.closest('[data-grip]');
      if (!g || drag || (e.button && e.button !== 0)) return;
      var li = g.closest('.st'), list = li && li.parentNode;
      if (!list || list.id !== 'steps') return;
      var rows = [].slice.call(list.children);
      if (rows.length < 2) return;
      e.preventDefault();
      drag = { li: li, rows: rows, from: rows.indexOf(li), to: rows.indexOf(li), y0: e.clientY, s0: pane.scrollTop,
        mids: rows.map(function (r) { var b = r.getBoundingClientRect(); return b.top + b.height / 2; }), h: li.getBoundingClientRect().height };
      li.classList.add('dragging');
      try { g.setPointerCapture(e.pointerId); } catch (x) {}
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = e.clientY - drag.y0 + (pane.scrollTop - drag.s0), c = drag.mids[drag.from] + dy, to = drag.from;
      for (var i = 0; i < drag.mids.length; i++) {
        if (i < drag.from && c < drag.mids[i]) { to = i; break; }
        if (i > drag.from && c > drag.mids[i]) to = i;
      }
      drag.to = to;
      drag.li.style.transform = 'translateY(' + dy + 'px)';
      drag.rows.forEach(function (r, i) {
        if (i === drag.from) return;
        var sh = (drag.from < to && i > drag.from && i <= to) ? -drag.h : (drag.from > to && i < drag.from && i >= to) ? drag.h : 0;
        r.style.transform = sh ? 'translateY(' + sh + 'px)' : '';
      });
    });
    function finish(cancel) {
      if (!drag) return;
      var dd = drag; drag = null;
      dd.rows.forEach(function (r) { r.style.transform = ''; });
      dd.li.classList.remove('dragging');
      var to = cancel ? dd.from : dd.to, d = curDream();
      if (to === dd.from || !d) return;
      var ids = dd.rows.map(function (r) { return r.getAttribute('data-sid'); });
      var moved = ids.splice(dd.from, 1)[0]; ids.splice(to, 0, moved);
      var byId = {}; d.steps.forEach(function (x) { byId[x.id] = x; });
      var next = ids.map(function (x) { return byId[x]; }).filter(Boolean).concat(d.steps.filter(function (x) { return x.d; }));
      if (next.length !== d.steps.length) return;
      // show the new order at once, then save it
      var list = dd.li.parentNode; ids.forEach(function (x) { var r = list.querySelector('[data-sid="' + x + '"]'); if (r) list.appendChild(r); });
      run(function () { return saveSteps(d, next); });
    }
    document.addEventListener('pointerup', function () { finish(false); });
    document.addEventListener('pointercancel', function () { finish(true); });
  })();

  var rz = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { if (ui.screen === 'plants' && ui.pview === 'diary' && !ui.min) drawScope(); }, 150);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') tickClock();
    if (document.visibilityState === 'visible' && session && !ui.busy && Date.now() - lastRefresh > 5 * 60 * 1000) refresh().catch(function (err) { console.error(err); });
  });
  // no pinch zoom, no double-tap zoom (iOS ignores the viewport setting)
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  var lastTouch = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouch < 300 && !(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  /* ---------- theme ---------- */
  var root = document.documentElement, mq = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() { var a = root.getAttribute('data-theme'); return a ? a === 'dark' : mq.matches; }
  function paintTheme() {
    var dark = isDark();
    trayTheme.innerHTML = I(dark ? 'sun' : 'moon');
    trayTheme.title = dark ? 'Світла тема' : 'Темна тема';
    trayTheme.setAttribute('aria-label', trayTheme.title);
    smTheme.innerHTML = I(dark ? 'sun' : 'moon');
    smTheme.title = trayTheme.title;
    smTheme.setAttribute('aria-label', trayTheme.title);
    paintBars();
  }
  function toggleTheme() {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    paintTheme();
  }
  try { var saved = localStorage.getItem(THEME_KEY); if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved); } catch (e) {}
  if (mq.addEventListener) mq.addEventListener('change', paintTheme);
  paintTheme();

  /* ---------- sign in ---------- */
  var logon = document.getElementById('logon'), osEl = document.getElementById('os');
  var lEmail = document.getElementById('l-email'), lPass = document.getElementById('l-pass'), lBtn = document.getElementById('login-btn'), lErr = document.getElementById('login-err');
  document.getElementById('lg-emblem').innerHTML = EMBLEM();
  document.getElementById('lg-tile').innerHTML = EMBLEM();
  try { lEmail.value = localStorage.getItem(EMAIL_KEY) || ''; } catch (e) {}

  function showLogin() {
    session = null;
    state = { plants: [], trash: [], dreams: [], dreamTrash: [] };
    ui.screen = 'home'; ui.loaded = false; ui.dreamId = null; ui.min = false;
    if (ui.dlg) closeDlg();
    setMenu(false);
    osEl.hidden = true;
    logon.hidden = false;
    paintBars();
  }
  async function doLogin() {
    lErr.hidden = true;
    lBtn.disabled = true;
    var r;
    try { r = await sb.auth.signInWithPassword({ email: lEmail.value.trim(), password: lPass.value }); } catch (err) { r = { error: err }; }
    lBtn.disabled = false;
    if (r.error) {
      lErr.textContent = /invalid login credentials/i.test(r.error.message || '') ? 'Неправильна пошта або пароль.' : 'Не вдалося увійти. Перевір інтернет.';
      lErr.hidden = false;
      return;
    }
    try { localStorage.setItem(EMAIL_KEY, lEmail.value.trim()); } catch (e) {}
    session = r.data.session;
    lPass.value = '';
    start();
  }
  async function start() {
    logon.hidden = true;
    osEl.hidden = false;
    ui.failed = false;
    render();
    try { await refresh(); }
    catch (e) { console.error(e); ui.failed = true; render(); }
  }
  sb.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') setTimeout(showLogin, 0); });

  sb.auth.getSession().then(function (r) {
    session = r.data && r.data.session;
    if (session) start(); else showLogin();
  }).catch(function (err) { console.error(err); showLogin(); });
})();
