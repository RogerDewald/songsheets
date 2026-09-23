/* Songsheets — example songs for an empty library. All text is original or public domain.
 * Browser: window.SongSheets.examples
 */
(function (root) {
  'use strict';

  var FORMAT_GUIDE = [
    '# Lines that start with # are comments. They show in grey.',
    '# A comment such as "Capo 2" becomes a button that shows the sounding chords:',
    '# Capo 2',
    '',
    'Put [C]chords in [Am]square brackets ex[F]actly where they [G]change,',
    'Even in the [E7]middle of a w[C]ord.',
    '',
    '  Chorus lines start',
    '  with [F]two spaces,',
    '  like [G]these.',
    '',
    '1',
    'A number on its own line',
    'Is the number of the stanza below it.',
    '',
    '2',
    'Use **two stars** for bold and *one star* for italic,',
    'And an under_score to join two words for singing.',
    '',
    '# Key: C',
    '# A "Key:" comment tells the transposer which key the song is in.',
    '# To add another tune, start a line with three # signs and the tune name.',
    '# While editing, type \\ or $ to insert [] for a chord.'
  ].join('\n');

  var AMAZING_GRACE = [
    '# Words: John Newton (1779), public domain',
    '',
    '1',
    'A[G]mazing grace, how [C]sweet the [G]sound',
    'That saved a wretch like [D]me;',
    'I [G]once was lost, but [C]now am [G]found,',
    'Was [Em]blind, but [D]now I [G]see.',
    '',
    '2',
    '’Twas [G]grace that taught my [C]heart to [G]fear,',
    'And grace my fears re[D]lieved;',
    'How [G]precious did that [C]grace ap[G]pear',
    'The [Em]hour I [D]first be[G]lieved.',
    '',
    '3',
    'Through [G]many dangers, [C]toils and [G]snares,',
    'I have already [D]come;',
    '’Tis [G]grace hath brought me [C]safe thus [G]far,',
    'And [Em]grace will [D]lead me [G]home.'
  ].join('\n');

  var MORNING_LIGHT = [
    '### Original tune',
    '# Capo 3',
    '',
    '1',
    '[G]Morning light is [C]on the [G]hill,',
    'The [Em]river running [D]slow and still;',
    '[G]All the fields are [C]wide a[G]wake,',
    'And [C]every [D]bird sings [G]for its sake.',
    '',
    '  [C]Sing, sing, the [G]day is new,',
    '  [Am]Every [D]hour a [G]gift to you.',
    '',
    '2',
    'Evening comes with amber skies,',
    'The lantern glow, the swallows rise;',
    'Rest will come to all at last,',
    'When all the busy hours are past.',
    '',
    '### Second tune',
    '',
    '1',
    '[D]Morning light is [G]on the [D]hill,',
    'The [Bm]river running [A]slow and still;',
    '[D]All the fields are [G]wide a[D]wake,',
    'And [G]every [A]bird sings [D]for its sake.'
  ].join('\n');

  root.SongSheets = root.SongSheets || {};
  root.SongSheets.examples = [
    { title: 'How to format a song', author: 'Songsheets', tags: ['help'], lyrics: FORMAT_GUIDE },
    { title: 'Amazing Grace', author: 'John Newton', tags: ['hymn', 'public domain'], lyrics: AMAZING_GRACE },
    { title: 'Morning Light', author: 'Songsheets example', tags: ['example'], lyrics: MORNING_LIGHT }
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
