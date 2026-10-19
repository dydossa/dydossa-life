/* dydossa life: the whole front end in one file.
   Data lives in Supabase (tables `items`, `entries`, private storage bucket `photos`).
   An "item" is anything you track; `section` says what kind (now only 'plants').
   Dreams have their own table `dreams` (see the dreams part below).
   An "entry" is one action on an item (a watering) with an optional photo. */
(function () {
  'use strict';

  var CFG = window.DYDOSSA_CONFIG;
  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  var SECTION = 'plants';
  var BUCKET = 'photos';
  var TRASH_MS = 48 * 3600 * 1000;
  var THEME_KEY = 'dydossa-life-theme';

  /* ---------- dates ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
  function today() { var d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  function diffDays(a, b) { return Math.round((a - b) / 86400000); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function fmtDate(s) {
    var d = parse(s);
    var o = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return new Intl.DateTimeFormat('uk-UA', o).format(d);
  }

  /* ---------- state ---------- */
  var state = { plants: [], trash: [], dreams: [], dreamTrash: [] };
  var ui = { screen: 'home', loaded: false, tab: 'plants', dreamTab: 'list', dreamFilter: 'all', dreamId: null, sheet: null, photo: null, photoUrl: null, confirm: null, statIds: null, range: 90, galIdx: null, busy: false };
  var session = null;
  var urlCache = {};
  var urlCacheAt = 0;
  var lastRefresh = 0;

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function freeSlot(plants) {
    var used = {};
    plants.forEach(function (p) { used[p.slot] = 1; });
    for (var i = 0; i < 8; i++) if (!used[i]) return i;
    return plants.length % 8;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function findPlant(id) { return state.plants.find(function (p) { return p.id === id; }); }
  function findAny(id) {
    var p = findPlant(id);
    if (p) return p;
    var t = state.trash.find(function (x) { return x.plant.id === id; });
    return t ? t.plant : null;
  }
  function color(p) { return 'var(--s' + ((p.slot % 8) + 1) + ')'; }
  function sortedLogs(p) {
    return p.logs.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.ts - a.ts; });
  }
  function ascLogs(p) {
    return p.logs.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts - b.ts; });
  }
  function lastDate(p) { var l = sortedLogs(p)[0]; return l ? l.date : null; }
  function photosOf(p) { return sortedLogs(p).filter(function (l) { return l.photo; }); }

  function status(p) {
    var last = lastDate(p);
    if (!last) return { warn: true, text: 'Потрібен перший полив', frac: 1, meta: 'ще не поливали', due: true };
    var left = diffDays(parse(addDays(last, p.interval)), today());
    var frac = Math.min(1, Math.max(0, diffDays(today(), parse(last)) / p.interval));
    var meta = 'останній полив ' + fmtDate(last);
    if (left < 0) return { warn: true, text: 'Прострочено на ' + (-left) + ' дн.', frac: 1, meta: meta, due: true };
    if (left === 0) return { warn: true, text: 'Полити сьогодні', frac: 1, meta: meta, due: true };
    return { warn: false, text: 'Через ' + left + ' дн.', frac: frac, meta: meta, due: false };
  }

  /* ---------- talking to Supabase ---------- */
  async function signPaths(paths) {
    if (!urlCacheAt || Date.now() - urlCacheAt > 5 * 3600 * 1000) { urlCache = {}; urlCacheAt = Date.now(); }
    var need = paths.filter(function (p) { return !urlCache[p]; });
    if (!need.length) return;
    var r = await sb.storage.from(BUCKET).createSignedUrls(need, 6 * 3600);
    if (r.error || !r.data) return;
    r.data.forEach(function (x) { if (x.signedUrl && x.path) urlCache[x.path] = x.signedUrl; });
  }

  async function destroyItem(p) {
    var paths = p.logs.map(function (l) { return l.path; }).filter(Boolean);
    if (paths.length) {
      var rm = await sb.storage.from(BUCKET).remove(paths);
      if (rm.error) throw rm.error;
    }
    var r = await sb.from('items').delete().eq('id', p.id);
    if (r.error) throw r.error;
  }

  async function fetchAll() {
    var ri = await sb.from('items')
      .select('id,name,interval_days,color_slot,deleted_at,created_at')
      .eq('section', SECTION)
      .order('created_at', { ascending: true });
    if (ri.error) throw ri.error;

    var entries = [];
    if (ri.data.length) {
      var re = await sb.from('entries')
        .select('id,item_id,entry_date,photo_path,created_at')
        .in('item_id', ri.data.map(function (i) { return i.id; }))
        .order('entry_date', { ascending: true });
      if (re.error) throw re.error;
      entries = re.data;
    }

    var byItem = {};
    entries.forEach(function (e) {
      (byItem[e.item_id] = byItem[e.item_id] || []).push({
        id: e.id, date: e.entry_date, path: e.photo_path, photo: null, ts: Date.parse(e.created_at) || 0
      });
    });

    var plants = [], trash = [];
    ri.data.forEach(function (it) {
      var p = { id: it.id, name: it.name, interval: it.interval_days, slot: it.color_slot, logs: byItem[it.id] || [] };
      if (it.deleted_at) trash.push({ plant: p, deletedAt: Date.parse(it.deleted_at) });
      else plants.push(p);
    });

    // anything older than 2 days in the trash is deleted for good
    var now = Date.now(), keep = [];
    for (var i = 0; i < trash.length; i++) {
      if (now - trash[i].deletedAt >= TRASH_MS) {
        try { await destroyItem(trash[i].plant); } catch (e) { console.error(e); keep.push(trash[i]); }
      } else keep.push(trash[i]);
    }
    trash = keep;

    var paths = [];
    plants.concat(trash.map(function (t) { return t.plant; })).forEach(function (p) {
      p.logs.forEach(function (l) { if (l.path) paths.push(l.path); });
    });
    await signPaths(paths);
    plants.concat(trash.map(function (t) { return t.plant; })).forEach(function (p) {
      p.logs.forEach(function (l) { l.photo = l.path ? (urlCache[l.path] || null) : null; });
    });

    state.plants = plants;
    state.trash = trash;
  }

  async function refresh() {
    await fetchAll();
    // dreams load separately so a problem there never hides the plants
    try { await fetchDreams(); } catch (e) { console.error(e); }
    lastRefresh = Date.now();
    ui.loaded = true;
    render();
  }

  async function addWatering(plantId, date, blob) {
    var path = null;
    if (blob) {
      path = session.user.id + '/' + uuid() + '.jpg';
      var up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
    }
    var r = await sb.from('entries').insert({ item_id: plantId, entry_date: date, photo_path: path });
    if (r.error) {
      if (path) await sb.storage.from(BUCKET).remove([path]);
      throw r.error;
    }
  }
  async function savePlant(id, name, n) {
    var r;
    if (id) r = await sb.from('items').update({ name: name, interval_days: n }).eq('id', id);
    else r = await sb.from('items').insert({ section: SECTION, name: name, interval_days: n, color_slot: freeSlot(state.plants) });
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
  async function purgePlant(id) {
    var t = state.trash.find(function (x) { return x.plant.id === id; });
    if (t) await destroyItem(t.plant);
  }
  async function deleteEntry(plantId, logId) {
    var p = findAny(plantId);
    var l = p && p.logs.find(function (x) { return x.id === logId; });
    if (l && l.path) await sb.storage.from(BUCKET).remove([l.path]);
    var r = await sb.from('entries').delete().eq('id', logId);
    if (r.error) throw r.error;
  }

  // run one change, reload the data, show a message
  async function run(fn, okMsg) {
    if (ui.busy) return false;
    ui.busy = true;
    try {
      await fn();
      await refresh();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      console.error(e);
      toast('Не вийшло. Перевір інтернет і спробуй ще раз.');
      return false;
    } finally {
      ui.busy = false;
    }
  }

  /* ---------- icons ---------- */
  var LEAF = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 29V15"/><path d="M16 17c-7 0-11-4-11-11 7 0 11 4 11 11z"/><path d="M16 21c0-5 3-9 10-9 0 6-3 9-10 9z"/></svg>';
  var DROP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3z"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  /* ---------- plants tab ---------- */
  var view = document.getElementById('view');
  var summary = document.getElementById('summary');

  function renderSummary() {
    var d = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    var due = state.plants.filter(function (p) { return status(p).due; }).length;
    var tail;
    if (!state.plants.length) tail = 'Додайте першу рослину.';
    else if (due === 0) tail = 'Сьогодні поливати нічого.';
    else tail = 'Потрібен полив: <span class="alert">' + due + ' з ' + state.plants.length + '</span>.';
    summary.innerHTML = '<strong>' + esc(d) + '</strong>. ' + tail;
  }

  function plantCard(p) {
    var s = status(p);
    var photos = photosOf(p);
    var cover = photos.length ? photos[0].photo : null;
    return '<article class="plant">' +
      '<button type="button" class="thumb" data-action="gallery" data-id="' + p.id + '" aria-label="Відкрити галерею: ' + esc(p.name) + '">' +
        (cover ? '<img src="' + esc(cover) + '" alt="">' : LEAF) +
        (photos.length ? '<span class="badge">' + photos.length + ' фото</span>' : '') +
      '</button>' +
      '<div class="plant-body">' +
        '<div class="plant-title"><h3><button type="button" class="title-btn" data-action="gallery" data-id="' + p.id + '">' + esc(p.name) + '</button></h3>' +
        '<button type="button" class="link-btn" data-action="edit" data-id="' + p.id + '">Змінити</button></div>' +
        '<p class="meta">Раз на ' + p.interval + ' дн. · ' + esc(s.meta) + '</p>' +
        '<span class="pill' + (s.warn ? ' warn' : '') + '">' + esc(s.text) + '</span>' +
        '<div class="bar' + (s.warn ? ' warn' : '') + '" aria-hidden="true"><i style="width:' + Math.round(s.frac * 100) + '%"></i></div>' +
        '<button type="button" class="primary" data-action="water" data-id="' + p.id + '">' + DROP + 'Полив</button>' +
      '</div></article>';
  }

  function renderPlants() {
    var html = '<div class="section-head"><h2>Рослини</h2></div><div style="height:12px"></div>';
    if (!state.plants.length) {
      html += '<div class="empty">Рослин поки немає.</div><div style="height:16px"></div>';
    } else {
      html += '<div class="grid">' + state.plants.map(plantCard).join('') + '</div><div style="height:16px"></div>';
    }
    html += '<button type="button" class="add-card" style="width:100%" data-action="add">+ Додати рослину</button>';
    view.innerHTML = html;
  }

  /* ---------- trash page ---------- */
  function trashHtml() {
    var head = '<div class="section-head"><h2>Корзина</h2><button type="button" class="link-btn" data-action="trash-back">← Назад</button></div>';
    if (!state.trash.length) return head + '<div style="height:12px"></div><div class="empty">Корзина порожня.</div>';
    var now = Date.now();
    var items = state.trash.slice().sort(function (a, b) { return b.deletedAt - a.deletedAt; }).map(function (t) {
      var hrs = Math.max(1, Math.ceil((TRASH_MS - (now - t.deletedAt)) / 3600000));
      var d = Math.floor(hrs / 24), h = hrs % 24;
      var left = ((d ? d + ' дн. ' : '') + (h ? h + ' год' : '')).trim();
      var key = 'trash:' + t.plant.id;
      var pics = photosOf(t.plant);
      return '<li class="trash-item">' +
        '<button type="button" class="trash-thumb" data-action="gallery" data-id="' + t.plant.id + '" aria-label="Фото: ' + esc(t.plant.name) + '">' +
          (pics.length ? '<img src="' + esc(pics[0].photo) + '" alt="">' : LEAF) + '</button>' +
        '<div class="trash-text"><strong>' + esc(t.plant.name) + '</strong>' +
        '<p class="meta">Зникне остаточно через ' + left + ' · записів: ' + t.plant.logs.length + '</p>' +
        (pics.length ? '<button type="button" class="link-btn" data-action="gallery" data-id="' + t.plant.id + '" style="padding-left:0">Усі фото (' + pics.length + ')</button>' : '') + '</div>' +
        '<div class="trash-actions"><button type="button" class="secondary" data-action="restore" data-id="' + t.plant.id + '">Відновити</button></div></li>';
    }).join('');
    return head +
      '<ul class="log-list">' + items + '</ul>';
  }

  /* ---------- diary tab: statistics ---------- */
  var RANGES = [{ v: 30, t: '30 днів' }, { v: 90, t: '90 днів' }, { v: 365, t: 'Рік' }, { v: 0, t: 'Усе' }];

  function selectedIds() {
    var all = state.plants.map(function (p) { return p.id; });
    if (!ui.statIds) return all;
    return ui.statIds.filter(function (id) { return all.indexOf(id) !== -1; });
  }
  function spanDays(ids) {
    if (ui.range) return ui.range;
    var min = null;
    ids.forEach(function (id) {
      var p = findPlant(id);
      p.logs.forEach(function (l) { if (!min || l.date < min) min = l.date; });
    });
    var days = min ? diffDays(today(), parse(min)) + 3 : 30;
    return Math.max(30, days);
  }
  function statsFor(p, startIso, tIso) {
    var asc = ascLogs(p), count = 0, gaps = [];
    asc.forEach(function (l, i) {
      if (l.date >= startIso && l.date <= tIso) {
        count++;
        if (i > 0) gaps.push(diffDays(parse(l.date), parse(asc[i - 1].date)));
      }
    });
    var avg = gaps.length ? gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length : null;
    return { count: count, avg: avg };
  }
  function fmtNum(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }

  function statsHtml() {
    var ids = selectedIds();
    var chips = state.plants.map(function (p) {
      var on = ids.indexOf(p.id) !== -1;
      return '<button type="button" class="chip" data-action="stat-toggle" data-id="' + p.id + '" aria-pressed="' + on + '">' +
        '<span class="swatch" style="background:' + color(p) + ';border-color:' + color(p) + '"></span>' + esc(p.name) + '</button>';
    }).join('');
    var seg = RANGES.map(function (r) {
      return '<button type="button" class="seg-btn" data-action="stat-range" data-range="' + r.v + '" aria-pressed="' + (ui.range === r.v) + '">' + r.t + '</button>';
    }).join('');

    var span = spanDays(ids), tIso = iso(today()), startIso = addDays(tIso, -span);
    var rows = ids.map(function (id) {
      var p = findPlant(id), s = statsFor(p, startIso, tIso);
      return '<tr><td><span class="swatch" style="background:' + color(p) + '"></span>' + esc(p.name) + '</td>' +
        '<td class="num">' + s.count + '</td>' +
        '<td class="num">' + (s.avg === null ? '—' : fmtNum(s.avg) + ' дн.') + '</td>' +
        '<td class="num">раз на ' + p.interval + ' дн.</td></tr>';
    }).join('');

    return '<div class="section-head"><h2>Статистика</h2></div>' +
      '<div class="stack">' +
        '<div class="filters"><div class="chips" role="group" aria-label="Рослини для порівняння">' + chips + '</div>' +
        '<div class="seg" role="group" aria-label="Період">' + seg + '</div></div>' +
        '<section class="chart-card"><p class="chart-cap">Кожна крапка — один полив. Число між крапками — скільки днів минуло між поливами.</p>' +
        '<div class="chart" id="chart"></div></section>' +
        (ids.length ? '<div class="tbl-wrap"><table class="stats"><thead><tr><th>Рослина</th><th>Поливів</th><th>Сер. інтервал</th><th>За планом</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
      '</div>';
  }

  function fmtTick(dateIso, span) {
    var d = parse(dateIso);
    if (span > 200) return new Intl.DateTimeFormat('uk-UA', { month: 'short', year: '2-digit' }).format(d);
    return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(d);
  }

  function drawChart() {
    var box = document.getElementById('chart');
    if (!box) return;
    var ids = selectedIds();
    if (!ids.length) { box.innerHTML = '<div class="empty">Оберіть хоча б одну рослину.</div>'; return; }
    var W = Math.max(280, Math.floor(box.clientWidth) || 320);
    var span = spanDays(ids), tIso = iso(today()), startIso = addDays(tIso, -span);
    var left = 10, right = 18, top = 6, laneH = 64, axisH = 30;
    var plotW = W - left - right;
    var H = top + ids.length * laneH + axisH;
    var gridBottom = top + ids.length * laneH;
    function X(d) { return left + (diffDays(parse(d), parse(startIso)) / span) * plotW; }

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="group" aria-label="Хронологія поливів">';
    var n = W < 420 ? 3 : 5, i, k;
    for (i = 0; i < n; i++) {
      var off = Math.round(span * i / (n - 1));
      var td = addDays(startIso, off);
      var tx = left + (off / span) * plotW;
      var anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      s += '<line class="grid-l" x1="' + tx + '" x2="' + tx + '" y1="' + top + '" y2="' + gridBottom + '"/>';
      s += '<text class="tick" x="' + tx + '" y="' + (gridBottom + 20) + '" text-anchor="' + anchor + '">' + esc(i === n - 1 ? 'сьогодні' : fmtTick(td, span)) + '</text>';
    }
    s += '<line class="axis-l" x1="' + left + '" x2="' + (W - right) + '" y1="' + gridBottom + '" y2="' + gridBottom + '"/>';

    var pts = [];
    ids.forEach(function (id, li) {
      var p = findPlant(id), c = color(p);
      var y0 = top + li * laneH, by = y0 + 46;
      s += '<circle cx="' + (left + 5) + '" cy="' + (y0 + 14) + '" r="5" style="fill:' + c + '"/>';
      s += '<text class="lane-lbl" x="' + (left + 16) + '" y="' + (y0 + 18) + '">' + esc(p.name) + '</text>';
      s += '<line class="grid-l" x1="' + left + '" x2="' + (W - right) + '" y1="' + by + '" y2="' + by + '"/>';
      var asc = ascLogs(p);
      var inRange = [];
      asc.forEach(function (l, idx) {
        if (l.date >= startIso && l.date <= tIso) {
          inRange.push({ l: l, gap: idx > 0 ? diffDays(parse(l.date), parse(asc[idx - 1].date)) : null });
        }
      });
      if (!inRange.length) {
        s += '<text class="none-lbl" x="' + left + '" y="' + (by - 10) + '">Немає поливів за цей період</text>';
      }
      for (k = 1; k < inRange.length; k++) {
        var x1 = X(inRange[k - 1].l.date), x2 = X(inRange[k].l.date);
        s += '<line x1="' + x1 + '" x2="' + x2 + '" y1="' + by + '" y2="' + by + '" stroke-width="2" stroke-linecap="round" style="stroke:' + c + '"/>';
        if (x2 - x1 >= 60) {
          s += '<text class="gap-lbl" x="' + ((x1 + x2) / 2) + '" y="' + (by - 9) + '" text-anchor="middle">' + inRange[k].gap + ' дн.</text>';
        }
      }
      inRange.forEach(function (e) {
        var cx = X(e.l.date);
        var idx = pts.length;
        pts.push({ plant: p, date: e.l.date, gap: e.gap, cx: cx, cy: by });
        s += '<g class="pt" tabindex="0" role="img" data-i="' + idx + '" aria-label="' + esc(p.name + ', ' + fmtDate(e.l.date) + (e.gap === null ? ', перший запис' : ', ' + e.gap + ' дн. після попереднього')) + '">' +
          '<circle class="dot" cx="' + cx + '" cy="' + by + '" r="5" style="fill:' + c + '"/>' +
          '<circle class="hit" cx="' + cx + '" cy="' + by + '" r="16" fill="transparent"/></g>';
      });
    });
    s += '</svg>';
    box.innerHTML = s;

    var tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    box.appendChild(tip);

    function hideAll() {
      tip.hidden = true;
      box.querySelectorAll('.dot').forEach(function (d) { d.setAttribute('r', 5); });
    }
    box.querySelectorAll('.pt').forEach(function (g) {
      var pt = pts[Number(g.getAttribute('data-i'))];
      function show() {
        hideAll();
        g.querySelector('.dot').setAttribute('r', 7);
        tip.textContent = '';
        var a = document.createElement('strong');
        a.textContent = fmtDate(pt.date);
        var b = document.createElement('div');
        var key = document.createElement('span');
        key.className = 'key';
        key.style.background = color(pt.plant);
        b.appendChild(key);
        b.appendChild(document.createTextNode(pt.plant.name));
        var c2 = document.createElement('div');
        c2.className = 'sub';
        c2.textContent = pt.gap === null ? 'Перший запис' : 'Через ' + pt.gap + ' дн. після попереднього';
        tip.appendChild(a); tip.appendChild(b); tip.appendChild(c2);
        tip.hidden = false;
        var tw = tip.offsetWidth;
        var lx = Math.min(W - tw / 2 - 4, Math.max(tw / 2 + 4, pt.cx));
        tip.style.left = lx + 'px';
        tip.style.top = (pt.cy - 4) + 'px';
      }
      g.addEventListener('pointerenter', show);
      g.addEventListener('pointerleave', hideAll);
      g.addEventListener('focus', show);
      g.addEventListener('blur', hideAll);
    });
    box.querySelector('svg').addEventListener('pointerdown', function (e) {
      if (!e.target.closest('.pt')) hideAll();
    });
  }

  function renderDiary() {
    var all = [];
    state.plants.forEach(function (p) {
      p.logs.forEach(function (l) { all.push({ p: p, l: l }); });
    });
    all.sort(function (a, b) { return a.l.date < b.l.date ? 1 : a.l.date > b.l.date ? -1 : b.l.ts - a.l.ts; });
    var html = statsHtml();
    html += '<div style="height:22px"></div><div class="section-head"><h2>Записи</h2></div><div style="height:12px"></div>';
    if (!all.length) {
      html += '<div class="empty">Записів поки немає. Натисніть «Полив» на картці рослини.</div>';
    } else {
      html += '<ul class="log-list">' + all.map(function (x) {
        var key = x.p.id + ':' + x.l.id;
        var asking = ui.confirm === key;
        return '<li class="log"><div class="lthumb">' + (x.l.photo ? '<img src="' + esc(x.l.photo) + '" alt="Фото поливу">' : DROP) + '</div>' +
          '<div><div class="row"><h3>' + esc(x.p.name) + '</h3>' +
          '<button type="button" class="link-btn" data-action="del-log" data-plant="' + x.p.id + '" data-log="' + x.l.id + '">' + (asking ? 'Підтвердити' : 'Видалити') + '</button></div>' +
          '<p class="when">' + esc(fmtDate(x.l.date)) + '</p>' +
          '</div></li>';
      }).join('') + '</ul>';
    }
    view.innerHTML = html;
    drawChart();
  }

  /* ---------- home: the list of sections ---------- */
  var plantsScreen = document.getElementById('plants-screen');
  var homeEl = document.getElementById('home');
  var homeBtn = document.getElementById('home-btn');
  var trashBtn = document.getElementById('trash-btn');
  var ICON_PLANT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21v-9"/><path d="M12 13c-5 0-8-3-8-8 5 0 8 3 8 8z"/><path d="M12 16c0-4 2-6 7-6 0 4-2 6-7 6z"/></svg>';
  var ICON_ANT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="14" r="2.5"/><circle cx="12" cy="13" r="2"/><circle cx="17.5" cy="11" r="2.5"/><path d="M6 12l-2-4M12 11l-1-4M17.5 8.5L16 5M19.5 9l2-2M4 16l-2 3M7 16l1 4M12 15l2 5M17 13.5l3 5"/></svg>';
  var ICON_PIANO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 19v-6M15 19v-6M8 5v8h2V5M14 5v8h2V5"/></svg>';
  var ICON_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  var SECTIONS = [
    { id: 'plants', title: 'Рослини', icon: ICON_PLANT, ready: true },
    { id: 'dreams', title: 'Мрії', icon: ICON_STAR, ready: true },
    { id: 'ants', title: 'Мурахи', icon: ICON_ANT, ready: false },
    { id: 'piano', title: 'Піаніно', icon: ICON_PIANO, ready: false }
  ];

  function plantsLine() {
    if (!ui.loaded) return '';
    if (!state.plants.length) return 'Ще немає рослин';
    var due = state.plants.filter(function (p) { return status(p).due; }).length;
    return due ? 'Потрібен полив: ' + due + ' з ' + state.plants.length : 'Сьогодні поливати нічого';
  }

  function renderHome() {
    var d = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    document.getElementById('home-date').innerHTML = '<strong>' + esc(d) + '</strong>';
    document.getElementById('tiles').innerHTML = SECTIONS.map(function (s) {
      var line = s.ready ? (s.id === 'plants' ? plantsLine() : s.id === 'dreams' ? dreamsLine() : '') : 'Скоро';
      var warn = s.ready && s.id === 'plants' && ui.loaded && state.plants.some(function (p) { return status(p).due; });
      return '<li><button type="button" class="tile" ' + (s.ready ? 'data-action="open-section" data-section="' + s.id + '"' : 'disabled') + '>' +
        '<span class="tile-icon">' + s.icon + '</span>' +
        '<span class="tile-text"><strong>' + esc(s.title) + '</strong>' +
        '<span class="tile-sub' + (warn ? ' warn' : '') + '">' + esc(line) + '</span></span>' +
        (s.ready ? '<svg class="tile-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' : '') +
        '</button></li>';
    }).join('');
  }

  function applyScreen() {
    var home = ui.screen === 'home';
    homeEl.hidden = !home;
    document.body.classList.toggle('on-home', home);
    document.body.classList.toggle('on-dreams', ui.screen === 'dreams');
    var cd = ui.screen === 'dreams' && ui.dreamId ? findDream(ui.dreamId) : null;
    if (cd) document.body.setAttribute('data-dt', cd.theme); else document.body.removeAttribute('data-dt');
    plantsScreen.hidden = ui.screen !== 'plants';
    dreamsScreen.hidden = ui.screen !== 'dreams';
    homeBtn.hidden = home;
    trashBtn.hidden = home;
  }

  function render() {
    applyScreen();
    if (ui.screen === 'home') { renderHome(); return; }
    var tc0 = document.getElementById('trash-count');
    if (ui.screen === 'dreams') {
      tc0.textContent = state.dreamTrash.length;
      tc0.hidden = !state.dreamTrash.length;
      trashBtn.setAttribute('aria-pressed', ui.dreamTab === 'trash' ? 'true' : 'false');
      dreamsSummary.hidden = !!ui.dreamId && ui.dreamTab !== 'trash';
      if (ui.dreamId && ui.dreamTab !== 'trash') renderDreamPage(); else renderDreams();
      return;
    }
    renderSummary();
    document.querySelectorAll('.tab').forEach(function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === ui.tab ? 'true' : 'false');
    });
    var tc = document.getElementById('trash-count');
    tc.textContent = state.trash.length;
    tc.hidden = !state.trash.length;
    document.getElementById('trash-btn').setAttribute('aria-pressed', ui.tab === 'trash' ? 'true' : 'false');
    if (ui.tab === 'plants') renderPlants();
    else if (ui.tab === 'diary') renderDiary();
    else view.innerHTML = trashHtml();
  }

  /* ---------- toast ---------- */
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3000);
  }

  /* ---------- sheet (dialog) ---------- */
  var overlay = document.getElementById('overlay');
  var sheetEl = overlay.querySelector('.sheet');
  var sheetTitle = document.getElementById('sheet-title');
  var waterForm = document.getElementById('water-form');
  var plantForm = document.getElementById('plant-form');
  var galleryEl = document.getElementById('gallery');
  var stepSheet = document.getElementById('step-sheet');
  var wDate = document.getElementById('w-date');
  var wCam = document.getElementById('w-cam');
  var wLib = document.getElementById('w-lib');
  var wClear = document.getElementById('w-clear');
  var wPreview = document.getElementById('w-preview');
  var wSubmit = document.getElementById('w-submit');
  var pName = document.getElementById('p-name');
  var pInterval = document.getElementById('p-interval');
  var pSubmit = document.getElementById('p-submit');
  var pDelete = document.getElementById('p-delete');

  function renderGallery() {
    var p = findAny(ui.sheet.id);
    var photos = photosOf(p);
    if (!photos.length) {
      galleryEl.innerHTML = '<div class="empty">Фото ще немає. Додайте його, коли записуватимете полив.</div>';
      return;
    }
    if (ui.galIdx !== null && photos[ui.galIdx]) {
      var l = photos[ui.galIdx];
      galleryEl.innerHTML = '<div class="gal-frame"><img class="gal-big" src="' + esc(l.photo) + '" alt="Фото від ' + esc(fmtDate(l.date)) + '">' +
        '<div class="gal-date">' + esc(fmtDate(l.date)) + '</div></div>' +
        '<div class="gal-nav"><button type="button" class="secondary" data-action="gal-back">Усі фото</button>' +
        '<span class="gal-count">' + (ui.galIdx + 1) + ' з ' + photos.length + '</span>' +
        '<span><button type="button" class="secondary" data-action="gal-step" data-d="-1"' + (ui.galIdx === 0 ? ' disabled' : '') + ' aria-label="Попереднє фото">←</button> ' +
        '<button type="button" class="secondary" data-action="gal-step" data-d="1"' + (ui.galIdx === photos.length - 1 ? ' disabled' : '') + ' aria-label="Наступне фото">→</button></span></div>';
      return;
    }
    galleryEl.innerHTML = '<div class="gal-grid">' + photos.map(function (x, i) {
      return '<button type="button" class="gal-item" data-action="gal-open" data-i="' + i + '" aria-label="Фото від ' + esc(fmtDate(x.date)) + '"><img src="' + esc(x.photo) + '" alt=""><span class="gal-date">' + esc(fmtDate(x.date)) + '</span></button>';
    }).join('') + '</div>';
  }

  function clearPhoto() {
    ui.photo = null;
    if (ui.photoUrl) { URL.revokeObjectURL(ui.photoUrl); ui.photoUrl = null; }
    wCam.value = '';
    wLib.value = '';
    wPreview.hidden = true;
    wPreview.removeAttribute('src');
    wClear.hidden = true;
  }

  function openSheet(type, id) {
    ui.sheet = { type: type, id: id || null };
    ui.confirm = null;
    ui.galIdx = null;
    waterForm.hidden = type !== 'water';
    plantForm.hidden = !(type === 'edit' || type === 'add');
    galleryEl.hidden = type !== 'gallery';
    dreamForm.hidden = !(type === 'dream-add' || type === 'dream-edit');
    stepSheet.hidden = type !== 'step';
    sheetEl.classList.toggle('wide', type === 'gallery');
    sheetEl.classList.toggle('side', type === 'step');
    overlay.classList.toggle('side', type === 'step');
    var first = null;
    if (type === 'water') {
      var p = findPlant(id);
      sheetTitle.textContent = 'Полив: ' + p.name;
      wDate.value = iso(today());
      wDate.max = iso(today());
      clearPhoto();
      wSubmit.disabled = false;
      wSubmit.textContent = 'Записати полив';
      first = wDate;
    } else if (type === 'edit') {
      var q = findPlant(id);
      sheetTitle.textContent = 'Змінити рослину';
      pName.value = q.name;
      pInterval.value = q.interval;
      pDelete.hidden = false;
      pDelete.textContent = 'Видалити рослину';
      pSubmit.disabled = false;
      first = pName;
    } else if (type === 'add') {
      sheetTitle.textContent = 'Нова рослина';
      pName.value = '';
      pInterval.value = 14;
      pDelete.hidden = true;
      pSubmit.disabled = false;
      first = pName;
    } else if (type === 'step') {
      sheetTitle.textContent = 'Крок';
      renderStepSheet();
      first = overlay.querySelector('[data-action="close"]');
    } else if (type === 'dream-add' || type === 'dream-edit') {
      var dd = type === 'dream-edit' ? findDream(id) : null;
      sheetTitle.textContent = dd ? 'Змінити мрію' : 'Нова мрія';
      fillDreamForm(dd);
      first = dTitle;
    } else {
      var g = findAny(id);
      sheetTitle.textContent = 'Фото: ' + g.name;
      renderGallery();
      first = overlay.querySelector('[data-action="close"]');
    }
    overlay.hidden = false;
    sheetEl.scrollTop = 0;
    setTimeout(function () { first.focus(); }, 0);
  }
  function closeSheet() {
    overlay.hidden = true;
    ui.sheet = null;
    ui.galIdx = null;
    clearPhoto();
    if (typeof dResetPhoto === 'function') dResetPhoto();
  }

  // shrink a picked photo in the browser so uploads stay small
  function fileToBlob(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
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
      if (ui.photoUrl) URL.revokeObjectURL(ui.photoUrl);
      ui.photo = blob;
      ui.photoUrl = URL.createObjectURL(blob);
      wPreview.src = ui.photoUrl;
      wPreview.hidden = false;
      wClear.hidden = false;
    }).catch(function () {
      clearPhoto();
      toast('Не вдалося прочитати це фото.');
    });
  }
  wCam.addEventListener('change', function () { onPick(wCam); });
  wLib.addEventListener('change', function () { onPick(wLib); });

  waterForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!ui.sheet || ui.busy) return;
    var id = ui.sheet.id, date = wDate.value || iso(today()), blob = ui.photo;
    wSubmit.disabled = true;
    wSubmit.textContent = 'Зберігаю…';
    var ok = await run(function () { return addWatering(id, date, blob); }, 'Полив записано');
    if (ok) closeSheet();
    else { wSubmit.disabled = false; wSubmit.textContent = 'Записати полив'; }
  });

  plantForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (ui.busy) return;
    var name = pName.value.trim();
    var n = Math.max(1, Math.min(365, parseInt(pInterval.value, 10) || 1));
    if (!name) return;
    var id = ui.sheet && ui.sheet.type === 'edit' ? ui.sheet.id : null;
    pSubmit.disabled = true;
    var ok = await run(function () { return savePlant(id, name, n); }, 'Збережено');
    if (ok) closeSheet();
    else pSubmit.disabled = false;
  });

  /* ---------- dreams ----------
     Table `dreams`: title, why, status (dream / progress / done), done_on, cover_path (one photo in
     the `photos` bucket), steps (a JSON list of {id, t: text, d: done}).
     Table `dream_files`: the dream's materials. Each row is a folder, a note (text in `body`) or a
     file (stored in the private `files` bucket); `parent_id` is the folder it sits in (empty = top).
     Deleting a dream puts it in the trash for 2 days, like plants. */
  var FILES_BUCKET = 'files';
  var FILE_MAX = 50 * 1024 * 1024;
  var STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var I_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  var I_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></svg>';
  var I_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>';
  var I_CLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg>';
  var I_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var I_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
  var I_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
  var I_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var I_MORE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  var I_PALETTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.4-1.2-1.5-1.2-2.7 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/></svg>';
  var I_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
  var DSTATUS = { dream: 'Мрію', progress: 'В процесі', done: 'Здійснено' };
  var DTHEMES = [
    { v: 'violet', t: 'Фіолетовий', c: '#7B5FCB' }, { v: 'rose', t: 'Рожевий', c: '#D0587E' },
    { v: 'ocean', t: 'Океан', c: '#3A82C4' }, { v: 'emerald', t: 'Смарагд', c: '#34986F' },
    { v: 'amber', t: 'Бурштин', c: '#D38A1C' }, { v: 'graphite', t: 'Графіт', c: '#6B7280' }
  ];
  var DORDER = { progress: 0, dream: 1, done: 2 };
  var DFILTERS = [{ v: 'all', t: 'Усі' }, { v: 'dream', t: 'Мрію' }, { v: 'progress', t: 'В процесі' }, { v: 'done', t: 'Здійснені' }];
  var dreamsView = document.getElementById('dreams-view');
  var dreamsSummary = document.getElementById('dreams-summary');
  var dreamsScreen = document.getElementById('dreams-screen');
  var fileUrls = {};

  function findDream(id) {
    return state.dreams.find(function (d) { return d.id === id; }) ||
      (state.dreamTrash.find(function (t) { return t.dream.id === id; }) || {}).dream || null;
  }
  function stepsDone(d) { return d.steps.filter(function (s) { return s.d; }).length; }
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
  function fmtStamp(ts) { return fmtDate(iso(new Date(ts))); }
  function filesOf(d) { return d.files || []; }
  function childrenOf(d, parent) {
    var rank = { folder: 0, note: 1, file: 2 };
    return filesOf(d).filter(function (f) { return (f.parent || null) === (parent || null); })
      .sort(function (a, b) { return rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name, 'uk'); });
  }
  // everything inside a folder, at any depth (the folder itself included)
  function subtree(d, id) {
    var out = [], queue = [id];
    while (queue.length) {
      var cur = queue.shift();
      filesOf(d).forEach(function (f) { if (f.id === cur) out.push(f); if (f.parent === cur) queue.push(f.id); });
    }
    return out;
  }
  function findFile(d, id) { return filesOf(d).find(function (f) { return f.id === id; }) || null; }

  async function fetchDreams() {
    var r = await sb.from('dreams')
      .select('id,title,why,status,theme,done_on,cover_path,steps,created_at,deleted_at')
      .order('created_at', { ascending: true });
    if (r.error) throw r.error;
    var rf = await sb.from('dream_files')
      .select('id,dream_id,parent_id,kind,name,body,path,mime,size,created_at,updated_at');
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
      var d = {
        id: x.id, title: x.title, why: x.why || '', status: x.status, theme: x.theme || 'violet', doneOn: x.done_on, path: x.cover_path, photo: null,
        steps: Array.isArray(x.steps) ? x.steps : [], files: byDream[x.id] || [], ts: Date.parse(x.created_at) || 0
      };
      if (!x.deleted_at) { list.push(d); continue; }
      var at = Date.parse(x.deleted_at);
      if (now - at >= TRASH_MS) {
        try { await destroyDream(d); } catch (e) { console.error(e); trash.push({ dream: d, deletedAt: at }); }
      } else trash.push({ dream: d, deletedAt: at });
    }
    var all = list.concat(trash.map(function (t) { return t.dream; }));
    await signPaths(all.map(function (d) { return d.path; }).filter(Boolean));
    all.forEach(function (d) { d.photo = d.path ? (urlCache[d.path] || null) : null; });
    // links for the files of active dreams, valid for 6 hours
    var fpaths = [];
    list.forEach(function (d) { d.files.forEach(function (f) { if (f.path && !fileUrls[f.path]) fpaths.push(f.path); }); });
    if (fpaths.length) {
      var su = await sb.storage.from(FILES_BUCKET).createSignedUrls(fpaths, 6 * 3600);
      if (!su.error && su.data) su.data.forEach(function (s) { if (s.signedUrl && s.path) fileUrls[s.path] = s.signedUrl; });
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
    if (d.path) {
      var rm = await sb.storage.from(BUCKET).remove([d.path]);
      if (rm.error) throw rm.error;
    }
    var r = await sb.from('dreams').delete().eq('id', d.id);
    if (r.error) throw r.error;
  }
  async function updateDream(id, patch) {
    var r = await sb.from('dreams').update(patch).eq('id', id);
    if (r.error) throw r.error;
  }
  // fields: { title, why }, photo: { blob } to set a new photo, { remove: true } to drop it
  async function saveDream(id, fields, photo) {
    var old = id ? findDream(id) : null;
    var row = { title: fields.title, why: fields.why, theme: fields.theme };
    var newPath = null;
    if (photo.blob) { newPath = await uploadPhoto(photo.blob); row.cover_path = newPath; }
    else if (photo.remove) row.cover_path = null;
    var r = id ? await sb.from('dreams').update(row).eq('id', id) : await sb.from('dreams').insert(row);
    if (r.error) {
      if (newPath) await sb.storage.from(BUCKET).remove([newPath]);
      throw r.error;
    }
    if (old && old.path && (newPath || photo.remove)) await sb.storage.from(BUCKET).remove([old.path]);
  }
  function setStatus(d, st) {
    return updateDream(d.id, { status: st, done_on: st === 'done' ? (d.doneOn || null) : null });
  }
  function saveSteps(d, steps) {
    var patch = { steps: steps };
    // ticking the first step moves a dream into "in progress"
    if (d.status === 'dream' && steps.some(function (s) { return s.d; })) patch.status = 'progress';
    return updateDream(d.id, patch);
  }
  // materials
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
      var r = await sb.from('dream_files').insert({
        dream_id: d.id, parent_id: parent, kind: 'file', name: f.name.slice(0, 120) || 'файл', path: path, mime: f.type || '', size: f.size
      });
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

  function dreamCard(d) {
    var n = d.steps.length, k = stepsDone(d), m = filesOf(d).filter(function (f) { return f.kind !== 'folder'; }).length;
    var pill = d.status === 'done'
      ? '<span class="pill done">' + STAR + 'Здійснено' + (d.doneOn ? ' ' + esc(fmtDate(d.doneOn)) : '') + '</span>'
      : '';
    return '<article class="plant dream' + (d.status === 'done' ? ' is-done' : '') + '" data-dt="' + d.theme + '">' +
      '<button type="button" class="thumb" data-action="dream-open" data-id="' + d.id + '" aria-label="Відкрити мрію: ' + esc(d.title) + '">' +
        (d.photo ? '<img src="' + esc(d.photo) + '" alt="">' : STAR) + '</button>' +
      '<div class="plant-body">' +
        '<h3 class="dream-title"><button type="button" class="title-btn" data-action="dream-open" data-id="' + d.id + '">' + esc(d.title) + '</button></h3>' +
        (pill || '') +
        (n ? '<div class="dream-progress"><div class="bar" aria-hidden="true"><i style="width:' + Math.round(k / n * 100) + '%"></i></div>' +
          '<span class="meta">' + k + ' з ' + n + ' ' + plural(n, 'кроку', 'кроків', 'кроків') + '</span></div>' : '') +
        (m ? '<p class="meta">' + m + ' ' + plural(m, 'матеріал', 'матеріали', 'матеріалів') + '</p>' : '') +
      '</div></article>';
  }

  function dreamsTrashHtml() {
    var head = '<div class="section-head"><h2>Корзина</h2><button type="button" class="link-btn" data-action="trash-back">← Назад</button></div><div style="height:12px"></div>';
    if (!state.dreamTrash.length) return head + '<div class="empty">Корзина порожня.</div>';
    var now = Date.now();
    return head + '<ul class="log-list">' + state.dreamTrash.slice().sort(function (a, b) { return b.deletedAt - a.deletedAt; }).map(function (t) {
      var hrs = Math.max(1, Math.ceil((TRASH_MS - (now - t.deletedAt)) / 3600000));
      var dd = Math.floor(hrs / 24), hh = hrs % 24;
      var left = ((dd ? dd + ' дн. ' : '') + (hh ? hh + ' год' : '')).trim();
      return '<li class="trash-item"><span class="trash-thumb">' + (t.dream.photo ? '<img src="' + esc(t.dream.photo) + '" alt="">' : STAR) + '</span>' +
        '<div class="trash-text"><strong>' + esc(t.dream.title) + '</strong><p class="meta">Зникне через ' + left + '</p></div>' +
        '<div class="trash-actions"><button type="button" class="secondary" data-action="dream-restore" data-id="' + t.dream.id + '">Відновити</button></div></li>';
    }).join('') + '</ul>';
  }

  function renderDreams() {
    var total = state.dreams.length, done = state.dreams.filter(function (d) { return d.status === 'done'; }).length;
    dreamsSummary.innerHTML = total
      ? '<strong>' + total + ' ' + plural(total, 'мрія', 'мрії', 'мрій') + '</strong>' + (done ? ', здійснено ' + done : '') + '.'
      : '';
    if (ui.dreamTab === 'trash') { dreamsView.innerHTML = dreamsTrashHtml(); return; }
    var list = state.dreams.filter(function (d) { return true; })
      .sort(function (a, b) { return DORDER[a.status] - DORDER[b.status] || a.ts - b.ts; });
    var html = '<div class="section-head"><h2>Мрії</h2></div><div style="height:12px"></div>';
    if (!total) html += '<div class="empty">Мрій поки немає.</div><div style="height:16px"></div>';
    else if (!list.length) html += '<div class="empty">Тут поки порожньо.</div><div style="height:16px"></div>';
    else {
      var cur = list.filter(function (d) { return d.status !== 'done'; }), fin = list.filter(function (d) { return d.status === 'done'; });
      html += '<div class="grid">' + cur.map(dreamCard).join('') + '<button type="button" class="add-card dream-add" data-action="dream-add">+ Нова мрія</button></div>';
      if (fin.length) html += '<div style="height:28px"></div><div class="section-head"><h2>Здійснені</h2></div><div style="height:12px"></div><div class="grid">' + fin.map(dreamCard).join('') + '</div>';
    }
    if (!total) html += '<button type="button" class="add-card" style="width:100%" data-action="dream-add">+ Нова мрія</button>';
    dreamsView.innerHTML = html;
  }

  function dreamsLine() {
    if (!ui.loaded) return '';
    var total = state.dreams.length;
    if (!total) return 'Ще немає мрій';
    var done = state.dreams.filter(function (d) { return d.status === 'done'; }).length;
    return total + ' ' + plural(total, 'мрія', 'мрії', 'мрій') + (done ? ' · здійснено ' + done : '');
  }

  /* dream sheet: the detail view (steps / materials) and the add/edit form */
  var dreamForm = document.getElementById('dream-form');
  var dTitle = document.getElementById('d-title');
  var dWhy = document.getElementById('d-why');
  var dCam = document.getElementById('d-cam');
  var dLib = document.getElementById('d-lib');
  var dPreview = document.getElementById('d-preview');
  var dClear = document.getElementById('d-clear');
  var dSubmit = document.getElementById('d-submit');
  var mFiles = document.getElementById('m-files');
  var dPhoto = { blob: null, url: null, remove: false };
  var dTheme = 'violet';
  var dThemesEl = document.getElementById('d-themes');
  function swatches(cur, act) {
    return DTHEMES.map(function (t) {
      return '<button type="button" class="sw" data-action="' + act + '" data-v="' + t.v + '" style="--c:' + t.c + '" role="radio" aria-checked="' + (cur === t.v) + '" aria-label="' + t.t + '"></button>';
    }).join('');
  }
  function paintThemeForm() { dThemesEl.innerHTML = swatches(dTheme, 'd-theme'); }
  // what the detail view shows: tab 'steps' or 'files', the open folder, an open note ('new' for a new one),
  // and which inline form is open ('folder' or 'rename:<id>')
  var dv = { folder: null, note: null, inline: null, add: false, menu: null, drag: false, pal: false, step: null };

  function dSetPreview(src) {
    dPreview.hidden = !src;
    if (src) dPreview.src = src; else dPreview.removeAttribute('src');
    dClear.hidden = !src;
  }
  function dResetPhoto() {
    if (dPhoto.url) URL.revokeObjectURL(dPhoto.url);
    dPhoto = { blob: null, url: null, remove: false };
    dCam.value = ''; dLib.value = '';
  }
  function dOnPick(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    fileToBlob(f, 1600).then(function (blob) {
      if (dPhoto.url) URL.revokeObjectURL(dPhoto.url);
      dPhoto = { blob: blob, url: URL.createObjectURL(blob), remove: false };
      dSetPreview(dPhoto.url);
    }).catch(function () { toast('Не вдалося прочитати це фото.'); });
  }
  dCam.addEventListener('change', function () { dOnPick(dCam); });
  dLib.addEventListener('change', function () { dOnPick(dLib); });
  mFiles.addEventListener('change', function () {
    var files = Array.prototype.slice.call(mFiles.files || []);
    mFiles.value = '';
    uploadMaterials(files);
  });
  function uploadMaterials(files) {
    var d = curDream();
    if (!d || !files.length || ui.busy) return;
    var big = files.filter(function (f) { return f.size > FILE_MAX; });
    if (big.length) { toast('Файл більший за 50 МБ: ' + big[0].name); return; }
    var parent = dv.folder;
    toast(files.length > 1 ? 'Завантажую ' + files.length + ' файли…' : 'Завантажую файл…');
    run(function () { return addFiles(d, parent, files); }, files.length > 1 ? 'Файли додано' : 'Файл додано');
  }

  function fillDreamForm(d) {
    dResetPhoto();
    dTitle.value = d ? d.title : '';
    dWhy.value = d ? d.why : '';
    dTheme = d ? d.theme : 'violet';
    paintThemeForm();
    dSetPreview(d && d.photo ? d.photo : null);
    dSubmit.disabled = false;
    dSubmit.textContent = d ? 'Зберегти' : 'Додати мрію';
  }

  function stepsHtml(d) {
    var n = d.steps.length, k = stepsDone(d);
    // open steps first in the order they were added, finished ones go to the bottom
    var ordered = d.steps.filter(function (s) { return !s.d; }).concat(d.steps.filter(function (s) { return s.d; }));
    var html = '<div class="dream-steps"><div class="dsec-head"><h3>Кроки</h3>' + (n ? '<span class="meta">виконано ' + k + ' з ' + n + '</span>' : '') + '</div>';
    if (n) html += '<div class="bar" aria-hidden="true"><i style="width:' + Math.round(k / n * 100) + '%"></i></div>';
    html += '<form id="step-form" class="step-add"><input type="text" id="step-input" maxlength="140" placeholder="Новий крок" autocomplete="off" aria-label="Новий крок">' +
      '<button type="submit" class="secondary">Додати</button></form>';
    html += '<ul class="steps" id="steps-list">' + ordered.map(function (st) {
      var subs = st.s || [], key = 'step:' + st.id;
      var row = '<div class="step-row">' +
        (st.d ? '<span class="grip off"></span>' : '<span class="grip" data-grip aria-hidden="true">' + I_GRIP + '</span>') +
        '<button type="button" class="check" role="checkbox" aria-checked="' + !!st.d + '" data-action="step-toggle" data-step="' + esc(st.id) + '" aria-label="' + esc(st.t) + '">' + CHECK + '</button>' +
        '<button type="button" class="step-t" data-action="step-edit" data-step="' + esc(st.id) + '">' + esc(st.t) + '</button>' +
        '<button type="button" class="ico" data-action="step-edit" data-step="' + esc(st.id) + '" aria-label="Редагувати">' + I_EDIT + '</button>' +
        (ui.confirm === key
          ? '<button type="button" class="ico sure" data-action="step-del" data-step="' + esc(st.id) + '">Видалити?</button>'
          : '<button type="button" class="ico" data-action="step-del" data-step="' + esc(st.id) + '" aria-label="Прибрати">' + I_X + '</button>') +
        '</div>';
      var body = '';
      if (st.n || subs.length) {
        var sd = subs.filter(function (x) { return x.d; }).length;
        body = '<button type="button" class="step-sub" data-action="step-edit" data-step="' + esc(st.id) + '">' +
          (subs.length ? '<span>' + sd + ' з ' + subs.length + ' ' + plural(subs.length, 'підкроку', 'підкроків', 'підкроків') + '</span>' : '') +
          (st.n ? '<span class="n">' + esc(st.n) + '</span>' : '') + '</button>';
      }
      return '<li class="step' + (st.d ? ' is-done' : '') + '" data-sid="' + esc(st.id) + '">' + row + body + '</li>';
    }).join('') + '</ul>';
    return html + '</div>';
  }

  function noteHtml(d) {
    var note = dv.note === 'new' ? null : findFile(d, dv.note);
    return '<form id="note-form" class="note-form">' +
      '<button type="button" class="link-btn back" data-action="m-back">' + I_BACK + 'До матеріалів</button>' +
      '<input type="text" id="note-title" maxlength="120" required placeholder="Назва нотатки" value="' + esc(note ? note.name : '') + '" aria-label="Назва нотатки">' +
      '<textarea id="note-body" rows="12" maxlength="20000" placeholder="Текст нотатки" aria-label="Текст нотатки">' + esc(note ? note.body : '') + '</textarea>' +
      '<div class="actions"><button type="submit" class="primary">Зберегти нотатку</button>' +
      (note ? '<button type="button" class="danger" data-action="m-del" data-m="' + note.id + '">' + (ui.confirm === 'm:' + note.id ? 'Точно видалити?' : 'Видалити') + '</button>' : '') +
      '</div></form>';
  }

  function filesHtml(d) {
    if (dv.note) return noteHtml(d);
    var trail = [], cur = dv.folder ? findFile(d, dv.folder) : null;
    if (dv.folder && !cur) dv.folder = null;
    while (cur) { trail.unshift(cur); cur = cur.parent ? findFile(d, cur.parent) : null; }
    var here = trail.length ? trail[trail.length - 1] : null;
    var up = here ? (here.parent || '') : null;
    var upName = here && here.parent ? (findFile(d, here.parent) || {}).name : 'Усі матеріали';
    var html;
    if (here) {
      // inside a folder: a back button, the folder's name and size, and the add button
      var cnt = childrenOf(d, here.id).length;
      html = '<div class="fhead"><button type="button" class="fback" data-action="m-folder" data-m="' + up + '" aria-label="Назад: ' + esc(upName) + '">' + I_BACK + '</button>' +
        '<span class="fhead-icon">' + I_FOLDER + '</span>' +
        '<div class="fhead-text"><h3>' + esc(here.name) + '</h3><span class="meta">' + (cnt ? cnt + ' ' + plural(cnt, 'елемент', 'елементи', 'елементів') : 'порожня') + ' · у «' + esc(upName) + '»</span></div>' +
        '<button type="button" class="add-btn" data-action="m-add" aria-expanded="' + dv.add + '">' + I_PLUS + 'Додати</button></div>';
    } else {
      html = '<div class="dsec-head"><h3>Матеріали</h3>' +
        '<button type="button" class="add-btn" data-action="m-add" aria-expanded="' + dv.add + '">' + I_PLUS + 'Додати</button></div>';
    }
    if (dv.add) {
      html += '<div class="add-menu">' +
        '<button type="button" data-action="m-new-file"><span class="ai clip">' + I_CLIP + '</span><span><strong>Файл</strong><small>фото, документ, будь-що</small></span></button>' +
        '<button type="button" data-action="m-new-note"><span class="ai">' + I_NOTE + '</span><span><strong>Нотатка</strong><small>написати текст</small></span></button>' +
        '<button type="button" data-action="m-new-folder"><span class="ai">' + I_FOLDER + '</span><span><strong>Папка</strong><small>щоб розкласти по місцях</small></span></button></div>';
    }
    if (dv.inline === 'folder') {
      html += '<form id="folder-form" class="step-add"><input type="text" id="folder-input" maxlength="120" placeholder="Назва папки" autocomplete="off" aria-label="Назва папки">' +
        '<button type="submit" class="secondary">Створити</button><button type="button" class="link-btn" data-action="m-cancel">Скасувати</button></form>';
    }
    var items = childrenOf(d, dv.folder);
    if (!items.length) {
      html += '<button type="button" class="drop-empty" data-action="m-new-file">' + I_CLIP +
        '<strong>' + (dv.folder ? 'Папка порожня' : 'Поки нічого немає') + '</strong>' +
        '<span>' + (isTouch ? 'Натисни, щоб додати' : 'Натисни або перетягни файл сюди') + '</span></button>';
      return html;
    }
    html += '<ul class="m-grid">' + items.map(function (f) {
      var key = 'm:' + f.id;
      var url = f.path ? fileUrls[f.path] : null;
      var isImg = f.kind === 'file' && /^image\//.test(f.mime) && url;
      var pv, meta;
      if (f.kind === 'folder') {
        var c = childrenOf(d, f.id).length;
        meta = c ? c + ' ' + plural(c, 'елемент', 'елементи', 'елементів') : 'порожня';
        pv = '<span class="m-pv pv-folder">' + I_FOLDER + '</span>';
      } else if (f.kind === 'note') {
        meta = esc(fmtStamp(f.ts));
        pv = '<span class="m-pv pv-note"><span>' + (f.body ? esc(f.body.slice(0, 140)) : '') + '</span></span>';
      } else {
        meta = fmtSize(f.size);
        var ext = ((f.name.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || '').toUpperCase();
        pv = isImg ? '<span class="m-pv pv-img"><img src="' + esc(url) + '" alt="" loading="lazy"></span>'
          : '<span class="m-pv pv-file">' + I_FILE + (ext ? '<b>' + esc(ext) + '</b>' : '') + '</span>';
      }
      var label = '<span class="m-name"><strong>' + esc(f.name) + '</strong><span class="meta">' + meta + '</span></span>';
      var body;
      if (dv.inline === 'rename:' + f.id) {
        body = pv + '<form id="rename-form" class="m-rename" data-m="' + f.id + '"><input type="text" id="rename-input" maxlength="120" value="' + esc(f.name) + '" aria-label="Нова назва">' +
          '<button type="submit" class="secondary">OK</button></form>';
      } else if (f.kind === 'file') {
        body = '<a class="m-open" href="' + esc(url || '#') + '" target="_blank" rel="noopener">' + pv + label + '</a>';
      } else {
        body = '<button type="button" class="m-open" data-action="' + (f.kind === 'folder' ? 'm-folder' : 'm-note') + '" data-m="' + f.id + '">' + pv + label + '</button>';
      }
      var open = dv.menu === f.id;
      return '<li class="m-tile' + (open ? ' open' : '') + '">' + body +
        '<button type="button" class="more" data-action="m-menu" data-m="' + f.id + '" aria-label="Дії" aria-expanded="' + open + '">' + I_MORE + '</button>' +
        (open ? '<div class="m-menu">' +
          (f.kind !== 'note' ? '<button type="button" class="secondary" data-action="m-rename" data-m="' + f.id + '">Перейменувати</button>' : '') +
          '<button type="button" class="danger" data-action="m-del" data-m="' + f.id + '">' + (ui.confirm === key ? 'Точно?' : 'Видалити') + '</button></div>' : '') +
        '</li>';
    }).join('') + '</ul>';
    return html;
  }

  function renderStepSheet() {
    var d = curDream(), st = d && ui.sheet && ui.sheet.type === 'step' ? d.steps.filter(function (x) { return x.id === ui.sheet.id; })[0] : null;
    if (!st) { if (ui.sheet && ui.sheet.type === 'step') closeSheet(); return; }
    var keep = {};
    ['step-title', 'step-note', 'sub-input'].forEach(function (k) { var el = document.getElementById(k); if (el && stepSheet.contains(el)) keep[k] = el.value; });
    var focusId = document.activeElement && stepSheet.contains(document.activeElement) ? document.activeElement.id : null;
    var subs = st.s || [], key = 'step:' + st.id;
    stepSheet.innerHTML =
      '<div class="td-card td-title' + (st.d ? ' is-done' : '') + '">' +
        '<button type="button" class="check" role="checkbox" aria-checked="' + !!st.d + '" data-action="step-toggle" data-step="' + esc(st.id) + '" aria-label="Виконано">' + CHECK + '</button>' +
        '<input type="text" id="step-title" maxlength="140" value="' + esc(st.t) + '" aria-label="Назва кроку"></div>' +
      '<div class="td-card">' +
        '<ul class="subs">' + subs.map(function (x) {
          return '<li class="sub' + (x.d ? ' is-done' : '') + '"><button type="button" class="check sm" role="checkbox" aria-checked="' + !!x.d + '" data-action="sub-toggle" data-step="' + esc(st.id) + '" data-sub="' + esc(x.id) + '" aria-label="Виконано">' + CHECK + '</button>' +
            '<input type="text" class="sub-t" data-step="' + esc(st.id) + '" data-sub="' + esc(x.id) + '" maxlength="140" value="' + esc(x.t) + '" aria-label="Підкрок">' +
            '<button type="button" class="ico" data-action="sub-del" data-step="' + esc(st.id) + '" data-sub="' + esc(x.id) + '" aria-label="Прибрати">' + I_X + '</button></li>';
        }).join('') + '</ul>' +
        '<form class="sub-form td-add" data-step="' + esc(st.id) + '"><span class="td-plus">' + I_PLUS + '</span>' +
        '<input type="text" id="sub-input" maxlength="140" placeholder="Додати підкрок" autocomplete="off" enterkeyhint="done" aria-label="Додати підкрок">' +
        '<button type="submit" class="td-go" aria-label="Додати">' + CHECK + '</button></form></div>' +
      '<div class="td-card"><textarea id="step-note" rows="4" maxlength="2000" placeholder="Додати нотатку" aria-label="Нотатка">' + esc(st.n || '') + '</textarea></div>' +
      '<button type="button" class="danger" data-action="step-del" data-step="' + esc(st.id) + '">' + (ui.confirm === key ? 'Точно видалити?' : 'Видалити крок') + '</button>';
    Object.keys(keep).forEach(function (k) { var el = document.getElementById(k); if (el) el.value = keep[k]; });
    if (focusId) { var fe = document.getElementById(focusId); if (fe) fe.focus({ preventScroll: true }); }
  }

  function curDream() { return ui.dreamId ? findDream(ui.dreamId) : null; }

  // a dream's own page: a big cover with the title, a few numbers, why, the "came true" part,
  // then the steps and the materials
  function renderDreamPage() {
    var d = curDream();
    if (!d) { ui.dreamId = null; renderDreams(); return; }
    var nSteps = d.steps.length, k = stepsDone(d);
    var nFiles = filesOf(d).filter(function (f) { return f.kind !== 'folder'; }).length;
    var badge = d.status === 'done'
      ? STAR + 'Здійснено' + (d.doneOn ? ' ' + esc(fmtDate(d.doneOn)) : '')
      : '';
    var pct = d.status === 'done' ? 100 : (nSteps ? Math.round(k / nSteps * 100) : 0);
    var nextStep = d.steps.filter(function (x) { return !x.d; })[0];
    var html = '<div class="dpage">' +
      '<button type="button" class="dback" data-action="dream-back">' + I_BACK + 'Усі мрії</button>' +
      '<div class="dlayout"><aside class="dside">' +
      '<header class="dhero' + (d.photo ? ' has-photo' : '') + '">' +
        (d.photo ? '<img src="' + esc(d.photo) + '" alt="">' : '<span class="dhero-star">' + STAR + '</span>') +
        '<button type="button" class="dpal" data-action="dream-pal" aria-label="Колір сторінки" aria-expanded="' + dv.pal + '">' + I_PALETTE + '</button>' +
        '<div class="dhero-text">' + (badge ? '<span class="dhero-badge done">' + badge + '</span>' : '') +
        '<h2>' + esc(d.title) + '</h2></div>' +
      '</header>';
    if (dv.pal) html += '<div class="palette" role="radiogroup" aria-label="Колір сторінки">' + swatches(d.theme, 'dream-theme') + '</div>';
    html += '<section class="dprog"><div class="ring" style="--p:' + pct + '"><span>' + pct + '%</span></div><div class="dprog-text">' +
      (d.status === 'done' ? '<small>Здійснено</small><strong>Мрія здійснилась!</strong>'
        : nextStep ? '<small>Наступний крок</small><strong>' + esc(nextStep.t) + '</strong>'
        : '<small>' + (nSteps ? 'Усі кроки виконано' : 'Кроків ще немає') + '</small><strong>' + (nSteps ? 'Можна святкувати' : 'Додай перший крок') + '</strong>') +
      '</div>' + (d.status !== 'done' && nextStep ? '<button type="button" class="dprog-go" data-action="step-toggle" data-step="' + esc(nextStep.id) + '" aria-label="Виконано: ' + esc(nextStep.t) + '">' + CHECK + '</button>' : '') + '</section>';
    html += '<div class="dstats">' +
      '<div class="dstat"><strong>' + (nSteps ? k + '/' + nSteps : '0') + '</strong><span>' + (nSteps ? 'кроків виконано' : 'кроків') + '</span></div>' +
      '<div class="dstat"><strong>' + nFiles + '</strong><span>' + plural(nFiles, 'матеріал', 'матеріали', 'матеріалів') + '</span></div>' +
      '<div class="dstat"><strong>' + Math.max(1, Math.round((Date.now() - d.ts) / 86400000)) + '</strong><span>' + plural(Math.max(1, Math.round((Date.now() - d.ts) / 86400000)), 'день', 'дні', 'днів') + ' з мрією</span></div>' +
      '</div>';
    if (d.why) html += '<blockquote class="dwhy"><span>Чому я цього хочу</span><p>' + esc(d.why) + '</p></blockquote>';
    if (d.status === 'done') {
      html += '<div class="ddone">' + STAR + '<div class="ddone-text"><strong>Мрія здійснилась!</strong>' +
        '<label for="done-date">Дата <span class="opt">(за бажанням)</span></label><span class="date-row"><input type="date" id="done-date" value="' + esc(d.doneOn || '') + '" max="' + iso(today()) + '">' +
        (d.doneOn ? '<button type="button" class="ico" data-action="done-date-clear" aria-label="Прибрати дату">' + I_X + '</button>' : '') + '</span></div>' +
        '<button type="button" class="link-btn" data-action="dream-undone">Ще не здійснилась</button></div>';
    } else {
      html += '<button type="button" class="primary dmake" data-action="dream-done">' + STAR + 'Мрія здійснилась</button>';
    }
    html += '</aside><div class="dmain"><section class="dcard">' + stepsHtml(d) + '</section>';
    html += '<section class="dcard dropzone' + (dv.drag ? ' drag' : '') + '" id="materials">' + filesHtml(d) + '<div class="drop-cover">Відпусти файли, щоб додати</div></section></div></div>';
    html += '<div class="actions dfoot"><button type="button" class="secondary" data-action="dream-edit" data-id="' + d.id + '">Змінити назву, фото, колір</button>' +
      '<button type="button" class="danger" data-action="dream-delete">' + (ui.confirm === 'dream' ? 'Так, у корзину на 2 дні' : 'Видалити мрію') + '</button></div></div>';
    // keep what is being typed if the page is redrawn while a form is open
    var keep = {};
    ['rename-input', 'note-title', 'note-body', 'step-title', 'step-note', 'sub-input'].forEach(function (key) {
      var el = document.getElementById(key); if (el && dreamsView.contains(el)) keep[key] = el.value;
    });
    var focusId = document.activeElement && dreamsView.contains(document.activeElement) ? document.activeElement.id : null;
    dreamsView.innerHTML = html;
    Object.keys(keep).forEach(function (key) { var el = document.getElementById(key); if (el) el.value = keep[key]; });
    if (focusId) { var fe = document.getElementById(focusId); if (fe) fe.focus({ preventScroll: true }); }
    if (ui.sheet && ui.sheet.type === 'step') renderStepSheet();
  }
  var renderDreamDetail = renderDreamPage;

  dreamForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (ui.busy || !ui.sheet) return;
    var title = dTitle.value.trim();
    if (!title) return;
    var id = ui.sheet.type === 'dream-edit' ? ui.sheet.id : null;
    var fields = { title: title, why: dWhy.value.trim(), theme: dTheme };
    var photo = { blob: dPhoto.blob, remove: dPhoto.remove };
    dSubmit.disabled = true;
    dSubmit.textContent = 'Зберігаю…';
    var ok = await run(function () { return saveDream(id, fields, photo); }, id ? 'Збережено' : 'Мрію додано');
    if (!ok) { dSubmit.disabled = false; dSubmit.textContent = id ? 'Зберегти' : 'Додати мрію'; return; }
    dResetPhoto();
    closeSheet();
  });

  // forms inside the detail view are re-drawn, so listen on the document
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('sub-form')) {
      e.preventDefault();
      addSub(e.target.getAttribute('data-step'), true);
      return;
    }
    var id = e.target && e.target.id;
    if (['step-form', 'folder-form', 'rename-form', 'note-form'].indexOf(id) === -1) return;
    e.preventDefault();
    var d = curDream();
    if (!d || ui.busy) return;
    if (id === 'step-form') {
      var t = document.getElementById('step-input').value.trim();
      if (!t) return;
      var steps = d.steps.concat([{ id: uuid(), t: t, d: false }]);
      run(function () { return saveSteps(d, steps); }).then(function (ok) {
        var i2 = document.getElementById('step-input'); if (ok && i2) { i2.value = ''; i2.focus(); }
      });
    } else if (id === 'folder-form') {
      var name = document.getElementById('folder-input').value.trim();
      if (!name) return;
      var parent = dv.folder;
      dv.inline = null;
      run(function () { return addFolder(d, parent, name); }, 'Папку створено');
    } else if (id === 'rename-form') {
      var mid = e.target.getAttribute('data-m'), nn = document.getElementById('rename-input').value.trim();
      if (!nn) return;
      dv.inline = null;
      run(function () { return renameMaterial(mid, nn); });
    } else {
      var title = document.getElementById('note-title').value.trim() || 'Без назви';
      var body = document.getElementById('note-body').value;
      var nid = dv.note === 'new' ? null : dv.note, par = dv.folder;
      run(function () { return saveNote(d, nid, par, title, body); }, 'Нотатку збережено').then(function (ok) {
        if (ok) { dv.note = null; renderDreamDetail(); }
      });
    }
  });

  function addSub(sid, refocus) {
    var dd = curDream(), inp = document.getElementById('sub-input'), tt = inp && inp.value.trim();
    if (!dd || !tt || ui.busy) return;
    inp.value = '';
    run(function () { return saveSteps(dd, mapStep(dd, sid, function (x) { return { id: x.id, t: x.t, d: x.d, n: x.n, s: (x.s || []).concat([{ id: uuid(), t: tt, d: false }]) }; })); }).then(function (ok) {
      var i3 = document.getElementById('sub-input');
      if (!ok && i3) i3.value = tt;
      else if (ok && i3 && refocus) i3.focus();
    });
  }
  function mapStep(d, sid, fn) { return d.steps.map(function (x) { return x.id === sid ? fn(x) : x; }); }
  document.addEventListener('change', function (e) {
    var tid = e.target && e.target.id;
    if (tid === 'sub-input' && ui.sheet && ui.sheet.type === 'step') { addSub(ui.sheet.id, false); return; }
    if (e.target && e.target.classList && e.target.classList.contains('sub-t')) {
      var d3 = curDream(), ps3 = e.target.getAttribute('data-step'), sb3 = e.target.getAttribute('data-sub'), v3 = e.target.value.trim();
      if (!d3 || !v3) return;
      run(function () { return saveSteps(d3, mapStep(d3, ps3, function (x) { return { id: x.id, t: x.t, d: x.d, n: x.n, s: (x.s || []).map(function (y) { return y.id === sb3 ? { id: y.id, t: v3, d: y.d } : y; }) }; })); });
      return;
    }
    if ((tid === 'step-title' || tid === 'step-note') && ui.sheet && ui.sheet.type === 'step') {
      var dd = curDream(), sid = ui.sheet.id, v = e.target.value;
      if (!dd) return;
      if (tid === 'step-title' && !v.trim()) return;
      run(function () {
        return saveSteps(dd, mapStep(dd, sid, function (x) {
          return { id: x.id, t: tid === 'step-title' ? v.trim() : x.t, d: x.d, n: tid === 'step-note' ? v.trim() : x.n, s: x.s || [] };
        }));
      });
      return;
    }
    if (!e.target || e.target.id !== 'done-date') return;
    var d = curDream(), v = e.target.value;
    if (!d || v > iso(today())) return;
    if ((d.doneOn || '') === v) return;
    run(function () { return updateDream(d.id, { done_on: v || null }); });
  });

  // clicks that belong to dreams; returns true when handled
  function dreamAction(act, el, id) {
    var d = curDream();
    var m = el.getAttribute('data-m');
    switch (act) {
      case 'dream-add': openSheet('dream-add'); return true;
      case 'dream-open':
        ui.dreamId = id; ui.confirm = null;
        dv = { folder: null, note: null, inline: null, add: false, menu: null, drag: false, pal: false, step: null };
        try { history.pushState({ dream: id }, ''); } catch (e) {}
        render(); window.scrollTo(0, 0);
        return true;
      case 'dream-back':
        ui.dreamId = null; ui.confirm = null;
        try { if (history.state && history.state.dream) history.replaceState(null, ''); } catch (e) {}
        render(); window.scrollTo(0, 0);
        return true;
      case 'd-theme': dTheme = el.getAttribute('data-v'); paintThemeForm(); return true;
      case 'dream-pal': dv.pal = !dv.pal; renderDreamDetail(); return true;
      case 'dream-theme':
        if (d) { dv.pal = false; var tv = el.getAttribute('data-v'); run(function () { return updateDream(d.id, { theme: tv }); }); }
        return true;
      case 'dream-edit': openSheet('dream-edit', id); return true;
      case 'dream-filter': ui.dreamFilter = el.getAttribute('data-v'); renderDreams(); return true;
      case 'd-pick-cam': dCam.click(); return true;
      case 'd-pick-lib': dLib.click(); return true;
      case 'd-photo-clear': dResetPhoto(); dPhoto.remove = true; dSetPreview(null); return true;
      case 'dream-restore': run(function () { return updateDream(id, { deleted_at: null }); }, 'Мрію відновлено'); return true;
    }
    if (!d) return false;
    switch (act) {
      case 'dream-done':
        run(function () { return setStatus(d, 'done'); }, 'Вітаю!');
        return true;
      case 'done-date-clear': run(function () { return updateDream(d.id, { done_on: null }); }); return true;
      case 'dream-undone':
        run(function () { return setStatus(d, stepsDone(d) ? 'progress' : 'dream'); });
        return true;
      case 'm-add': dv.add = !dv.add; dv.inline = null; renderDreamDetail(); return true;
      case 'm-menu': dv.menu = dv.menu === m ? null : m; ui.confirm = null; renderDreamDetail(); return true;
      case 'step-edit': openSheet('step', el.getAttribute('data-step')); return true;
      case 'sub-toggle':
      case 'sub-del': {
        var ps = el.getAttribute('data-step'), sb2 = el.getAttribute('data-sub');
        var nx = mapStep(d, ps, function (x) {
          var subs = act === 'sub-del' ? (x.s || []).filter(function (y) { return y.id !== sb2; })
            : (x.s || []).map(function (y) { return y.id === sb2 ? { id: y.id, t: y.t, d: !y.d } : y; });
          return { id: x.id, t: x.t, d: x.d, n: x.n, s: subs };
        });
        run(function () { return saveSteps(d, nx); });
        return true;
      }
      case 'step-toggle':
      case 'step-del':
        var sid = el.getAttribute('data-step');
        if (act === 'step-del' && ui.confirm !== 'step:' + sid) { ui.confirm = 'step:' + sid; renderDreamDetail(); return true; }
        if (act === 'step-del' && ui.sheet && ui.sheet.type === 'step') closeSheet();
        ui.confirm = null;
        var next = act === 'step-del'
          ? d.steps.filter(function (s) { return s.id !== sid; })
          : d.steps.map(function (s) { return s.id === sid ? { id: s.id, t: s.t, d: !s.d, n: s.n, s: s.s || [] } : s; });
        run(function () { return saveSteps(d, next); });
        return true;
      case 'm-folder': dv.folder = m || null; dv.inline = null; dv.add = false; dv.menu = null; ui.confirm = null; renderDreamDetail(); return true;
      case 'm-note': dv.note = m; dv.add = false; ui.confirm = null; renderDreamDetail(); return true;
      case 'm-back': dv.note = null; ui.confirm = null; renderDreamDetail(); return true;
      case 'm-new-folder':
        dv.inline = 'folder'; dv.add = false; renderDreamDetail();
        var fi = document.getElementById('folder-input'); if (fi) fi.focus();
        return true;
      case 'm-cancel': dv.inline = null; renderDreamDetail(); return true;
      case 'm-new-note':
        dv.note = 'new'; dv.add = false; renderDreamDetail();
        var nt = document.getElementById('note-title'); if (nt) nt.focus();
        return true;
      case 'm-new-file': dv.add = false; renderDreamDetail(); mFiles.click(); return true;
      case 'm-rename':
        dv.inline = 'rename:' + m; dv.menu = null; renderDreamDetail();
        var ri = document.getElementById('rename-input'); if (ri) { ri.focus(); ri.select(); }
        return true;
      case 'm-del':
        if (ui.confirm !== 'm:' + m) { ui.confirm = 'm:' + m; renderDreamDetail(); return true; }
        ui.confirm = null;
        if (dv.note === m) dv.note = null;
        dv.menu = null;
        run(function () { return deleteMaterial(d, m); }, 'Видалено');
        return true;
      case 'dream-delete':
        if (ui.confirm !== 'dream') { ui.confirm = 'dream'; renderDreamDetail(); return true; }
        ui.confirm = null;
        run(function () { return updateDream(d.id, { deleted_at: new Date().toISOString() }); }, 'Мрію переміщено в корзину на 2 дні').then(function (ok) {
          if (ok) { ui.dreamId = null; render(); window.scrollTo(0, 0); }
        });
        return true;
    }
    return false;
  }

  /* ---------- sign in and out ---------- */
  var authEl = document.getElementById('auth');
  var appEl = document.getElementById('app');
  var loginForm = document.getElementById('login-form');
  var loginErr = document.getElementById('login-err');
  var loginBtn = document.getElementById('login-btn');
  var lEmail = document.getElementById('l-email');
  var lPass = document.getElementById('l-pass');

  function showLogin() {
    session = null;
    state = { plants: [], trash: [], dreams: [], dreamTrash: [] };
    ui.tab = 'plants';
    ui.screen = 'home';
    ui.loaded = false;
    closeSheet();
    appEl.hidden = true;
    authEl.hidden = false;
  }
  function showApp() {
    authEl.hidden = true;
    appEl.hidden = false;
  }
  async function start() {
    showApp();
    view.innerHTML = '<div class="loading">Завантаження…</div>';
    try {
      await refresh();
    } catch (e) {
      console.error(e);
      view.innerHTML = '<div class="empty">Не вдалося завантажити дані. Перевір інтернет.<br><br><button type="button" class="secondary" data-action="retry">Спробувати ще раз</button></div>';
    }
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    loginErr.hidden = true;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Входжу…';
    var r;
    try {
      r = await sb.auth.signInWithPassword({ email: lEmail.value.trim(), password: lPass.value });
    } catch (err) {
      r = { error: err };
    }
    loginBtn.disabled = false;
    loginBtn.textContent = 'Увійти';
    if (r.error) {
      loginErr.textContent = /invalid login credentials/i.test(r.error.message || '')
        ? 'Неправильна пошта або пароль.'
        : 'Не вдалося увійти. Перевір інтернет і спробуй ще раз.';
      loginErr.hidden = false;
      return;
    }
    session = r.data.session;
    lPass.value = '';
    start();
  });

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') setTimeout(showLogin, 0);
  });

  /* ---------- events ---------- */
  // One photo button on a computer, two on a touch device. Done here too, so it works even if the stylesheet is cached.
  var isTouch = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  document.querySelectorAll('.photo-pick .desk-only').forEach(function (b) { b.hidden = isTouch; b.style.display = isTouch ? 'none' : 'inline-flex'; });
  document.querySelectorAll('.photo-pick .touch-only').forEach(function (b) { b.hidden = !isTouch; b.style.display = isTouch ? 'inline-flex' : 'none'; });
  var pressOnBackdrop = false;
  document.addEventListener('pointerdown', function (e) { pressOnBackdrop = (e.target === overlay); }, true);
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) { ui.tab = tab.getAttribute('data-tab'); ui.confirm = null; render(); return; }

    // Close only when the press AND the release both happened on the dark backdrop.
    // (Selecting text in a field and letting go outside the window used to close it.)
    if (e.target === overlay) { if (pressOnBackdrop) closeSheet(); return; }

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action');
    var id = el.getAttribute('data-id');

    if (act === 'open-section') { ui.screen = el.getAttribute('data-section'); ui.tab = 'plants'; ui.dreamTab = 'list'; ui.dreamId = null; ui.confirm = null; render(); window.scrollTo(0, 0); }
    else if (act === 'home') { closeSheet(); ui.screen = 'home'; ui.confirm = null; render(); window.scrollTo(0, 0); }
    else if (act === 'water') openSheet('water', id);
    else if (act === 'edit') openSheet('edit', id);
    else if (act === 'add') openSheet('add');
    else if (act === 'gallery') openSheet('gallery', id);
    else if (act === 'close') closeSheet();
    else if (act === 'pick-cam') wCam.click();
    else if (act === 'pick-lib') wLib.click();
    else if (act === 'photo-clear') clearPhoto();
    else if (act === 'gal-open') { ui.galIdx = Number(el.getAttribute('data-i')); renderGallery(); }
    else if (act === 'gal-back') { ui.galIdx = null; renderGallery(); }
    else if (act === 'gal-step') { ui.galIdx = ui.galIdx + Number(el.getAttribute('data-d')); renderGallery(); }
    else if (act === 'stat-toggle') {
      var cur = selectedIds();
      var at = cur.indexOf(id);
      if (at === -1) cur.push(id); else cur.splice(at, 1);
      ui.statIds = cur;
      renderDiary();
    }
    else if (act === 'stat-range') { ui.range = Number(el.getAttribute('data-range')); renderDiary(); }
    else if (act === 'trash-open' && ui.screen === 'dreams') { ui.dreamTab = ui.dreamTab === 'trash' ? 'list' : 'trash'; ui.dreamId = null; render(); }
    else if (act === 'trash-back' && ui.screen === 'dreams') { ui.dreamTab = 'list'; render(); }
    else if (act === 'trash-open') { ui.tab = ui.tab === 'trash' ? 'plants' : 'trash'; ui.confirm = null; render(); }
    else if (act === 'trash-back') { ui.tab = 'plants'; ui.confirm = null; render(); }
    else if (dreamAction(act, el, id)) { /* handled in the dreams part */ }
    else if (act === 'restore') {
      run(function () { return restorePlant(id); }, 'Рослину відновлено');
    }
    else if (act === 'delete-plant') {
      if (ui.confirm !== 'plant') {
        ui.confirm = 'plant';
        pDelete.textContent = 'Так, перемістити в корзину на 2 дні';
      } else {
        var pid = ui.sheet && ui.sheet.id;
        ui.confirm = null;
        run(function () { return trashPlant(pid); }, 'Рослину переміщено в корзину на 2 дні').then(function (ok) { if (ok) closeSheet(); });
      }
    }
    else if (act === 'del-log') {
      var plantId = el.getAttribute('data-plant'), logId = el.getAttribute('data-log');
      var key = plantId + ':' + logId;
      if (ui.confirm !== key) { ui.confirm = key; renderDiary(); }
      else {
        ui.confirm = null;
        run(function () { return deleteEntry(plantId, logId); }, 'Запис видалено');
      }
    }
    else if (act === 'retry') start();
    else if (act === 'signout') {
      sb.auth.signOut().then(showLogin, showLogin);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlay.hidden) closeSheet();
  });

  var rz;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { if (ui.tab === 'diary' && !appEl.hidden) drawChart(); }, 120);
  });

  // coming back to the tab after a while: reload so every device shows the same data
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && session && !ui.busy && Date.now() - lastRefresh > 5 * 60 * 1000) {
      refresh().catch(function (err) { console.error(err); });
    }
  });

  // drag files from the computer onto the materials card
  (function () {
    var depth = 0;
    function zone(e) { return e.target && e.target.closest ? e.target.closest('#materials') : null; }
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
    function setDrag(on) { var z = document.getElementById('materials'); if (z) z.classList.toggle('drag', on); dv.drag = on; }
    document.addEventListener('dragenter', function (e) { if (zone(e) && hasFiles(e) && !dv.note) { e.preventDefault(); depth++; setDrag(true); } });
    document.addEventListener('dragover', function (e) { if (zone(e) && hasFiles(e) && !dv.note) e.preventDefault(); });
    document.addEventListener('dragleave', function (e) { if (zone(e)) { depth = Math.max(0, depth - 1); if (!depth) setDrag(false); } });
    document.addEventListener('drop', function (e) {
      if (!zone(e) || !hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDrag(false);
      if (!dv.note) uploadMaterials(Array.prototype.slice.call(e.dataTransfer.files));
    });
  })();


  // drag a step by its grip to reorder (works with mouse and touch)
  (function () {
    var drag = null;
    document.addEventListener('pointerdown', function (e) {
      var g = e.target.closest && e.target.closest('[data-grip]');
      if (!g || (e.button && e.button !== 0)) return;
      var li = g.closest('.step');
      if (!li) return;
      e.preventDefault();
      drag = { li: li, y0: e.clientY };
      li.classList.add('dragging');
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.li.style.transform = 'translateY(' + (e.clientY - drag.y0) + 'px)';
    });
    function finish(e, cancel) {
      if (!drag) return;
      var li = drag.li, list = li.parentNode;
      li.classList.remove('dragging'); li.style.transform = '';
      drag = null;
      if (cancel) return;
      var d = curDream(); if (!d) return;
      var others = [].slice.call(list.children).filter(function (x) { return x !== li && !x.classList.contains('is-done'); });
      var order = [], placed = false;
      others.forEach(function (x) {
        var r = x.getBoundingClientRect();
        if (!placed && e.clientY < r.top + r.height / 2) { order.push(li.getAttribute('data-sid')); placed = true; }
        order.push(x.getAttribute('data-sid'));
      });
      if (!placed) order.push(li.getAttribute('data-sid'));
      var open = d.steps.filter(function (x) { return !x.d; });
      var same = open.every(function (x, i) { return x.id === order[i]; });
      if (same) return;
      var byId = {}; d.steps.forEach(function (x) { byId[x.id] = x; });
      var next = order.map(function (id) { return byId[id]; }).concat(d.steps.filter(function (x) { return x.d; }));
      run(function () { return saveSteps(d, next); });
    }
    document.addEventListener('pointerup', function (e) { finish(e, false); });
    document.addEventListener('pointercancel', function (e) { finish(e, true); });
  })();

  window.addEventListener('popstate', function () {
    if (ui.dreamId && !(history.state && history.state.dream)) { ui.dreamId = null; ui.confirm = null; render(); window.scrollTo(0, 0); }
  });

  /* ---------- theme ---------- */
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme-btn');
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() {
    var a = root.getAttribute('data-theme');
    if (a) return a === 'dark';
    return mq.matches;
  }
  function paintThemeBtn() { themeBtn.innerHTML = isDark() ? SUN : MOON; }
  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) {}
  themeBtn.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    paintThemeBtn();
  });
  if (mq.addEventListener) mq.addEventListener('change', paintThemeBtn);
  paintThemeBtn();

  /* ---------- go ---------- */
  sb.auth.getSession().then(function (r) {
    session = r.data && r.data.session;
    if (session) start(); else showLogin();
  }).catch(function (err) { console.error(err); showLogin(); });
})();
