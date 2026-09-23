/* Songsheets — turns a docxModel into a .docx with the docx library (vendor/docx.umd.js, loaded by
 * exportMenu through vendorLoader: this file is listed before vendorLoader.js and never loads it).
 *
 * exportDocx(sheets, opts, docx) -> Promise<{blob}>          docx = the UMD global
 * buildDocxBuffer(sheets, opts, docx) -> Promise<Buffer>     (Node: tests and samples)
 * buildDocument(model, docx) -> docx.Document
 * Browser: window.SongSheets.export.docxExport   Node: require('./docxExport.js')
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var DM = isNode ? require('./docxModel.js') : root.SongSheets.export.docxModel;

  function check(docx) {
    if (!docx || typeof docx.Document !== 'function' || !docx.Packer) throw new Error('The Word library did not load (vendor/docx.umd.js).');
    return docx;
  }

  function styles(model) {
    var f = model.fonts;
    var s = model.sizes;
    return {
      default: { document: { run: { font: f.text } } },
      paragraphStyles: [
        { id: 'SongTitle', name: 'Song Title', basedOn: 'Normal', next: 'SongMeta', quickFormat: true,
          run: { font: f.text, size: s.title, bold: true }, paragraph: { spacing: { before: 0, after: 60 }, keepNext: true } },
        { id: 'SongMeta', name: 'Song Details', basedOn: 'Normal',
          run: { font: f.text, size: s.meta, color: model.colors.meta }, paragraph: { spacing: { before: 0, after: 40 }, keepNext: true } },
        { id: 'SongMono', name: 'Song Line', basedOn: 'Normal',
          run: { font: f.mono, size: s.mono }, paragraph: { spacing: { before: 0, after: 0, line: 240 } } },
        { id: 'SongComment', name: 'Song Comment', basedOn: 'Normal',
          run: { font: f.text, size: s.comment, color: model.colors.comment, italics: true }, paragraph: { spacing: { before: 40, after: 40 } } },
        { id: 'SongContents', name: 'Song Contents', basedOn: 'Normal',
          run: { font: f.text, size: s.toc }, paragraph: { spacing: { before: 0, after: 60 } } }
      ]
    };
  }

  function runsOf(docx, runs, extra) {
    return runs.filter(function (r) { return r.text; }).map(function (r) {
      var o = { text: r.text };
      if (r.bold) o.bold = true;
      if (r.italic) o.italics = true;
      for (var k in extra) o[k] = extra[k];
      return new docx.TextRun(o);
    });
  }

  function songParagraph(docx, model, p) {
    if (p.kind === 'blank') return new docx.Paragraph({ style: 'SongMono', children: [] });
    if (p.kind === 'comment') {
      return new docx.Paragraph({ style: 'SongComment', keepNext: p.keepNext, indent: { left: p.left }, children: runsOf(docx, p.runs, {}) });
    }
    if (p.kind === 'chord') {
      var chord = { color: model.colors.chord };
      if (model.chordBold) chord.bold = true;
      return new docx.Paragraph({ style: 'SongMono', keepNext: true, keepLines: true, indent: { left: p.left }, children: runsOf(docx, p.runs, chord) });
    }
    var opts = { style: 'SongMono', keepNext: p.keepNext, keepLines: true, indent: { left: p.left }, children: runsOf(docx, p.runs, {}) };
    if (p.number) {
      // the number hangs in the gutter; the tab reaches the lyric column
      opts.indent = { left: p.left, hanging: p.left };
      opts.tabStops = [{ type: docx.TabStopType.LEFT, position: p.left }];
      opts.children = [new docx.TextRun(p.number), new docx.TextRun({ children: [new docx.Tab()] })].concat(opts.children);
    }
    return new docx.Paragraph(opts);
  }

  function buildDocument(model, docx) {
    check(docx);
    var children = [];
    if (model.toc) {
      children.push(new docx.Paragraph({ style: 'SongTitle', children: [new docx.TextRun(model.toc.title)] }));
      model.toc.entries.forEach(function (e) {
        var kids = [new docx.InternalHyperlink({ anchor: e.bookmark, children: [new docx.TextRun({ text: e.number + '. ' + e.title, style: 'Hyperlink' })] })];
        if (e.meta) kids.push(new docx.TextRun({ text: '   ' + e.meta, color: model.colors.meta }));
        children.push(new docx.Paragraph({ style: 'SongContents', children: kids }));
      });
    }
    model.songs.forEach(function (song) {
      children.push(new docx.Paragraph({
        style: 'SongTitle',
        pageBreakBefore: song.pageBreakBefore,
        children: [new docx.Bookmark({ id: song.bookmark, children: [new docx.TextRun(song.title)] })]
      }));
      if (song.meta) children.push(new docx.Paragraph({ style: 'SongMeta', children: [new docx.TextRun(song.meta)] }));
      if (song.tune) children.push(new docx.Paragraph({ style: 'SongMeta', children: [new docx.TextRun(song.tune)] }));
      children.push(new docx.Paragraph({ style: 'SongMeta', keepNext: true, children: [] }));
      song.paragraphs.forEach(function (p) { children.push(songParagraph(docx, model, p)); });
    });
    var footerRun = [docx.PageNumber.CURRENT, ' / ', docx.PageNumber.TOTAL_PAGES];
    if (model.footer.text) footerRun = [model.footer.text + '   '].concat(footerRun);
    var props = {
      creator: 'songsheets',
      title: model.title,
      styles: styles(model),
      sections: [{
        properties: {
          page: {
            size: { width: model.page.width, height: model.page.height },
            margin: model.page.margin
          }
        },
        footers: {
          default: new docx.Footer({
            children: [new docx.Paragraph({
              alignment: docx.AlignmentType.CENTER,
              children: [new docx.TextRun({ children: footerRun, size: model.sizes.footer, color: model.colors.footer })]
            })]
          })
        },
        children: children
      }]
    };
    if (model.author) props.description = 'By ' + model.author;
    return new docx.Document(props);
  }

  function buildDocxBuffer(sheets, opts, docx) {
    return Promise.resolve().then(function () {
      return check(docx).Packer.toBuffer(buildDocument(DM.buildDocxModel(sheets, opts), docx));
    });
  }

  function exportDocx(sheets, opts, docx) {
    return Promise.resolve().then(function () {
      return check(docx).Packer.toBlob(buildDocument(DM.buildDocxModel(sheets, opts), docx));
    }).then(function (blob) { return { blob: blob }; });
  }

  var api = {
    exportDocx: exportDocx,
    buildDocxBuffer: buildDocxBuffer,
    buildDocument: buildDocument
  };
  root.SongSheets = root.SongSheets || {};
  root.SongSheets.export = root.SongSheets.export || {};
  root.SongSheets.export.docxExport = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
