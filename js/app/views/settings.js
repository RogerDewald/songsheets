/* Songsheets — Settings (#/settings) and Help (#/help). */
(function (root) {
  'use strict';
  var S = root.SongSheets;
  var D = S.dom;
  var h = D.h;

  function radioGroup(name, options, value, onChange) {
    return h('div', { class: 'radio-group', role: 'radiogroup' }, options.map(function (o) {
      return h('label', { class: 'radio' },
        h('input', { type: 'radio', name: name, value: o.value, checked: o.value === value, on: { change: function () { onChange(o.value); } } }),
        ' ', o.label);
    }));
  }

  function section(title, desc) {
    var children = Array.prototype.slice.call(arguments, 2);
    return h('section', { class: 'settings-section' }, h('h2', null, title), desc ? h('p', { class: 'muted small' }, desc) : null, children);
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' bytes';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  S.views = S.views || {};
  S.views.settings = function (ctx) {
    var body = h('div', { class: 'settings-body' });
    var restoreInput = h('input', {
      type: 'file', class: 'visually-hidden', tabindex: '-1', accept: '.json,.html,.htm',
      on: { change: function () { if (restoreInput.files.length) ctx.actions.importFiles(restoreInput.files, { askReplace: true, includeSettings: true }); restoreInput.value = ''; } }
    });

    function render() {
      var st = ctx.store.get();
      var s = st.settings;
      var up = function (patch) { ctx.actions.updateSettings(patch); };
      var nSongs = Object.keys(st.songs).length;
      var nSets = Object.keys(st.sets).length;
      D.replaceChildren(body,
        section('Appearance', null,
          h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Theme'),
            radioGroup('theme', [{ value: 'auto', label: 'Match my device' }, { value: 'light', label: 'Light' }, { value: 'night', label: 'Night' }], s.theme, function (v) { up({ theme: v }); })),
          h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Text size'),
            h('div', { class: 'ctl-group' },
              D.iconButton('minus', 'Smaller', function () { up({ fontScale: Math.max(0.7, Math.round((s.fontScale - 0.1) * 10) / 10) }); }),
              h('span', { class: 'setting-value' }, Math.round(s.fontScale * 100) + '%'),
              D.iconButton('plus', 'Larger', function () { up({ fontScale: Math.min(2.2, Math.round((s.fontScale + 0.1) * 10) / 10) }); }),
              s.fontScale !== 1 ? D.button('Reset', function () { up({ fontScale: 1 }); }, { class: 'btn-small btn-ghost' }) : null)),
          h('label', { class: 'check setting' },
            h('input', { type: 'checkbox', checked: s.showChords, on: { change: function (e) { up({ showChords: e.target.checked }); } } }),
            ' Show chords'),
          h('label', { class: 'check setting' },
            h('input', { type: 'checkbox', checked: s.keepAwake !== false, on: { change: function (e) { up({ keepAwake: e.target.checked }); } } }),
            ' Keep the screen on while a song is open'),
          !('wakeLock' in navigator) ? h('p', { class: 'muted small' }, 'This browser cannot keep the screen on; change your phone’s auto-lock setting instead.') : null),
        section('Chords', 'Songs follow this unless you pick sharps or flats on the song itself.',
          h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Sharps and flats'),
            radioGroup('acc', [{ value: 'auto', label: 'Automatic (by key)' }, { value: 'sharp', label: 'Prefer sharps ♯' }, { value: 'flat', label: 'Prefer flats ♭' }], s.accidentals, function (v) { up({ accidentals: v }); })),
          h('label', { class: 'check setting' },
            h('input', { type: 'checkbox', checked: s.editorShortcuts !== false, on: { change: function (e) { up({ editorShortcuts: e.target.checked }); } } }),
            ' Editor shortcuts: \\ or $ inserts [], and chord letters are capitalised')),
        section('Printing and PDF', null,
          h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Paper size'),
            radioGroup('paper', [{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'US Letter' }], s.pageSize, function (v) { up({ pageSize: v }); })),
          h('label', { class: 'setting' }, h('span', { class: 'setting-label' }, 'Chord colour'),
            h('input', { type: 'color', value: s.chordColor, class: 'color-input', on: { change: function (e) { up({ chordColor: e.target.value }); } } }),
            s.chordColor.toLowerCase() !== '#1f45ff' ? D.button('Reset', function () { up({ chordColor: '#1f45ff' }); }, { class: 'btn-small btn-ghost' }) : null),
          h('label', { class: 'check setting' },
            h('input', { type: 'checkbox', checked: s.printBw, on: { change: function (e) { up({ printBw: e.target.checked }); } } }),
            ' Black and white (bold black chords)')),
        section('Your data', 'Songs are stored only in this browser (' + nSongs + ' song' + (nSongs === 1 ? '' : 's') + ', ' + nSets + ' set list' + (nSets === 1 ? '' : 's') + ', about ' + formatBytes(S.storage.usageBytes(ctx.ls)) + ' of roughly 5 MB). Clearing browser data deletes them, so download a backup now and then.',
          (function () {
            var info = ctx.actions.storageInfo ? ctx.actions.storageInfo() : { supported: false };
            var lines = [];
            lines.push('Last backup: ' + (s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString() : 'never') + '.');
            if (info.persisted) lines.push('This browser has agreed to keep your songs even when space runs low.');
            else if (info.platform === 'ios' && !info.standalone) lines.push('On iPhone and iPad, Safari can delete songs from sites you have not opened for 7 days. Add Songsheets to your Home Screen to keep them, and move your songs there with a backup.');
            else lines.push('The browser may clear this storage if the device runs low on space. Installing the app makes that less likely.');
            return h('p', { class: 'small' }, lines.join(' '));
          })(),
          h('div', { class: 'button-row' },
            ctx.store.get().installable ? D.button('Install app', function () { ctx.actions.install(); }, { icon: 'download' }) : null,
            D.button('Download backup', function () { ctx.actions.exportBackup(); }, { primary: true, icon: 'download' }),
            D.button('Restore from backup', function () { restoreInput.click(); }, { icon: 'upload' }),
            restoreInput),
          ctx.loadWarning ? h('p', { class: 'field-note warn' }, ctx.loadWarning) : null,
          ctx.rawData ? D.button('Download the unreadable saved data', function () { ctx.actions.downloadRaw(); }, { icon: 'download' }) : null),
        section('Reset', null,
          D.button('Delete everything', function () {
            ctx.ui.confirm({ title: 'Delete all songs, set lists and settings?', message: 'This removes everything Songsheets stored in this browser. Download a backup first if you might want it back.', okLabel: 'Delete everything', danger: true })
              .then(function (yes) {
                if (!yes) return;
                return ctx.ui.confirm({ title: 'Really delete everything?', message: nSongs + ' songs and ' + nSets + ' set lists will be gone.', okLabel: 'Yes, delete', danger: true });
              })
              .then(function (yes) { if (yes) ctx.actions.resetApp(); });
          }, { danger: true, icon: 'trash' })),
        section('About', null,
          h('p', null, 'Songsheets ' + ctx.version + '. Runs entirely in your browser, with no server and no account.'),
          h('p', null, 'The song format, chord layout and transposition tables come from ',
            h('a', { href: 'https://github.com/ReganRyanNZ/songbase', target: '_blank', rel: 'noopener noreferrer' }, 'songbase'),
            ' by Regan Ryan (MIT licence). PDF export uses jsPDF and Word export uses docx (both MIT).')));
    }
    render();
    var unsub = ctx.store.subscribe(function (st, p) { if (p.settings || p.songs || p.sets) D.keepFocus(body, render); });
    var el = h('section', { class: 'view view-settings' },
      h('div', { class: 'toolbar' }, h('div', { class: 'toolbar-row' }, h('h1', { class: 'view-title' }, 'Settings'))), body);
    return { el: el, title: 'Settings', destroy: unsub };
  };

  S.views.help = function (ctx) {
    function row(code, text) { return [h('dt', null, h('code', null, code)), h('dd', null, text)]; }
    function key(k, text) { return h('li', null, h('kbd', null, k), ' ', text); }
    var el = h('section', { class: 'view view-help' },
      h('div', { class: 'toolbar' }, h('div', { class: 'toolbar-row' }, h('h1', { class: 'view-title' }, 'Help'))),
      h('div', { class: 'help-body' },
        h('h2', null, 'Writing a song'),
        h('p', null, 'Songs are plain text in the songbase format. Chords go in square brackets right before the syllable where they change.'),
        h('dl', { class: 'help-list' },
          row('A[G]mazing [C]grace', 'Chords sit exactly above the letter after the bracket, even in the middle of a word.'),
          row('  two spaces', 'Lines starting with two spaces form a chorus.'),
          row('1', 'A number on its own line numbers the stanza below it.'),
          row('# comment', 'Grey comment text.'),
          row('# Capo 2', 'A capo preset. Tap it to show the sounding chords.'),
          row('# Key: Em', 'Sets the key when it cannot be guessed from the chords.'),
          row('### Tune name', 'Starts an alternative tune.'),
          row('**bold** *italic* a_b', 'Bold, italic, and a musical tie between words.'),
          row('[F#m  Bm] [N.C.] [x2]', 'Several chords at one spot; non-chords are never transposed.')),
        h('p', null, D.button('Open the formatting example', function () { ctx.actions.openFormatExample(); }, { icon: 'file' })),
        h('h2', null, 'Transposing'),
        h('p', null, 'Use − and + or pick a key in the song toolbar. The key is remembered for each song. In a set list each song can have its own key and capo; with a capo the sheet shows the chord shapes to play.'),
        h('h2', null, 'Exporting'),
        h('p', null, 'The Export menu prints (or saves as PDF through the print dialog), downloads a PDF directly, makes a Word document, a plain-text chord chart, a ChordPro file, songbase text, a stand-alone web page, or a JSON backup. A set list exports as one document with a contents page.'),
        h('h2', null, 'Keyboard shortcuts'),
        h('ul', { class: 'help-shortcuts' },
          key('/', 'search the library'),
          key('N', 'new song'),
          key('E', 'edit the open song'),
          key('C', 'show or hide chords'),
          key('+ / −', 'transpose up or down'),
          key('0', 'back to the written key'),
          key('[ / ]', 'previous or next song in a set (also ← →)'),
          key('Esc', 'go back'),
          key('?', 'this help')),
        h('h2', null, 'Where are my songs?'),
        h('p', null, 'Everything is saved in this browser only. Use Settings → Download backup to keep a copy or move to another device, and Import in the library to bring songs in.')));
    return { el: el, title: 'Help', destroy: function () {} };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
