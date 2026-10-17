/* dydossa life: the whole front end in one file.
   Data lives in Supabase (tables `items`, `entries`, private storage bucket `photos`).
   An "item" is anything you track; `section` says what kind (now only 'plants').
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
  var state = { plants: [], trash: [] };
  var ui = { screen: 'home', loaded: false, tab: 'plants', sheet: null, photo: null, photoUrl: null, confirm: null, statIds: null, range: 90, galIdx: null, busy: false };
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
    if (!state.trash.length) return head + '<div style="height:12px"></div><div class="empty">Корзина порожня. Видалені рослини з’являтимуться тут на 2 дні.</div>';
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
      '<p class="meta" style="margin:6px 0 12px">Видалені рослини зберігаються 2 дні, потім зникають разом із записами та фото.</p>' +
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
  var SECTIONS = [
    { id: 'plants', title: 'Рослини', icon: ICON_PLANT, ready: true },
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
      var line = s.ready ? (s.id === 'plants' ? plantsLine() : '') : 'Скоро';
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
    plantsScreen.hidden = home;
    homeBtn.hidden = home;
    trashBtn.hidden = home;
  }

  function render() {
    applyScreen();
    if (ui.screen === 'home') { renderHome(); return; }
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
    sheetEl.classList.toggle('wide', type === 'gallery');
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
    } else {
      var g = findAny(id);
      sheetTitle.textContent = 'Фото: ' + g.name;
      renderGallery();
      first = overlay.querySelector('[data-action="close"]');
    }
    overlay.hidden = false;
    setTimeout(function () { first.focus(); }, 0);
  }
  function closeSheet() {
    overlay.hidden = true;
    ui.sheet = null;
    ui.galIdx = null;
    clearPhoto();
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
    state = { plants: [], trash: [] };
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

    if (act === 'open-section') { ui.screen = el.getAttribute('data-section'); ui.tab = 'plants'; ui.confirm = null; render(); window.scrollTo(0, 0); }
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
    else if (act === 'trash-open') { ui.tab = ui.tab === 'trash' ? 'plants' : 'trash'; ui.confirm = null; render(); }
    else if (act === 'trash-back') { ui.tab = 'plants'; ui.confirm = null; render(); }
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
