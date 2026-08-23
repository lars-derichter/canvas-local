/**
 * The one thing that separates a failure this tool meant from one it did not.
 *
 * A refusal is a decision: the tool understood the run, worked out that going
 * on would do damage or produce nonsense, and stopped on purpose. Its message
 * is written for the person who typed the command and is the whole of what they
 * need — which course the sync state describes, which flag answers the question
 * a scripted run could not. A stack trace around that message is noise, and
 * worse than noise: it reads as a crash, so the sentence explaining what to do
 * next is skimmed past as tool internals.
 *
 * A defect is the opposite. A `TypeError` in the planner has no message worth
 * showing and every frame worth keeping, because the only useful next step is a
 * bug report. So `cli/index.js` prints a `RefusalError` as its message alone and
 * lets everything else keep its stack, and the choice of class at the throw site
 * is what decides which. Nothing infers it, and nothing should: a guessed
 * classification would quietly swallow the first defect that happened to carry a
 * readable message.
 *
 * Subclass it when callers need to tell one refusal from another —
 * `UnanswerableError` in `cli/module-utils.js` is caught by name in its own
 * tests. Throw it directly when they do not.
 */
class RefusalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RefusalError';
  }
}

module.exports = { RefusalError };
