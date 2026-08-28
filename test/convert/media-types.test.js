const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectContentType,
  mediaKind,
} = require('../../lib/convert/media-types');

describe('mediaKind', () => {
  it('classifies image extensions', () => {
    assert.equal(mediaKind('photo.png'), 'image');
    assert.equal(mediaKind('diagram.svg'), 'image');
    assert.equal(mediaKind('img.webp'), 'image');
    assert.equal(mediaKind('img.avif'), 'image');
    assert.equal(mediaKind('scan.bmp'), 'image');
  });

  it('classifies video extensions', () => {
    assert.equal(mediaKind('clip.mp4'), 'video');
    assert.equal(mediaKind('clip.webm'), 'video');
    assert.equal(mediaKind('clip.mov'), 'video');
  });

  it('classifies audio extensions', () => {
    assert.equal(mediaKind('track.mp3'), 'audio');
    assert.equal(mediaKind('track.wav'), 'audio');
    assert.equal(mediaKind('track.ogg'), 'audio');
    assert.equal(mediaKind('track.m4a'), 'audio');
  });

  it('returns null for non-media and unknown files', () => {
    assert.equal(mediaKind('report.pdf'), null);
    assert.equal(mediaKind('archive.zip'), null);
    assert.equal(mediaKind('page.html'), null);
    assert.equal(mediaKind('script.unknown-ext'), null);
    assert.equal(mediaKind('no-extension'), null);
  });

  it('ignores extension case', () => {
    assert.equal(mediaKind('PHOTO.PNG'), 'image');
    assert.equal(mediaKind('Clip.Mp4'), 'video');
  });
});

describe('detectContentType (media extensions)', () => {
  it('detects the media types added for embeds', () => {
    assert.equal(detectContentType('img.avif'), 'image/avif');
    assert.equal(detectContentType('scan.bmp'), 'image/bmp');
    assert.equal(detectContentType('clip.webm'), 'video/webm');
    assert.equal(detectContentType('clip.mov'), 'video/quicktime');
    assert.equal(detectContentType('track.ogg'), 'audio/ogg');
    assert.equal(detectContentType('track.m4a'), 'audio/mp4');
  });
});

describe('markdown files', () => {
  // A study pack exported with `npx course export -f md` is uploaded to Canvas
  // as a file item, so it needs a content type of its own.
  it('uploads as text/markdown', () => {
    assert.equal(detectContentType('pack.md'), 'text/markdown');
  });

  it('is not embeddable media', () => {
    assert.equal(mediaKind('pack.md'), null);
  });
});
