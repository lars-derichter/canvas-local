const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectContentType, MIME_TYPES } = require('../../lib/canvas/files');

describe('detectContentType', () => {
  it('detects common image types', () => {
    assert.equal(detectContentType('photo.png'), 'image/png');
    assert.equal(detectContentType('photo.jpg'), 'image/jpeg');
    assert.equal(detectContentType('photo.jpeg'), 'image/jpeg');
    assert.equal(detectContentType('icon.svg'), 'image/svg+xml');
    assert.equal(detectContentType('anim.gif'), 'image/gif');
    assert.equal(detectContentType('img.webp'), 'image/webp');
  });

  it('detects document types', () => {
    assert.equal(detectContentType('doc.pdf'), 'application/pdf');
    assert.equal(detectContentType('doc.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(detectContentType('sheet.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(detectContentType('slides.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  it('detects text and code types', () => {
    assert.equal(detectContentType('file.txt'), 'text/plain');
    assert.equal(detectContentType('style.css'), 'text/css');
    assert.equal(detectContentType('page.html'), 'text/html');
    assert.equal(detectContentType('app.js'), 'text/javascript');
    assert.equal(detectContentType('data.json'), 'application/json');
    assert.equal(detectContentType('data.csv'), 'text/csv');
  });

  it('detects archive types', () => {
    assert.equal(detectContentType('archive.zip'), 'application/zip');
    assert.equal(detectContentType('archive.gz'), 'application/gzip');
    assert.equal(detectContentType('archive.tar'), 'application/x-tar');
  });

  it('detects media types', () => {
    assert.equal(detectContentType('video.mp4'), 'video/mp4');
    assert.equal(detectContentType('audio.mp3'), 'audio/mpeg');
    assert.equal(detectContentType('audio.wav'), 'audio/wav');
  });

  it('handles case-insensitive extensions', () => {
    assert.equal(detectContentType('IMAGE.PNG'), 'image/png');
    assert.equal(detectContentType('DOC.PDF'), 'application/pdf');
  });

  it('returns octet-stream for unknown extensions', () => {
    assert.equal(detectContentType('file.xyz'), 'application/octet-stream');
    assert.equal(detectContentType('noext'), 'application/octet-stream');
  });

  it('handles full paths', () => {
    assert.equal(detectContentType('/path/to/file.png'), 'image/png');
    assert.equal(detectContentType('some/nested/dir/doc.pdf'), 'application/pdf');
  });
});

describe('MIME_TYPES', () => {
  it('contains entries for all common extensions', () => {
    const expectedExtensions = [
      '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.mp4', '.mp3', '.zip', '.json', '.csv', '.txt', '.html',
    ];
    for (const ext of expectedExtensions) {
      assert.ok(MIME_TYPES[ext], `Missing MIME type for ${ext}`);
    }
  });
});
