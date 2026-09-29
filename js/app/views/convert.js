/* Songsheets — Convert with AI (#/convert): copy the prompt, ask an AI assistant, paste its reply back.
 * The reading of the reply (code fences, labels, ChordPro, chords above the words) is aiConvert.js. */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;
  var doc = root.document;
  var AI = S.aiConvert;

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  S.views = S.views || {};
  S.views.convert = function (ctx) {
    var current = AI.analyse('');
    var titleTouched = false;
    var authorTouched = false;
    var timer = null;

    // ---- step 1: the prompt ---------------------------------------------------------------
    var promptBox = h('textarea', {
      class: 'input prompt-text', rows: 12, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      'aria-label': 'The prompt (you can edit it before copying)'
    });
    promptBox.value = AI.PROMPT;
    var promptDetails = h('details', { class: 'prompt-details' },
      h('summary', null, 'Show the prompt'),
      h('p', { class: 'muted small' }, 'You can change it before copying, for example to ask for another language.'),
      promptBox);

    var copyLabel = h('span', null, 'Copy the prompt');
    var copyIcon = h('span', { class: 'btn-icon-slot' }, D.icon('clipboard'));
    var copyBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg copy-prompt', on: { click: copyPrompt } }, copyIcon, copyLabel);
    var copyTimer = null;
    function copyPrompt() {
      ctx.actions.copyText(promptBox.value, 'Prompt copied. Now paste it into your AI assistant, along with your music sheet.').then(function (ok) {
        if (!ok) { promptDetails.open = true; promptBox.focus(); promptBox.select(); return; }
        D.replaceChildren(copyIcon, D.icon('check'));
        copyLabel.textContent = 'Copied';
        copyBtn.classList.add('is-done');
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(function () {
          D.replaceChildren(copyIcon, D.icon('clipboard'));
          copyLabel.textContent = 'Copy the prompt';
          copyBtn.classList.remove('is-done');
        }, 3000);
      });
    }

    // ---- step 3: the reply ---------------------------------------------------------------
    var reply = h('textarea', {
      class: 'input reply-text', rows: 9, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      placeholder: 'Paste the assistant’s reply here.\n\nThe chords, title and author are picked out for you.',
      'aria-label': 'The assistant’s reply',
      on: { input: schedule }
    });
    var canRead = !!(root.navigator.clipboard && root.navigator.clipboard.readText);
    var pasteBtn = canRead ? D.button('Paste from clipboard', function () {
      root.navigator.clipboard.readText().then(function (t) {
        if (!t) { ctx.ui.toast('The clipboard is empty.', { type: 'error' }); return; }
        reply.value = t;
        refresh();
      }, function () {
        ctx.ui.toast('Your browser did not allow that. Press and hold in the box, then choose Paste.', { type: 'error' });
        reply.focus();
      });
    }, { icon: 'clipboard', class: 'btn-small' }) : null;

    var titleIn = h('input', {
      class: 'input', type: 'text', maxlength: 200, placeholder: 'Song title', 'aria-label': 'Title',
      on: { input: function () { titleTouched = titleIn.value.trim() !== ''; renderStatus(); renderPreview(); } }
    });
    var authorIn = h('input', {
      class: 'input', type: 'text', maxlength: 200, placeholder: 'Author (optional)', 'aria-label': 'Author',
      on: { input: function () { authorTouched = authorIn.value.trim() !== ''; renderPreview(); } }
    });
    var statusEl = h('div', { class: 'convert-status', 'aria-live': 'polite' });
    var preview = h('div', { class: 'convert-preview' });
    var addBtn = D.button('Add to library', addSong, { primary: true, icon: 'plus', class: 'btn-lg' });
    addBtn.disabled = true;
    var actionsBar = h('div', { class: 'convert-actions', hidden: true }, addBtn);   // appears once there is a song to add

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 140);
    }

    function isDuplicate(title) {
      var t = S.search.normalizeForSearch(title);
      var songs = ctx.store.get().songs;
      return !!t && Object.keys(songs).some(function (k) { return S.search.normalizeForSearch(songs[k].title) === t; });
    }

    function refresh() {
      timer = null;
      current = AI.analyse(reply.value);
      if (!titleTouched) titleIn.value = current.title || '';
      if (!authorTouched) authorIn.value = current.author || '';
      addBtn.disabled = !current.lyrics.trim();
      actionsBar.hidden = addBtn.disabled;
      renderStatus();
      renderPreview();
    }

    function note(icon, cls, text) {
      return h('p', { class: 'convert-note ' + cls }, D.icon(icon, { size: 16 }), h('span', null, text));
    }

    function renderStatus() {
      D.clear(statusEl);
      var c = current;
      if (c.kind === 'empty') {
        statusEl.appendChild(h('p', { class: 'muted small' }, 'Nothing pasted yet.'));
        return;
      }
      var s = c.stats;
      if (c.lyrics.trim()) {
        statusEl.appendChild(note('check', 'ok', 'Found ' + plural(s.lines, 'line') + ', ' + plural(s.chords, 'chord') + (s.key ? ', key ' + s.key : '') + '.'));
      }
      c.notes.forEach(function (n) { statusEl.appendChild(note('info', 'info', n)); });
      c.warnings.forEach(function (w) { statusEl.appendChild(note('warn', 'warn', w)); });
      c.flags.forEach(function (f) { statusEl.appendChild(note('warn', 'warn', 'The assistant was unsure: ' + f)); });
      var title = titleIn.value.trim();
      if (title && isDuplicate(title)) statusEl.appendChild(note('warn', 'warn', 'Your library already has a song with this title. Adding it makes a second copy.'));
      if (c.lyrics.trim() && s.chords) statusEl.appendChild(note('info', 'info', 'AI can misplace a chord now and then. Look over the preview, and fix anything in the editor.'));
    }

    function renderPreview() {
      if (!current.lyrics.trim()) {
        D.replaceChildren(preview, h('p', { class: 'muted small preview-empty' }, 'The song appears here.'));
        return;
      }
      var st = ctx.store.get();
      var title = titleIn.value.trim() || 'Untitled';
      var sheet = S.sheetModel.buildSheet({ title: title, author: authorIn.value.trim() || null, lyrics: current.lyrics }, {
        transpose: 0, showChords: true, accidentals: st.settings.accidentals
      });
      var meta = S.sheetView.metaLine(sheet);
      D.replaceChildren(preview,
        h('header', { class: 'sheet-header' }, h('h2', { class: 'sheet-title' }, title), meta ? h('p', { class: 'sheet-meta' }, meta) : null),
        h('div', { class: 'sheet-column' }, S.render.toDOM(S.render.render(sheet, { fontScale: st.settings.fontScale, interactiveCapo: false }), doc)));
    }

    function addSong() {
      if (timer) { clearTimeout(timer); refresh(); }
      if (!current.lyrics.trim()) return;
      var title = titleIn.value.trim() || 'Untitled';
      var id = ctx.actions.createSong({ title: title, author: authorIn.value.trim() || null, lyrics: current.lyrics });
      ctx.ui.toast('Added “' + title + '”. Check the chords, and tap Edit to change anything.', {
        type: 'ok', duration: 8000, actionLabel: 'Edit', onAction: function () { ctx.router.navigate('/edit/' + encodeURIComponent(id)); }
      });
      ctx.router.navigate('/song/' + encodeURIComponent(id));
    }

    function step(n, title, children) {
      return h('li', { class: 'convert-step' },
        h('div', { class: 'step-head' }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, String(n)), h('h2', null, title)),
        h('div', { class: 'step-body' }, children));
    }

    renderStatus();
    renderPreview();

    function skipToReply() {
      reply.scrollIntoView({ behavior: 'smooth', block: 'center' });
      reply.focus({ preventScroll: true });
    }

    var el = h('section', { class: 'view view-convert' },
      h('div', { class: 'view-nav' }, h('a', { class: 'btn btn-ghost back-link', href: '#/library' }, D.icon('back', { size: 18 }), 'Library')),
      h('div', { class: 'convert-head' },
        h('h1', { class: 'view-title' }, 'Convert a music sheet with AI'),
        h('p', { class: 'lead' }, 'Turn a photo, PDF or text of a song into a Songsheets song. Any AI assistant that can read images will do: ChatGPT, Claude, Gemini, Copilot and others.'),
        h('p', { class: 'privacy' }, D.icon('info', { size: 16 }), h('span', null, 'Songsheets uploads nothing. Your sheet goes only to the assistant you choose.')),
        h('div', { class: 'skip-note' },
          h('p', null, 'Already have the song as text with the chords above the words? Songsheets can convert that itself, no AI needed.'),
          h('button', { type: 'button', class: 'btn-link', on: { click: skipToReply } }, 'Skip to step 3'))),
      h('ol', { class: 'convert-steps' },
        step(1, 'Copy the prompt', [
          h('p', null, 'It tells the assistant exactly how to write the song, chords and all.'),
          h('div', { class: 'step-actions' }, copyBtn),
          promptDetails
        ]),
        step(2, 'Ask your assistant', [
          h('p', null, 'Open your assistant in another tab or app, then:'),
          h('ul', { class: 'mini-steps' },
            h('li', null, 'Paste the prompt.'),
            h('li', null, 'Attach your sheet (a photo, screenshot or PDF), or paste its text underneath.'),
            h('li', null, 'Send it, then copy the whole reply. Most assistants have a copy button under it.')),
          h('p', { class: 'muted small' }, 'One song per message works best. For a photo, use good light and keep the page flat.')
        ]),
        step(3, 'Paste the reply here', [
          h('div', { class: 'convert-grid' },
            h('div', { class: 'convert-col' },
              h('div', { class: 'reply-bar' }, h('label', { class: 'field-label', for: 'reply-box' }, 'The reply'), pasteBtn),
              reply,
              h('div', { class: 'convert-meta' },
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), titleIn),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Author'), authorIn)),
              statusEl),
            h('div', { class: 'convert-col' }, h('div', { class: 'field-label' }, 'Preview'), preview))
        ])),
      actionsBar);
    reply.id = 'reply-box';

    return {
      el: el,
      title: 'Convert with AI',
      focus: function () { copyBtn.focus({ preventScroll: true }); },
      destroy: function () { if (timer) clearTimeout(timer); if (copyTimer) clearTimeout(copyTimer); }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
