/* dydossa life (min): one icon language for the whole app.
   Flat two-tone shapes with 30/60 degree cuts, a light tone (.l) and a strong tone (.c),
   like machine glyphs: easy to tell apart at a glance. Small ones are 24x24,
   the section badges on the desktop are hexagons in a 100x100 box. */
(function () {
  'use strict';

  // name: [strong colour, light colour, [[tone, path], ...]]
  var S = {
    drop: ['#1C7CE0', '#9ED0FF', [
      ['l', 'M12 2l6.5 9.5V16L15 21H9l-3.5-5v-4.5z'],
      ['c', 'M12 2l6.5 9.5V16L15 21h-3z']]],
    plus: ['#2E9E4F', '#9BE0A8', [
      ['l', 'M10 3h4v18h-4z'],
      ['c', 'M3 10h18v4H3z']]],
    plant: ['#2E9E4F', '#9BE0A8', [
      ['l', 'M11 15.5L4 11.5v-4l7 4z'],
      ['c', 'M11 10h2v11h-2zM13 13l7-4V5l-7 4z'],
      ['l', 'M6 20h12v2H6z']]],
    star: ['#E8920C', '#FFD27A', [
      ['l', 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z'],
      ['c', 'M12 2l2.5 7.5L12 12zM22 12l-7.5 2.5L12 12zM12 22l-2.5-7.5L12 12zM2 12l7.5-2.5L12 12z']]],
    chart: ['#0F8C8C', '#8EE3E0', [
      ['l', 'M4 12h4v7H4zM16 8h4v11h-4z'],
      ['c', 'M10 4h4v15h-4zM2 19h20v3H2z']]],
    trash: ['#5E6C84', '#C3CCDA', [
      ['l', 'M5.5 8h13l-1.3 14H6.8z'],
      ['c', 'M3.5 4.5h17v3h-17zM9 2h6v2.5H9zM9 10.5h1.8v9H9zM13.2 10.5H15v9h-1.8z']]],
    restore: ['#1E8F4E', '#9BE0A8', [
      ['l', 'M12 3.5l7.8 4.5v9L12 21.5 4.2 17v-4.5h2.6v3L12 18.5l5.2-3v-6L12 6.5z'],
      ['c', 'M1.5 12.5h8L5.5 6.5z']]],
    edit: ['#E0662A', '#FFC08A', [
      ['l', 'M4 20v-4L15 5l4 4L8 20z'],
      ['c', 'M15 5l2-2 4 4-2 2zM4 20v-3l3 3z']]],
    gear: ['#5E6C84', '#C3CCDA', [
      ['l', 'M12 2l8.7 5v10L12 22l-8.7-5V7z'],
      ['c', 'M12 6.5l4.8 2.75v5.5L12 17.5l-4.8-2.75v-5.5z'],
      ['p', 'M12 9.8l1.9 1.1v2.2L12 14.2l-1.9-1.1v-2.2z']]],
    camera: ['#4A5568', '#A7D3FF', [
      ['c', 'M8 4.5h8L17.5 7.5H21V20H3V7.5h3.5z'],
      ['l', 'M12 9l3.9 2.25v4.5L12 18l-3.9-2.25v-4.5z']]],
    image: ['#2F8F55', '#BFE3FF', [
      ['l', 'M3 4h18v16H3z'],
      ['c', 'M3 20l6-8 4 4 3-3 5 5v2zM16 6l2 2-2 2-2-2z']]],
    folder: ['#D99A12', '#FFD966', [
      ['c', 'M2 4.5h7l2 2.5h11v12.5H2z'],
      ['l', 'M4 10h19l-2.5 10H1.5z']]],
    folderadd: ['#D99A12', '#FFD966', [
      ['c', 'M2 4.5h7l2 2.5h11v12.5H2z'],
      ['l', 'M4 10h19l-2.5 10H1.5z'],
      ['p', 'M11 11.5h2V14h2.5v2H13v2.5h-2V16H8.5v-2H11z']]],
    note: ['#3D7BD9', '#DDEBFF', [
      ['l', 'M5 2h10l4 4v16H5z'],
      ['c', 'M15 2v4h4zM8 10h8v1.8H8zM8 13.6h8v1.8H8zM8 17.2h5V19H8z']]],
    noteadd: ['#3D7BD9', '#DDEBFF', [
      ['l', 'M5 2h10l4 4v16H5z'],
      ['c', 'M15 2v4h4zM11 10.5h2V13.5h3v2h-3v3h-2v-3H8v-2h3z']]],
    file: ['#6B7A90', '#E3E8EF', [
      ['l', 'M5 2h10l4 4v16H5z'],
      ['c', 'M15 2v4h4zM5 15h14v3H5z']]],
    upload: ['#1C7CE0', '#9ED0FF', [
      ['c', 'M12 2.5l6.5 6.5H14.5v6h-5v-6H5.5z'],
      ['l', 'M2.5 13.5h4v4h11v-4h4V21h-19z']]],
    check: ['#2E9E4F', '#9BE0A8', [
      ['c', 'M2.5 12.5l3-3 4.5 4.5 8.5-8.5 3 3L10 20z']]],
    x: ['#C9372C', '#F7A39A', [
      ['c', 'M5 3l7 7 7-7 2 2-7 7 7 7-2 2-7-7-7 7-2-2 7-7-7-7z']]],
    clock: ['#3D5A80', '#BFD4F2', [
      ['l', 'M12 2l8.7 5v10L12 22l-8.7-5V7z'],
      ['c', 'M11 6h2v7h-2zM11 11h5.5v2H11z']]],
    repeat: ['#3D7BD9', '#9ED0FF', [
      ['c', 'M3 7h12V4l5.5 4.5L15 13v-3H3z'],
      ['l', 'M21 14H9v-3l-5.5 4.5L9 20v-3h12z']]],
    warn: ['#8A5A00', '#FFD54A', [
      ['l', 'M12 2l11 19H1z'],
      ['c', 'M11 8h2v7h-2zM11 16.5h2v2.2h-2z']]],
    sun: ['#E8920C', '#FFD27A', [
      ['l', 'M12 1l1.6 4.2h-3.2zM12 23l-1.6-4.2h3.2zM2.5 6.5l4.4.7-1.6 2.8zM21.5 6.5l-2.8 3.5-1.6-2.8zM2.5 17.5l2.8-3.5 1.6 2.8zM21.5 17.5l-4.4-.7 1.6-2.8z'],
      ['c', 'M12 7l4.3 2.5v5L12 17l-4.3-2.5v-5z']]],
    moon: ['#5B5BD6', '#B9B9FF', [
      ['l', 'M15.5 2L7 4.2 3 9v6l4 4.8 8.5 2.2 4.5-3L13 17l-3.5-5L13 7l7-2z'],
      ['c', 'M19 8.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z']]],
    power: ['#D9302C', '#FF9A8A', [
      ['l', 'M7.5 5.5L9 7.8 6 9.6v4.8l6 3.5 6-3.5V9.6l-3-1.8 1.5-2.3L21 8.2v7.6L12 21l-9-5.2V8.2z'],
      ['c', 'M10.8 2h2.4v10h-2.4z']]],
    grid: ['#3D5A80', '#BFD4F2', [
      ['l', 'M3 3h8v8H3zM13 13h8v8h-8z'],
      ['c', 'M13 3h8v8h-8zM3 13h8v8H3z']]],
    up: ['#1E8F4E', '#9BE0A8', [
      ['l', 'M12 3l8 8h-5v10H9V11H4z'],
      ['c', 'M12 3l8 8h-5v10h-3z']]],
    calendar: ['#C9372C', '#FFE1DC', [
      ['l', 'M3 5h18v16H3z'],
      ['c', 'M3 5h18v4H3zM7 2h2.4v5H7zM14.6 2H17v5h-2.6zM6.5 12h3v3h-3zM10.5 12h3v3h-3zM14.5 12h3v3h-3zM6.5 16h3v3h-3z']]],
    quote: ['#7A4FD0', '#D7C4FF', [
      ['l', 'M3 5h7v7l-3.5 7H3l2.5-7H3z'],
      ['c', 'M13.5 5h7v7l-3.5 7h-3.5l2.5-7h-2.5z']]],
    open: ['#1C7CE0', '#9ED0FF', [
      ['l', 'M3 6h9v2.5H5.5v10h10V12H18v9H3z'],
      ['c', 'M13 3h8v8l-3-3-6 6-2-2 6-6z']]],
    more: ['#5E6C84', '#C3CCDA', [
      ['c', 'M5 9.5l2.6 1.5v3L5 15.5 2.4 14v-3zM12 9.5l2.6 1.5v3L12 15.5 9.4 14v-3zM19 9.5l2.6 1.5v3L19 15.5 16.4 14v-3z']]],
    flag: ['#E8920C', '#FFD27A', [
      ['c', 'M4 2h2.5v20H4z'],
      ['l', 'M6.5 3H20l-3 4.5 3 4.5H6.5z']]],
    list: ['#3D5A80', '#BFD4F2', [
      ['c', 'M3 4h4v4H3zM3 10h4v4H3zM3 16h4v4H3z'],
      ['l', 'M9 4.5h12v3H9zM9 10.5h12v3H9zM9 16.5h12v3H9z']]]
  };

  function small(name, cls) {
    var d = S[name];
    if (!d) return '';
    var out = '<svg class="i i-' + name + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" style="--c:' + d[0] + ';--l:' + d[1] + '" aria-hidden="true" focusable="false">';
    d[2].forEach(function (p) { out += '<path class="' + p[0] + '" d="' + p[1] + '"/>'; });
    return out + '</svg>';
  }

  /* ---------- the big hexagon badges for the desktop flower ---------- */
  var FRAME = '50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5';
  var INNER = 'M50 10L85 30V70L50 90 15 70V30z';

  // id: [strong, light, shapes inside the inner hexagon]
  var B = {
    plants: ['#2E9E4F', '#A6E6B5',
      '<path class="l" d="M0 70h100v30H0z"/>' +
      '<path class="c" d="M46 36h8v34h-8z"/>' +
      '<path class="l" d="M46 52L24 39V27l22 13z"/>' +
      '<path class="c" d="M54 46l22-13V21L54 34z"/>' +
      '<path class="c" d="M40 70h20l-4 7H44z"/>'],
    dreams: ['#E8920C', '#FFD58A',
      '<path class="l" d="M0 74l26-24 12 9 18-22 30 27v30H0z"/>' +
      '<path class="c" d="M0 72h100v6H0z"/>' +
      '<path class="c" d="M66 21l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>' +
      '<path class="l" d="M38 59l18-22 6 6-14 14z"/>'],
    ants: ['#D9435E', '#F9B4C1',
      '<path class="l" d="M34 47l13 7.5v15L34 77l-13-7.5v-15z"/>' +
      '<path class="c" d="M53 43l6.5 3.75v7.5L53 58l-6.5-3.75v-7.5z"/>' +
      '<path class="c" d="M68 30l8.7 5v10L68 50l-8.7-5V35z"/>' +
      '<path class="c" d="M71 31l5-10 9-2 1 3-7 1.6-4.4 8.6zM50 56l-9 14 2.6 1.6 9-14zM56 56l3 18 3-.5-3-18zM58 47l12 4-1 2.8-12-4z"/>'],
    piano: ['#2F7FE0', '#A9CDF8',
      '<path class="c" d="M0 26h100v8H0z"/>' +
      '<path class="l" d="M0 34h100v40H0z"/>' +
      '<path class="p" d="M27 34h2.4v40H27zM39 34h2.4v40H39zM51 34h2.4v40H51zM63 34h2.4v40H63zM75 34h2.4v40H75z"/>' +
      '<path class="c" d="M22 34h8v22h-8zM34 34h8v22h-8zM58 34h8v22h-8zM70 34h8v22h-8z"/>']
  };

  var clipN = 0;
  function hex(id, cls) {
    var d = B[id];
    var k = 'hx' + (++clipN);
    var out = '<svg class="hx-ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">';
    if (!d) return out + '<polygon class="hx-frame empty" points="' + FRAME + '"/></svg>';
    return out + '<defs><clipPath id="' + k + '"><path d="' + INNER + '"/></clipPath></defs>' +
      '<polygon class="hx-frame" points="' + FRAME + '" style="stroke:' + d[0] + '"/>' +
      '<g clip-path="url(#' + k + ')" style="--c:' + d[0] + ';--l:' + d[1] + '">' + d[2] + '</g></svg>';
  }

  // the app emblem: a sprout in a two-tone disc (dark above, light ground below)
  function emblem(cls) {
    var k = 'em' + (++clipN);
    return '<svg class="emblem' + (cls ? ' ' + cls : '') + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="' + k + '"><circle cx="50" cy="50" r="44"/></clipPath></defs>' +
      '<circle cx="50" cy="50" r="48" fill="none" stroke="#BEF598" stroke-width="3"/>' +
      '<g clip-path="url(#' + k + ')">' +
        '<path fill="#83C785" d="M0 0h100v62H0z"/><path fill="#BEF598" d="M0 62h100v38H0z"/>' +
        '<path fill="#BEF598" d="M47 34h6v28h-6zM47 52L31 42.8V33l16 9.2zM53 44l16-9.2v-9.8L53 34.2z"/>' +
        '<path fill="#83C785" d="M47 62h6v12h-6zM50 72l6 3.5v7L50 86l-6-3.5v-7z"/>' +
      '</g></svg>';
  }

  window.ICONS = { small: small, hex: hex, emblem: emblem, has: function (n) { return !!S[n]; }, names: Object.keys(S), colors: B };
})();
