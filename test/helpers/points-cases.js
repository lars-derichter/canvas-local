/**
 * Every spelling a number of points can arrive in, and the number each one
 * means — or null for the ones neither reader takes.
 *
 * One table, two readers. `readPoints` in `cli/new-item.js` turns what
 * `--points` was handed into what lands in `points_possible`, and
 * `validatePoints` in `.vscode/extensions/course-manager/helpers.js` decides
 * whether the extension's input box lets a typed value through on its way to
 * that same flag. The second is a deliberate copy of the first's rule: the
 * packaged extension has no `node_modules` and no `cli/` to require anything
 * out of, which is why `helpers.js` may not require so much as one module
 * (AGENTS.md). A copy is only worth having while it still says the same thing.
 *
 * Keeping it saying the same thing is what this file is for. It is the rule
 * written as values rather than as code, and each side is held to it in its own
 * test, so a change made to one implementation alone fails the other's test.
 * The check that used to do this job modelled the CLI as a hardcoded
 * `parseInt(...)` expression instead of running it, so it went on passing after
 * the CLI stopped using `parseInt` — a cross-check that agreed with a function
 * nobody was running any more.
 *
 * The rule the rows spell out, in a sentence: a plain decimal and nothing else.
 * Digits, then optionally a point and more digits, and the number that comes
 * back has to print as the digits that went in.
 */
const POINTS_CASES = [
  // Whole numbers, in every spelling of one. Leading zeros and surrounding
  // whitespace are the two the reader is expected to see through: neither
  // changes which number is meant.
  ['0', 0],
  ['1', 1],
  ['100', 100],
  ['007', 7],
  [' 25 ', 25],
  ['9007199254740991', 9007199254740991],

  // Fractions. Canvas takes a fractional `points_possible` and so does this
  // tool: `lib/sync/canvas-write.js` sends whatever the frontmatter holds.
  ['2.5', 2.5],
  ['0.5', 0.5],
  ['2.50', 2.5],
  ['00.50', 0.5],
  ['5.0', 5],
  ['0.0', 0],
  ['33.333', 33.333],
  // Further past the decimal point than any gradebook shows, and still exactly
  // the number that was typed. Canvas rounds what it displays; this reader has
  // no business deciding on its behalf how fine a denominator is allowed.
  ['0.123456789', 0.123456789],
  ['0.000001', 0.000001],

  // A decimal point wants digits on both sides. Both of these are a slip
  // rather than a shorthand — a `.5` is as easily a stray keystroke as it is a
  // half, and a `2.` is a `2.5` that lost its tail — and `0.5` is right there
  // for anyone who means a half.
  ['.5', null],
  ['2.', null],
  ['.', null],
  ['1.2.3', null],

  // A sign is not part of how a number of points is written. The minus is the
  // one that matters: commander hands `--points -5` through as this flag's
  // value rather than reading it as a flag of its own, so without this it
  // reaches the frontmatter as `points_possible: -5`, and nothing is worth
  // minus five points.
  ['-1', null],
  ['-5', null],
  ['-0', null],
  ['-2.5', null],
  ['+5', null],

  // Notations that are a number to `Number` and not to a reader filling in a
  // points box. Reading `1e3` as a thousand would be a guess about intent, and
  // the guess is wrong far more often than it is right.
  ['1e3', null],
  ['1e5', null],
  ['0e2', null],
  ['0x10', null],
  ['Infinity', null],
  ['NaN', null],

  // Digits with something in the middle: a separator that only a JavaScript
  // literal understands, or whitespace that trimming the ends does not reach.
  ['1_0', null],
  ['1_000', null],
  ['5 5', null],
  ['1 000', null],

  // Not a number at all.
  ['abc', null],
  ['10abc', null],
  ['100 points', null],
  ['1,5', null],

  // More digits than a double keeps, so the number that would be written out
  // is not the number that was typed. Refusing beats writing 9007199254740992
  // into a file whose author typed a 3 on the end, or `1e-7` into one whose
  // author typed a decimal.
  ['9007199254740993', null],
  ['90071992547409910', null],
  ['9'.repeat(30), null],
  ['2.5000000000000001', null],
  ['0.0000001', null],

  // The edge, which sits where `String` stops writing a number out in full
  // rather than where the arithmetic stops being exact. None of these is a real
  // number of points; they are here because a boundary nobody wrote down is a
  // boundary that moves. 2^53 prints as itself and is taken, although it is
  // past the safe integers. A one with twenty zeros prints as its digits and is
  // taken; with twenty-one it prints as `1e+21`, which is a number nobody typed
  // into the file, and is refused.
  ['9007199254740992', 9007199254740992],
  ['1' + '0'.repeat(20), 1e20],
  ['1' + '0'.repeat(21), null],
];

/**
 * The values that carry no answer at all.
 *
 * This is the one place the two readers differ in shape, and they still agree
 * on the outcome. `readPoints` reads them as nothing (null) and its caller
 * falls back to 100 out loud; `validatePoints` lets them through, because an
 * empty box is the box's pre-filled 100 left alone and refusing it would be
 * stricter than the tool behind it for no gain. Both end at 100, which is why
 * they are held apart from the table above rather than given a row in it.
 */
const EMPTY_POINTS = ['', '   '];

module.exports = { POINTS_CASES, EMPTY_POINTS };
