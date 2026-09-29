/* Songsheets — "Convert with AI": the prompt to paste into an AI assistant, and a forgiving reader
 * for its answer.
 *
 * PROMPT               text to paste into ChatGPT, Claude, Gemini... together with a photo, PDF or text of a music sheet
 * EXAMPLE_SHEET / EXAMPLE_REPLY   the worked example inside the prompt (tests run it through the real parser)
 * parseReply(text)     -> {title, author, text, fenced}   the song text and header lines out of a chat reply
 * analyse(text)        -> {title, author, lyrics, kind, notes[], warnings[], flags[], stats}   what the Convert page shows
 *
 * The prompt asks for Songsheets' own text format, and analyse() also copes with what assistants
 * often send instead: code fences around the song, "[Chorus]" or "Verse 2" labels, chords written above
 * the words, or ChordPro. Everything it changes is reported in notes[], and anything it had to leave out in
 * warnings[], so nothing happens silently.
 * Browser: window.SongSheets.aiConvert   Node: require('./aiConvert.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var N = isNode ? require('../core/normalize.js') : root.SongSheets.normalize;
  var C = isNode ? require('../core/chords.js') : root.SongSheets.chords;
  var P = isNode ? require('../core/parser.js') : root.SongSheets.parser;
  var M = isNode ? require('../core/sheetModel.js') : root.SongSheets.sheetModel;
  var CP = isNode ? require('../export/chordpro.js') : root.SongSheets.export.chordpro;
  var B = isNode ? require('../export/backup.js') : root.SongSheets.export.backup;

  // ---- the prompt -----------------------------------------------------------------------------

  /** A row of chord names placed at character columns, the way a printed chord sheet lines them up. */
  function row(placements) {
    var out = '';
    placements.forEach(function (p) {
      while (out.length < p[0]) out += ' ';
      out += p[1];
    });
    return out;
  }

  var EXAMPLE_SHEET = [
    'Morning Light',
    'Words and music: A. Example',
    'Capo 3',
    '',
    'Intro: G  C  G',
    '',
    '1.',
    row([[0, 'G'], [17, 'C'], [24, 'G']]),
    'Morning light is on the hill,',
    row([[4, 'Em'], [18, 'D']]),
    'The river running slow and still;',
    '',
    'Chorus',
    row([[0, 'C'], [16, 'G']]),
    'Sing, sing, the day is new,',
    row([[0, 'Am'], [6, 'D'], [13, 'G']]),
    'Every hour a gift to you.'
  ];

  var EXAMPLE_REPLY = [
    '# Title: Morning Light',
    '# Author: A. Example',
    '# Capo 3',
    '',
    '# Intro',
    '[G  C  G]',
    '',
    '1',
    '[G]Morning light is [C]on the [G]hill,',
    'The [Em]river running [D]slow and still;',
    '',
    '  [C]Sing, sing, the [G]day is new,',
    '  [Am]Every [D]hour a [G]gift to you.'
  ];

  var PROMPT = [
    'Convert the music sheet I give you (a photo, a PDF, or text pasted below) into the "Songsheets" chord-sheet format described here.',
    '',
    'HOW TO REPLY',
    'Reply with ONE code block (triple backticks) that contains only the finished song. Write nothing before or after the code block: no greeting, no explanation, no markdown outside it. If the sheet holds several songs, convert only the first one. If you cannot see a music sheet, ask me for it instead of making one up.',
    '',
    'The code block starts with these lines. Leave out a line when the sheet gives no such information:',
    '# Title: <the song title>',
    '# Author: <the names of the writer, composer or artist, without labels such as "Words:" or "Music:">',
    '# Capo <number>   <only if the sheet says to use a capo>',
    'Then a blank line, then the song.',
    '',
    'FORMAT RULES',
    '1. Write chords INSIDE the lyric line, in [square brackets], right before the syllable they are played on, with no space after the bracket: A[G]mazing [C]grace. A chord may sit in the middle of a word: ex[F]act. Each chord belongs to the syllable printed directly under it. Never put chords on their own line above the words.',
    '2. Copy the chords exactly as printed, using standard names (C, Am, F#m, Bb, G7, Cmaj7, Dsus4, G/B). Do not add, drop, simplify or "correct" chords, and do not work chords out from the notes. If the sheet prints no chords, write just the lyrics. If chords are written as Do-Re-Mi, German H/B or numbers (1 4 5), convert them to letter names.',
    '3. Chords with no words under them (an intro, an instrumental, a rest): put them together in ONE bracket, separated by two spaces, on a line of their own: [G  C  D  G]. Put a "# Intro" (or "# Instrumental") line above it.',
    '4. Copy the words exactly: same language, spelling and punctuation. Never translate, shorten, censor or improve them, and never skip lines or write "...". If a word is split over notes with hyphens (a - ma - zing), join it up again (Amazing) and put the chord before the syllable it belongs to.',
    '5. One line of text for each printed line of lyrics. Leave ONE blank line between sections (verse, chorus, bridge...). Never indent a line, except chorus lines (rule 7).',
    '6. Numbered verses ("1.", "Verse 2", "[Verse 3]"): put just the number, digits only (no dot, no word), alone on the line directly above the verse.',
    '7. Chorus or refrain: start EVERY line of it with exactly two spaces, including lines that begin with a chord. Write it out where the sheet prints it. If the sheet only says "Chorus" or "repeat chorus" without printing the words again, write a comment line instead: # Chorus',
    '8. If verses share the same music and the chords are printed only above the first verse, repeat those chords on the later verses, on the same beats, so every verse has chords.',
    '9. Anything that is not lyrics or chords (section names such as Bridge or Outro, directions such as "repeat x2" or "slowly", and anything you are unsure about) goes on a comment line that starts with "# " at the very start of the line, for example: # Bridge. Use square brackets ONLY for chords. Never start a line with ## or ###, and use no other markdown (no bold, no bullet lists).',
    '10. Ignore tablature, staff notation, fingering diagrams, strumming patterns, page numbers and copyright lines. Do not use the characters * or _ in the text.',
    '11. If a word or chord is hard to read, give your best reading and put a line "# Check: <what you are unsure about>" above the whole verse or chorus it is in (above the verse number, or above the first chorus line), never inside it. Do not mention a capo or a key in it.',
    '',
    'EXAMPLE (only to show the format; do not repeat it in your reply)',
    'The sheet shows:',
    EXAMPLE_SHEET.join('\n'),
    '',
    'Your whole reply would be:',
    '```',
    EXAMPLE_REPLY.join('\n'),
    '```',
    '',
    'Before you reply, check: one code block only; "# Title:" comes first; chords are inline, in [brackets], before the syllable; one blank line between sections; chorus lines start with two spaces; no line starts with ## or ###.',
    '',
    'The music sheet is attached to this message, or pasted below this line:',
    ''
  ].join('\n');

  // ---- reading the answer ---------------------------------------------------------------------

  // A fence is nothing but the fence and, at most, one word of language: "~~~ Interlude ~~~" is a lyric line.
  var FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w.+#-]*)[ \t]*$/;
  var BRACKETED_RE = /\[[^\]\n]*\]/;
  var PROMPT_LINES = {};
  var EXAMPLE_TEXT = EXAMPLE_REPLY.join('\n');
  PROMPT.split('\n').forEach(function (l) { if (l.trim()) PROMPT_LINES[l] = true; });

  /** Fenced code blocks: [{lang, lines, start, end, closed}], start and end being the fence lines' indexes. */
  function fencedBlocks(lines) {
    var blocks = [];
    var open = null;
    for (var i = 0; i < lines.length; i++) {
      var m = FENCE_RE.exec(lines[i]);
      if (!open) {
        if (m) open = { fence: m[1], lang: m[2] || '', start: i, lines: [] };
      } else if (m && !m[2] && m[1].charAt(0) === open.fence.charAt(0) && m[1].length >= open.fence.length) {
        open.end = i;
        open.closed = true;
        blocks.push(open);
        open = null;
      } else {
        open.lines.push(lines[i]);
      }
    }
    if (open) { open.end = lines.length; open.closed = false; blocks.push(open); }   // never closed
    return blocks;
  }

  function nonBlank(l) { return l.trim() !== ''; }

  /** A block that never closed counts only when it opens at the top, after at most a little chatter: a reply that
   *  was cut off. A stray fence-like line inside a pasted song must not swallow what comes before it. */
  function credible(block, lines) {
    if (block.closed) return true;
    var before = lines.slice(0, block.start).filter(nonBlank);
    return before.length <= 6 && !before.some(function (l) { return BRACKETED_RE.test(l); });
  }

  function songLike(lines) {
    return lines.filter(nonBlank).length >= 2 || lines.some(function (l) { return BRACKETED_RE.test(l); });
  }

  // Only the two headers the prompt asks for (and the names assistants use for them). Credit comments such as
  // "# Words: J. Newton" or "# Composer: Bach" are ordinary comments in real songs and must stay in the text.
  var HEADER_RE = /^(title|song title|author|artist)\s*[:=]\s*(.*)$/i;
  var NO_VALUE = /^(<[^>]*>|unknown|n\/a|none|not given|not stated|-+|\u2013|\u2014)$/i;   // an empty answer, or a prompt placeholder copied back

  /** "# Title: X", "**Author:** Y" or "Title: X" -> {field: 'title'|'author', value: string|null}, or null.
   *  A header with no real value (empty, "Unknown", "<the song title>") still counts, so its line is dropped. */
  function headerField(line) {
    var t = String(line).replace(/^\s*#+\s*/, '').replace(/\*\*|__/g, '').trim();
    var m = HEADER_RE.exec(t);
    if (!m) return null;
    var value = m[2].trim();
    return { field: /^(title|song title)$/i.test(m[1]) ? 'title' : 'author', value: !value || NO_VALUE.test(value) ? null : value };
  }

  function addAuthor(current, value) {
    if (!current) return value;
    return current.toLowerCase().indexOf(value.toLowerCase()) >= 0 ? current : current + ', ' + value;
  }

  var CREDIT_LABEL_RE = /\b(?:(?:words\s*(?:and|&)\s*music|words|music|lyrics|written|arranged|composed)\s+by\s*:?|(?:words\s*(?:and|&)\s*music|words|lyrics|lyricist|music|composer|author|artist)\s*:)\s*/gi;

  /** "Words: A. Example · Music: traditional" -> "A. Example, traditional" (assistants copy the credit line as printed). */
  function cleanAuthor(value) {
    if (!value) return value;
    var s = value.replace(CREDIT_LABEL_RE, '').replace(/\s*[·•|;]\s*/g, ', ').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
    return s || null;
  }

  /** "# Key: <...>" or "# Capo <number>" copied back from the prompt with the placeholder still in it. */
  function isPlaceholderLine(line) {
    return /^\s*#\s*(key|capo)\b.*<[^>]*>/i.test(line);
  }

  /** Header lines at the top of the song text (only there). Returns {title, author, rest}. */
  function takeHeader(lines) {
    var title = null;
    var author = null;
    var drop = {};
    for (var i = 0; i < lines.length && i < 14; i++) {
      var l = lines[i];
      if (l.trim() === '') continue;
      var f = headerField(l);
      if (f) {
        if (f.value !== null) {
          if (f.field === 'title') { if (title === null) title = f.value; } else author = addAuthor(author, f.value);
        }
        drop[i] = true;
      } else if (isPlaceholderLine(l)) {
        drop[i] = true;
      } else if (!/^\s*#/.test(l)) {
        break;                                    // the first real line of the song
      }
    }
    return { title: title, author: author, rest: lines.filter(function (l, i) { return !drop[i]; }) };
  }

  /** Header lines anywhere in some chatter that came before the code block. */
  function scanHeader(lines) {
    var title = null;
    var author = null;
    lines.forEach(function (l) {
      var f = headerField(l);
      if (!f || f.value === null) return;
      if (f.field === 'title') { if (title === null) title = f.value; } else author = addAuthor(author, f.value);
    });
    return { title: title, author: author };
  }

  /** The song text (and its title and author, when given) from a chat reply or a pasted song.
   *  Also reports what it left out: ignoredBlocks (other code blocks that look like song text) and
   *  outsideChords (chords in the chatter around the chosen block), so the caller can say so. */
  function parseReply(input) {
    var raw = N.normalizeLineEndings(input == null ? '' : String(input)).replace(/^\ufeff/, '');
    var lines = raw.split('\n');
    var blocks = fencedBlocks(lines).filter(function (b) { return credible(b, lines); });
    // a copied chat includes the prompt's own worked example: never take it for the reply
    var real = blocks.filter(function (b) { return b.lines.join('\n').trim() !== EXAMPLE_TEXT; });
    if (real.length) blocks = real;
    var fenced = blocks.length > 0;
    var body = lines;
    var before = [];
    var ignoredBlocks = 0;
    var outsideChords = false;
    if (fenced) {
      var best = blocks[0];
      blocks.forEach(function (b) { if (b.lines.length >= best.lines.length) best = b; });
      body = best.lines;
      before = lines.slice(0, best.start);
      blocks.forEach(function (b) { if (b !== best && songLike(b.lines)) ignoredBlocks++; });
      outsideChords = lines.some(function (l, i) {
        return BRACKETED_RE.test(l) && !PROMPT_LINES[l] && !blocks.some(function (b) { return i >= b.start && i <= b.end; });
      });
    } else {
      body = lines.filter(function (l) { return !FENCE_RE.test(l); });
    }
    var head = takeHeader(body);
    var title = head.title;
    var author = head.author;
    if (fenced && (title === null || author === null)) {
      var outside = scanHeader(before.slice(-12));
      if (title === null) title = outside.title;
      if (author === null) author = outside.author;
    }
    return { title: title, author: cleanAuthor(author), text: head.rest.join('\n'), fenced: fenced, ignoredBlocks: ignoredBlocks, outsideChords: outsideChords };
  }

  // ---- tidying up section labels --------------------------------------------------------------

  var SECTION_RE = /^(intro|verse|chorus|pre[- ]?chorus|refrain|bridge|outro|tag|interlude|instrumental|ending|coda|solo|turnaround|vamp|hook)(?:\s*#?\s*(\d{1,2}))?(?:\s*\(?\s*x\s*(\d+)\s*\)?)?$/i;

  function sentence(word) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  /** "[Chorus]", "Verse 2:", "**Bridge**", "## Outro" or "1." on a line of its own -> the Songsheets way, or null. */
  function tidyLine(line) {
    var t = line.trim();
    if (!t) return null;
    var num = /^\(?(\d{1,2})[.):]\)?$/.exec(t);
    if (num) return num[1];
    if (/^#(?!#)/.test(t)) return null;           // already a comment
    var bracketed = /^\[[^\]]*\]\s*:?$/.test(t);
    if (!bracketed && /[[\]]/.test(t)) return null;
    var s = t.replace(/^#{2,}\s*/, '').replace(/^\[\s*|\s*\]\s*:?$/g, '').replace(/^[*_]+|[*_]+$/g, '').replace(/[\s:.\-]+$/, '').trim();
    if (s.length > 30) return null;
    var m = SECTION_RE.exec(s);
    if (!m) return null;
    if (bracketed && C.isChordToken(s)) return null;
    var word = /^pre/i.test(m[1]) ? 'Pre-chorus' : sentence(m[1]);
    if (/^verse$/i.test(m[1]) && m[2]) return String(parseInt(m[2], 10));
    return '# ' + word + (m[2] ? ' ' + parseInt(m[2], 10) : '') + (m[3] ? ' (x' + m[3] + ')' : '');
  }

  /** Fix labels assistants like to write; returns {text, changed}. */
  function tidyLabels(text) {
    var changed = 0;
    var out = N.splitLines(text).map(function (l) {
      // an assistant's "# Check: capo 2 or 3?" would be read as a capo setting: put a word between capo and its number
      if (/^\s*#\s*check\s*:/i.test(l)) return l.replace(/\bcapo\s*:?\s*(\d)/gi, 'capo number $1');
      var fixed = tidyLine(l);
      if (fixed === null || fixed === l.trim()) return l;
      changed++;
      return fixed;
    });
    // "# Verse 2" written as a comment right above the verse: the stanza number is what Songsheets wants
    // (unless a number is already there, or a blank line would separate the number from its verse)
    for (var i = 0; i < out.length; i++) {
      var m = /^#\s*verse\s*#?\s*(\d{1,2})\s*:?\s*$/i.exec(out[i].trim());
      var next = out[i + 1];
      if (!m || next === undefined || next.trim() === '' || /^\s*#/.test(next) || /^\s*\d+\s*$/.test(next)) continue;
      out[i] = String(parseInt(m[1], 10));
      changed++;
    }
    return { text: out.join('\n'), changed: changed };
  }

  // ---- analysis -------------------------------------------------------------------------------

  function chordsIn(inner) {
    return C.parseChordToken(inner).filter(function (p) { return p.kind === 'chord'; }).length;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
  }

  /** Everything the Convert page needs to know about a reply or pasted song. */
  function analyse(input) {
    var notes = [];
    var warnings = [];
    var r = parseReply(input);
    var tidy = tidyLabels(r.text);
    var text = tidy.text;
    var result = { title: r.title, author: r.author, lyrics: '', kind: 'empty', notes: notes, warnings: warnings, flags: [], stats: { lines: 0, chords: 0, tunes: 0, key: null } };
    if (!text.trim()) return result;

    var kind = B.detectImport(text, 'song.txt');
    var imported = B.importAny(text, 'Untitled.txt');
    var song = imported.songs[0];
    result.kind = kind;
    if (!song) {
      warnings.push('Songsheets could not read this text as a song.');
      return result;
    }
    if (imported.songs.length > 1) warnings.push('This text holds ' + imported.songs.length + ' songs. Only the first is used. To add several at once, save them as a file and use Import.');
    if (kind === 'chordpro') {
      if (!result.title && song.title && song.title !== 'Untitled') result.title = song.title;
      if (!result.author && song.author) result.author = song.author;
      notes.push('This looks like ChordPro, so it was converted.');
    } else if (kind === 'two-line') {
      notes.push('The chords were written above the words, so they were moved into the lines.');
    }
    if (r.ignoredBlocks) warnings.push(plural(r.ignoredBlocks, 'other code block was', 'other code blocks were') + ' left out. If the song continues there, paste it as one block.');
    if (r.outsideChords) warnings.push('Some lines outside the code block contain chords and were left out.');
    if (tidy.changed) notes.push('Tidied ' + plural(tidy.changed, 'section label') + ' (such as [Chorus] or Verse 2) to match the Songsheets format.');
    result.lyrics = song.lyrics;
    // "# Check: ..." lines are the assistant's own doubts: show them where they will be seen
    N.splitLines(result.lyrics).forEach(function (l) {
      var m = /^#\s*check\s*:\s*(.+)$/i.exec(l.trim());
      if (m) result.flags.push(m[1].trim());
    });

    var ast = P.parse(result.lyrics);
    var st = result.stats;
    st.tunes = ast.tunes.length;
    ast.tunes.forEach(function (t) {
      t.blocks.forEach(function (b) {
        if (!b.lines) return;
        st.lines += b.lines.length;
        b.lines.forEach(function (l) {
          l.segments.forEach(function (s) { if (s.chord) st.chords += chordsIn(s.chord); });
        });
      });
    });
    try { st.key = M.buildSheet({ lyrics: result.lyrics }, { showChords: true }).targetKeyLabel || null; } catch (e) { st.key = null; }

    if (!st.lines) warnings.push('There is no song text yet.');
    else if (!st.chords) warnings.push('No chords were found. If your sheet has chords, ask the AI to try again and remind it to write each chord in [square brackets] right before the syllable.');
    if (st.tunes > 1) warnings.push('The text has ' + st.tunes + ' tunes, because some lines start with ###. If those lines are section names such as Chorus, change ### to #.');

    var lines = N.splitLines(result.lyrics);
    var unbalanced = lines.filter(function (l) {
      return !/^\s*#/.test(l) && (l.split('[').length !== l.split(']').length);
    }).length;
    if (unbalanced) warnings.push(plural(unbalanced, 'line has', 'lines have') + ' a square bracket without a partner. Chords need both [ and ].');
    var loose = lines.filter(function (l, i) {
      return !/^\s*#/.test(l) && !/[[\]]/.test(l) && CP.isChordLine(l, lines[i + 1]);
    }).length;
    if (loose) warnings.push(plural(loose, 'line still looks', 'lines still look') + ' like chords written above the words. Chords should sit inside the lyric lines, in [brackets].');
    return result;
  }

  var api = {
    PROMPT: PROMPT,
    EXAMPLE_SHEET: EXAMPLE_SHEET,
    EXAMPLE_REPLY: EXAMPLE_REPLY,
    parseReply: parseReply,
    tidyLabels: tidyLabels,
    analyse: analyse
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.aiConvert = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
