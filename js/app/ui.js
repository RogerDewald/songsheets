/* Songsheets — toasts, dialogs and pop-up menus.
 * Browser: window.SongSheets.ui
 */
(function (root) {
  'use strict';
  var D = root.SongSheets.dom;
  var h = D.h;
  var doc = root.document;

  function region() {
    var r = doc.querySelector('.toast-region');
    if (!r) {
      r = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
      doc.body.appendChild(r);
    }
    return r;
  }

  /** toast('Saved', {type:'ok'|'error'|'info', actionLabel, onAction, duration, sticky}) */
  function toast(message, opts) {
    opts = opts || {};
    var el = h('div', { class: ['toast', opts.type ? 'toast-' + opts.type : null] },
      h('span', { class: 'toast-text' }, message));
    var timer = null;
    function close() {
      if (timer) clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    if (opts.actionLabel) {
      el.appendChild(h('button', { type: 'button', class: 'btn btn-link', on: { click: function () { close(); if (opts.onAction) opts.onAction(); } } }, opts.actionLabel));
    }
    el.appendChild(h('button', { type: 'button', class: 'btn btn-icon toast-close', 'aria-label': 'Dismiss', on: { click: close } }, D.icon('close', { size: 16 })));
    region().appendChild(el);
    if (!opts.sticky) timer = setTimeout(close, opts.duration || (opts.type === 'error' ? 8000 : 4000));
    return close;
  }

  function supportsDialog() {
    return typeof root.HTMLDialogElement === 'function';
  }

  /** Generic modal. body: Node; buttons: [{label, value, primary, danger}] -> Promise<value|null> */
  function modal(title, body, buttons, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var dlg = h('dialog', { class: ['dialog', opts.wide ? 'dialog-wide' : null], 'aria-labelledby': 'dlg-title' });
      function finish(v) {
        if (done) return;
        done = true;
        if (dlg.open && dlg.close) dlg.close();
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
        resolve(v);
      }
      var form = h('form', { method: 'dialog', on: { submit: function (e) { e.preventDefault(); finish(opts.onSubmit ? opts.onSubmit() : (buttons.filter(function (b) { return b.primary; })[0] || {}).value); } } },
        h('h2', { class: 'dialog-title', id: 'dlg-title' }, title),
        h('div', { class: 'dialog-body' }, body),
        h('div', { class: 'dialog-actions' }, buttons.map(function (b) {
          return h('button', {
            type: b.primary ? 'submit' : 'button',
            class: ['btn', b.primary ? 'btn-primary' : null, b.danger ? 'btn-danger' : null],
            on: b.primary ? null : { click: function () { finish(b.value); } }
          }, b.label);
        })));
      dlg.appendChild(form);
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(null); });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) finish(null); });
      doc.body.appendChild(dlg);
      if (supportsDialog() && dlg.showModal) dlg.showModal();
      else dlg.setAttribute('open', '');
      var focus = dlg.querySelector('[autofocus]') || dlg.querySelector('.btn-primary') || dlg.querySelector('button');
      if (focus) focus.focus();
    });
  }

  function confirmDialog(opts) {
    return modal(opts.title || 'Are you sure?', h('p', null, opts.message || ''), [
      { label: opts.cancelLabel || 'Cancel', value: false },
      { label: opts.okLabel || 'OK', value: true, primary: true, danger: !!opts.danger }
    ]).then(function (v) { return v === true; });
  }

  function promptDialog(opts) {
    var input = h('input', { class: 'input', type: 'text', value: opts.value || '', autofocus: true, 'aria-label': opts.label || opts.title, maxlength: 200 });
    var body = h('label', { class: 'field' }, opts.label ? h('span', { class: 'field-label' }, opts.label) : null, input);
    setTimeout(function () { input.select(); }, 0);
    return modal(opts.title, body, [
      { label: 'Cancel', value: null },
      { label: opts.okLabel || 'OK', value: '__ok__', primary: true }
    ], { onSubmit: function () { return '__ok__'; } }).then(function (v) {
      if (v !== '__ok__') return null;
      var s = input.value.trim();
      return s || null;
    });
  }

  /** choiceDialog({title, message, choices:[{label, value, primary, danger}]}) -> Promise<value|null> */
  function choiceDialog(opts) {
    return modal(opts.title, h('p', null, opts.message || ''), opts.choices.concat([{ label: 'Cancel', value: null }]).reverse());
  }

  // ---- pop-up menu ----------------------------------------------------------------------------
  var openMenu = null;

  function closeMenu() {
    if (openMenu) { openMenu.close(); openMenu = null; }
  }

  /** menu(anchorButton, items:[{label, hint, icon, onSelect, disabled, separator}]) */
  function menu(anchor, items) {
    if (openMenu && openMenu.anchor === anchor) { closeMenu(); return; }
    closeMenu();
    var list = h('div', { class: 'menu', role: 'menu' });
    items.forEach(function (it) {
      if (it.separator) { list.appendChild(h('div', { class: 'menu-sep', role: 'separator' })); return; }
      if (it.heading) { list.appendChild(h('div', { class: 'menu-heading' }, it.heading)); return; }
      list.appendChild(h('button', {
        type: 'button', class: 'menu-item', role: 'menuitem', disabled: !!it.disabled,
        on: { click: function () { closeMenu(); it.onSelect(); } }
      }, it.icon ? D.icon(it.icon, { size: 18 }) : h('span', { class: 'menu-icon-space' }),
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, it.label), it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null)));
    });
    doc.body.appendChild(list);
    var r = anchor.getBoundingClientRect();
    var w = list.offsetWidth;
    var left = Math.min(Math.max(8, r.right - w), root.innerWidth - w - 8);
    var top = r.bottom + 4;
    if (top + list.offsetHeight > root.innerHeight - 8) top = Math.max(8, r.top - list.offsetHeight - 4);
    list.style.left = left + root.scrollX + 'px';
    list.style.top = top + root.scrollY + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    function onDoc(e) { if (!list.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); }
    function onKey(e) {
      var btns = Array.prototype.slice.call(list.querySelectorAll('.menu-item:not([disabled])'));
      var i = btns.indexOf(doc.activeElement);
      if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
    }
    setTimeout(function () { doc.addEventListener('mousedown', onDoc); doc.addEventListener('touchstart', onDoc); }, 0);
    doc.addEventListener('keydown', onKey);
    openMenu = {
      anchor: anchor,
      close: function () {
        doc.removeEventListener('mousedown', onDoc);
        doc.removeEventListener('touchstart', onDoc);
        doc.removeEventListener('keydown', onKey);
        anchor.setAttribute('aria-expanded', 'false');
        if (list.parentNode) list.parentNode.removeChild(list);
      }
    };
    var first = list.querySelector('.menu-item:not([disabled])');
    if (first) first.focus();
  }

  root.addEventListener('hashchange', closeMenu);
  root.addEventListener('resize', closeMenu);

  root.SongSheets = root.SongSheets || {};
  root.SongSheets.ui = {
    toast: toast,
    modal: modal,
    confirm: confirmDialog,
    prompt: promptDialog,
    choice: choiceDialog,
    menu: menu,
    closeMenu: closeMenu
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
