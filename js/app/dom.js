/* Songsheets — tiny DOM helpers. Everything is built with createElement and text nodes;
 * user text never goes through innerHTML.
 * Browser: window.SongSheets.dom
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var PROPS = { value: 1, checked: 1, selected: 1, disabled: 1, indeterminate: 1, multiple: 1, readOnly: 1 };

  function append(el, c) {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    if (typeof c === 'string' || typeof c === 'number') { el.appendChild(doc.createTextNode(String(c))); return; }
    el.appendChild(c);
  }

  function setAttrs(el, attrs) {
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'on') {
        Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
      } else if (k === 'dataset') {
        Object.keys(v).forEach(function (d) { if (v[d] !== null && v[d] !== undefined) el.dataset[d] = String(v[d]); });
      } else if (k === 'style' && typeof v === 'object') {
        Object.keys(v).forEach(function (s) {
          if (s.indexOf('--') === 0) el.style.setProperty(s, v[s]);
          else el.style[s] = v[s];
        });
      } else if (k === 'class' || k === 'className') {
        if (v) el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      } else if (PROPS[k]) {
        el[k] = v;
      } else if (v === false) {
        // omit
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    });
  }

  /** h('button', {class:'btn', on:{click: fn}}, 'Label', child, [more]) */
  function h(tag, attrs) {
    var el = doc.createElement(tag);
    setAttrs(el, attrs);
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function replaceChildren(el) {
    clear(el);
    for (var i = 1; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function delegate(el, event, selector, fn) {
    var handler = function (e) {
      var t = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (t && el.contains(t)) fn(e, t);
    };
    el.addEventListener(event, handler);
    return function () { el.removeEventListener(event, handler); };
  }

  // ---- icons (24x24, stroke based, drawn for this app) -----------------------------------------
  var SVGNS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    plus: ['M12 5v14', 'M5 12h14'],
    minus: ['M5 12h14'],
    back: ['M15 18l-6-6 6-6'],
    next: ['M9 18l6-6-6-6'],
    up: ['M6 15l6-6 6 6'],
    down: ['M6 9l6 6 6-6'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    edit: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
    star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
    music: ['M9 18V5l11-2v13', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
    share: ['M12 3v12', 'M8 7l4-4 4 4', 'M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12z'],
    list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
    library: ['M5 4h4v16H5z', 'M11 4h4v16h-4z', 'M17 5l3 .8-3.8 14.4-3-.8'],
    copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    print: ['M7 9V3h10v6', 'M7 17H4v-7h16v7h-3', 'M7 14h10v7H7z'],
    play: ['M7 4l13 8-13 8z'],
    text: ['M4 7V5h11v2', 'M9.5 5v14', 'M7 19h5', 'M14 13v-1h6v1', 'M17 12v7', 'M15.5 19h3'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7', 'M12 17h.01'],
    grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
    check: ['M5 12l5 5 9-10'],
    file: ['M6 3h8l5 5v13H6z', 'M14 3v5h5'],
    addList: ['M4 6h10', 'M4 12h10', 'M4 18h6', 'M17 14v7', 'M13.5 17.5h7']
  };

  function icon(name, opts) {
    opts = opts || {};
    var svg = doc.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', opts.size || 20);
    svg.setAttribute('height', opts.size || 20);
    svg.setAttribute('fill', opts.filled ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', opts.weight || 2);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    (ICONS[name] || []).forEach(function (d) {
      var p = doc.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  /** Icon button: iconButton('plus', 'Transpose up', fn, {class}) */
  function iconButton(name, label, onClick, opts) {
    opts = opts || {};
    return h('button', {
      type: 'button',
      class: ['btn', 'btn-icon', opts.class],
      title: label,
      'aria-label': label,
      'aria-pressed': opts.pressed === undefined ? null : String(!!opts.pressed),
      disabled: !!opts.disabled,
      on: { click: onClick }
    }, icon(name, { filled: opts.filled }));
  }

  function button(label, onClick, opts) {
    opts = opts || {};
    return h('button', {
      type: 'button',
      class: ['btn', opts.primary ? 'btn-primary' : null, opts.danger ? 'btn-danger' : null, opts.class],
      title: opts.title || null,
      disabled: !!opts.disabled,
      on: { click: onClick }
    }, opts.icon ? icon(opts.icon) : null, opts.icon ? h('span', null, label) : label);
  }

  function select(options, value, onChange, attrs) {
    var el = h('select', Object.assign({ class: 'select', on: { change: function () { onChange(el.value); } } }, attrs || {}),
      options.map(function (o) {
        return h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label);
      }));
    return el;
  }

  function isTyping(e) {
    var t = e.target;
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  root.SongSheets = root.SongSheets || {};
  root.SongSheets.dom = {
    h: h,
    clear: clear,
    replaceChildren: replaceChildren,
    delegate: delegate,
    icon: icon,
    iconButton: iconButton,
    button: button,
    select: select,
    isTyping: isTyping,
    formatDate: formatDate
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
