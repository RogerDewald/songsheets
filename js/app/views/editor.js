/* Songsheets — Song editor (#/edit/:id and #/new): text + live preview, songbase hotkeys, autosave. */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;
  var doc = root.document;

  var HELP = [
    ['[G]word', 'A chord, placed right before the syllable it belongs to. Mid-word is fine: ex[F]act.'],
    ['  two spaces', 'Lines that start with two spaces are a chorus. Select lines and press Tab to indent them.'],
    ['1', 'A number on its own line is the number of the stanza below it.'],
    ['# comment', 'A comment, shown in grey.'],
    ['# Capo 2', 'A capo preset. Tapping it shows the sounding chords (transposes up 2).'],
    ['# Key: Em', 'Tells the transposer the key when it cannot guess it from the chords.'],
    ['### Tune name', 'Starts an alternative tune for the same song. The viewer lets you pick one.'],
    ['**bold** *italic*', 'Bold and italic words.'],
    ['a_b', 'An underscore joins two words with a musical tie (‿).'],
    ['[F#m  Bm]', 'Several chords over one spot. Spaces inside the brackets keep them apart.'],
    ['[N.C.] [x2]', 'Anything that is not a chord name stays exactly as written when transposing.']
  ];

  S.views = S.views || {};
  S.views.edit = function (ctx, route) {
    var isNew = route.name === 'new';
    var id = isNew ? S.ids.newId() : route.params.id;
    var existing = ctx.store.get().songs[id];
    if (!isNew && !existing) return S.views.notFound(ctx, 'That song is not in your library.');
    var created = !!existing;
    var dirty = false;
    var saveTimer = null;
    var lastSavedAt = existing ? existing.updatedAt : null;
    var previewTranspose = 0;
    var previewTune = existing ? existing.tuneIndex || 0 : 0;
    var shortcutsOn = ctx.store.get().settings.editorShortcuts !== false;
    var escapeTab = false;
    var rafId = 0;

    var initial = existing || { title: route.query.title || '', author: '', tags: [], lyrics: '' };
    var titleIn = h('input', { class: 'input title-input', type: 'text', value: initial.title === 'Untitled' && !existing ? '' : initial.title, placeholder: 'Song title', 'aria-label': 'Title', maxlength: 200 });
    var authorIn = h('input', { class: 'input', type: 'text', value: initial.author || '', placeholder: 'Author or source (optional)', 'aria-label': 'Author', maxlength: 200 });
    var tagsIn = h('input', { class: 'input', type: 'text', value: (initial.tags || []).join(', '), placeholder: 'Tags, separated by commas', 'aria-label': 'Tags', maxlength: 400 });
    var ta = h('textarea', {
      class: 'input lyrics-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      'aria-label': 'Song text', placeholder: 'Type the song here.\n\n[G]Chords go in square [C]brackets.\n  Chorus lines start with two spaces.\n\nType \\ or $ to insert [].'
    });
    ta.value = initial.lyrics || '';
    var dupNote = h('p', { class: 'field-note warn', hidden: true });
    var status = h('span', { class: 'save-status', 'aria-live': 'polite' });
    var preview = h('div', { class: 'preview-sheet' });
    var previewBar = h('div', { class: 'preview-bar' });
    var helpPanel = h('aside', { class: 'help-panel', hidden: true, 'aria-label': 'Formatting help' },
      h('div', { class: 'help-head' }, h('h2', null, 'How to format a song'),
        D.iconButton('close', 'Close help', function () { toggleHelp(false); })),
      h('dl', { class: 'help-list' }, HELP.map(function (r) {
        return [h('dt', null, h('code', null, r[0])), h('dd', null, r[1])];
      })),
      h('h3', null, 'Typing shortcuts'),
      h('ul', { class: 'help-shortcuts' },
        h('li', null, h('kbd', null, '\\'), ' or ', h('kbd', null, '$'), ' inserts ', h('code', null, '[]'), ' with the cursor inside.'),
        h('li', null, 'Inside brackets, a lower-case a–g becomes a capital: typing ', h('code', null, 'bb'), ' gives ', h('code', null, 'Bb'), '.'),
        h('li', null, h('kbd', null, 'Tab'), ' indents the selected lines (chorus), ', h('kbd', null, 'Shift'), '+', h('kbd', null, 'Tab'), ' removes it. Press ', h('kbd', null, 'Esc'), ' then ', h('kbd', null, 'Tab'), ' to leave the text box.')),
      h('p', { class: 'muted small' }, 'This is the songbase format, so text pastes between the two unchanged.'));

    var shortcutToggle = h('label', { class: 'check small', title: 'Type \\ or $ for [], and capitalise chord letters' },
      h('input', { type: 'checkbox', checked: shortcutsOn, on: { change: function (e) { shortcutsOn = e.target.checked; ctx.actions.updateSettings({ editorShortcuts: shortcutsOn }); } } }),
      ' Chord shortcuts');

    function fields() {
      return {
        title: titleIn.value.trim() || 'Untitled',
        author: authorIn.value.trim() || null,
        tags: tagsIn.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
        lyrics: ta.value
      };
    }

    function hasContent() {
      return !!(titleIn.value.trim() || ta.value.trim() || authorIn.value.trim());
    }

    function setStatus(text, cls) {
      status.textContent = text;
      status.className = 'save-status' + (cls ? ' ' + cls : '');
    }

    function save() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (!dirty) return;
      if (!created && !hasContent()) { dirty = false; setStatus(''); return; }
      var f = fields();
      if (!created) {
        ctx.actions.createSong(Object.assign({ id: id }, f));
        created = true;
        root.history.replaceState(null, '', '#/edit/' + encodeURIComponent(id));
      } else {
        ctx.actions.updateSong(id, f);
      }
      dirty = false;
      var st = ctx.store.get();
      lastSavedAt = st.songs[id] && st.songs[id].updatedAt;
      if (st.storageError) setStatus('Not saved: ' + st.storageError.message, 'error');
      else setStatus('Saved ' + D.formatDate(lastSavedAt), 'ok');
    }

    function changed() {
      dirty = true;
      setStatus('Editing…', 'pending');
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 500);
      schedulePreview();
      checkDuplicate();
    }

    function checkDuplicate() {
      var t = S.search.normalizeForSearch(titleIn.value);
      var songs = ctx.store.get().songs;
      var dup = t && Object.keys(songs).some(function (k) { return k !== id && S.search.normalizeForSearch(songs[k].title) === t; });
      dupNote.hidden = !dup;
      dupNote.textContent = dup ? 'Another song already has this title.' : '';
    }

    function schedulePreview() {
      if (rafId) return;
      rafId = (root.requestAnimationFrame || setTimeout)(function () { rafId = 0; renderPreview(); });
    }

    function renderPreview() {
      var f = fields();
      var sheet = S.sheetModel.buildSheet({ id: id, title: f.title, author: f.author, lyrics: f.lyrics }, {
        transpose: previewTranspose, tuneIndex: previewTune, showChords: true,
        accidentals: (existing && existing.accidentals) || ctx.store.get().settings.accidentals
      });
      previewTune = sheet.tuneIndex;
      D.clear(previewBar);
      previewBar.appendChild(h('span', { class: 'preview-label' }, 'Preview'));
      if (sheet.sourceHasChords) {
        previewBar.appendChild(h('span', { class: 'ctl-group' },
          D.iconButton('minus', 'Preview a semitone lower', function () { previewTranspose = S.transpose.mod(previewTranspose - 1, 12); renderPreview(); }),
          h('span', { class: 'preview-key', title: 'Key of the preview' }, (sheet.targetKeyLabel || '?') + (sheet.transposeSigned ? ' (' + (sheet.transposeSigned > 0 ? '+' : '−') + Math.abs(sheet.transposeSigned) + ')' : '')),
          D.iconButton('plus', 'Preview a semitone higher', function () { previewTranspose = S.transpose.mod(previewTranspose + 1, 12); renderPreview(); })));
      }
      if (sheet.tuneCount > 1) {
        previewBar.appendChild(D.select(sheet.tuneTitles.map(function (t, i) { return { value: i, label: t }; }), sheet.tuneIndex,
          function (v) { previewTune = parseInt(v, 10); previewTranspose = 0; renderPreview(); }, { 'aria-label': 'Preview tune' }));
      }
      var head = h('header', { class: 'sheet-header' }, h('h1', { class: 'sheet-title' }, f.title), (function () {
        var m = S.sheetView.metaLine(sheet);
        return m ? h('p', { class: 'sheet-meta' }, m) : null;
      })());
      D.replaceChildren(preview, head, h('div', { class: 'sheet-column' },
        S.render.toDOM(S.render.render(sheet, { fontScale: ctx.store.get().settings.fontScale, interactiveCapo: false }), doc)));
    }

    // ---- text editing helpers (keep native undo where the browser allows it) -------------------
    function insertText(text) {
      ta.focus();
      var ok = false;
      try { ok = doc.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) {
        var s = ta.selectionStart;
        ta.setRangeText(text, s, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    function replaceRange(start, end, text, selStart, selEnd) {
      ta.focus();
      ta.setSelectionRange(start, end);
      insertText(text);
      ta.setSelectionRange(selStart, selEnd);
    }

    function lineBounds() {
      var v = ta.value;
      var s = ta.selectionStart;
      var e = ta.selectionEnd;
      if (e > s && v.charAt(e - 1) === '\n') e--;               // a selection ending at a line start excludes that line
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var le = v.indexOf('\n', e);
      if (le < 0) le = v.length;
      return { start: ls, end: le };
    }

    function indentLines(out) {
      var b = lineBounds();
      var block = ta.value.slice(b.start, b.end);
      var lines = block.split('\n');
      var next = lines.map(function (l) {
        if (out) return l.replace(/^ {1,2}/, '');
        return l.trim() === '' ? l : '  ' + l;
      }).join('\n');
      if (next === block) return;
      replaceRange(b.start, b.end, next, b.start, b.start + next.length);
    }

    function wrapChord() {
      var s = ta.selectionStart;
      var e = ta.selectionEnd;
      var sel = ta.value.slice(s, e);
      if (sel && sel.indexOf('\n') < 0) { replaceRange(s, e, '[' + sel + ']', s + 1, s + 1 + sel.length); return; }
      insertText('[]');
      var p = ta.selectionStart - 1;
      ta.setSelectionRange(p, p);
    }

    function prefixLine(prefix) {
      var b = lineBounds();
      var line = ta.value.slice(b.start, b.end);
      if (line.indexOf(prefix) === 0) return;
      replaceRange(b.start, b.start, prefix, b.start + prefix.length + (ta.selectionStart - b.start), b.start + prefix.length + (ta.selectionEnd - b.start));
    }

    ta.addEventListener('beforeinput', function (e) {
      if (!shortcutsOn || e.isComposing || e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
      if (ta.selectionStart !== ta.selectionEnd) return;
      var before = ta.value.slice(0, ta.selectionStart);
      if (e.data === '\\' || e.data === '$') {
        e.preventDefault();
        insertText('[]');
        var p = ta.selectionStart - 1;
        ta.setSelectionRange(p, p);
      } else if (/^[a-g]$/.test(e.data) && /\[[^\]\n]*$/.test(before) && !/[A-Za-z]$/.test(before)) {
        e.preventDefault();
        insertText(e.data.toUpperCase());
      }
    });

    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { escapeTab = true; return; }
      if (e.key === 'Tab' && !escapeTab && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) indentLines(true);
        else if (ta.selectionStart === ta.selectionEnd && ta.value.slice(ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1, ta.selectionStart).trim() !== '') insertText('  ');
        else indentLines(false);
        return;
      }
      escapeTab = false;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    });

    [titleIn, authorIn, tagsIn, ta].forEach(function (inp) { inp.addEventListener('input', changed); });

    function toggleHelp(force) {
      var show = force === undefined ? helpPanel.hidden : force;
      helpPanel.hidden = !show;
      helpBtn.setAttribute('aria-expanded', String(show));
    }
    var helpBtn = D.button('Format help', function () { toggleHelp(); }, { icon: 'help' });
    helpBtn.setAttribute('aria-expanded', 'false');

    var mode = 'text';
    var paneToggle = h('div', { class: 'pane-toggle', role: 'tablist', 'aria-label': 'Editor panes' },
      h('button', { type: 'button', role: 'tab', class: 'btn btn-small is-on', 'aria-selected': 'true', on: { click: function () { setMode('text'); } } }, 'Text'),
      h('button', { type: 'button', role: 'tab', class: 'btn btn-small', 'aria-selected': 'false', on: { click: function () { setMode('preview'); } } }, 'Preview'));
    function setMode(m) {
      mode = m;
      el.classList.toggle('show-preview', m === 'preview');
      Array.prototype.forEach.call(paneToggle.children, function (b, i) {
        var on = (i === 0) === (m === 'text');
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });
      if (m === 'preview') renderPreview();
    }

    function done() {
      save();
      if (created) ctx.router.navigate('/song/' + encodeURIComponent(id));
      else ctx.router.navigate('/library');
    }

    var deleteBtn = D.button('Delete', function () {
      if (!created) { dirty = false; ctx.router.navigate('/library'); return; }
      ctx.ui.confirm({ title: 'Delete this song?', message: '“' + fields().title + '” will be removed from your library and from every set list. This cannot be undone, unless you have a backup.', okLabel: 'Delete', danger: true })
        .then(function (yes) {
          if (!yes) return;
          dirty = false;
          if (saveTimer) clearTimeout(saveTimer);
          ctx.actions.deleteSong(id);
          ctx.router.navigate('/library');
        });
    }, { icon: 'trash', danger: true, title: isNew ? 'Discard' : 'Delete this song' });

    var snippets = h('div', { class: 'snippet-bar', role: 'toolbar', 'aria-label': 'Insert' },
      h('button', { type: 'button', class: 'btn btn-small', title: 'Insert a chord [ ] (or wrap the selection)', on: { click: wrapChord } }, '[ ]'),
      h('button', { type: 'button', class: 'btn btn-small', title: 'Indent the selected lines as a chorus', on: { click: function () { indentLines(false); } } }, 'Chorus ⇥'),
      h('button', { type: 'button', class: 'btn btn-small', title: 'Remove the chorus indent', on: { click: function () { indentLines(true); } } }, '⇤'),
      h('button', { type: 'button', class: 'btn btn-small', title: 'Make this line a comment', on: { click: function () { prefixLine('# '); } } }, '# Comment'),
      shortcutToggle);

    var el = h('section', { class: 'view view-edit' },
      h('div', { class: 'toolbar editor-toolbar' },
        h('div', { class: 'toolbar-row' },
          D.button('Done', done, { primary: true, icon: 'check', title: 'Save and view the song' }),
          status,
          h('span', { class: 'spacer' }),
          paneToggle,
          helpBtn,
          deleteBtn)),
      h('div', { class: 'editor-fields' },
        h('label', { class: 'field field-title' }, h('span', { class: 'field-label' }, 'Title'), titleIn, dupNote),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Author'), authorIn),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), tagsIn)),
      h('div', { class: 'editor-panes' },
        h('div', { class: 'pane pane-text' }, snippets, ta),
        h('div', { class: 'pane pane-preview' }, previewBar, preview),
        helpPanel));

    function onUnload() { save(); }
    root.addEventListener('beforeunload', onUnload);
    root.addEventListener('pagehide', onUnload);

    if (isNew && route.query.help === '1') toggleHelp(true);
    renderPreview();
    checkDuplicate();
    setStatus(existing ? 'Saved ' + D.formatDate(existing.updatedAt) : 'New song', existing ? 'ok' : '');

    return {
      el: el,
      title: isNew ? 'New song' : 'Edit – ' + initial.title,
      focus: function () { (isNew ? titleIn : ta).focus(); },
      onKey: function (e) {
        if (e.key === 'Escape' && !D.isTyping(e)) { done(); return true; }
        return false;
      },
      destroy: function () {
        save();
        root.removeEventListener('beforeunload', onUnload);
        root.removeEventListener('pagehide', onUnload);
      }
    };
  };
  S.views['new'] = S.views.edit;
})(typeof globalThis !== 'undefined' ? globalThis : this);
