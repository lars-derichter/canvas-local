const fs = require('fs');
const path = require('path');

const {
  createModule,
  createModuleItem,
  deleteModule: deleteCanvasModule,
  deleteModuleItem,
  updateModule,
  updateModuleItem,
} = require('../canvas/modules');
const { deletePage, getPage } = require('../canvas/pages');
const { deleteAssignment, getAssignment } = require('../canvas/assignments');
const {
  deleteDiscussion,
  getDiscussion,
  gradedDiscussionWarning,
} = require('../canvas/discussions');
const {
  deleteFile,
  downloadFile,
  getFile,
  uploadFile,
} = require('../canvas/files');
const { ensureIcons, getIconUrls } = require('../canvas/icons');
const { loadCourseConfig } = require('../config/course-config');
const { markdownToHtml } = require('../convert/markdown-to-html');
const { canvasItemToMarkdown } = require('../convert/html-to-markdown');
const { extractPosition } = require('../convert/course-scanner');
const {
  parseFrontmatter,
  serializeFrontmatter,
} = require('../convert/frontmatter');
const {
  buildFileMap,
  buildLinkMap,
  extractFileReferences,
  resolveCanvasLink,
  resolveRelativeLink,
} = require('../convert/link-resolver');
const {
  canvasFingerprint,
  hashBinaryFile,
  hashText,
} = require('./fingerprint');
const {
  assignmentStrategy,
  buildFileResolver,
  discussionStrategy,
  pageStrategy,
  pushExternalTool,
  pushQuiz,
  refuseQuizBackedDelete,
} = require('./canvas-write');
const {
  ORDER_TEMP_PREFIX,
  fileItemHash,
  localFileHash,
  subHeaderHash,
} = require('./gather');
const {
  createPullFileResolver,
  downloadReferencedFiles,
  writeCategoryFile,
} = require('./local-write');
const {
  deleteItem,
  deleteModule: deleteModuleFromState,
  ensureModule,
  getItem,
  getModule,
  renamePaths,
  saveState,
  setItem,
  toPosixPath,
} = require('./state');
const { toFileSlug } = require('../../cli/naming');

/**
 * The *how* of a sync: everything `lib/sync/plan.js` decided, carried out.
 *
 * The planner is a pure function of three plain-data inputs, and it answers one
 * question — given what was true at the last sync, what is true in the working
 * tree and what is true on Canvas, what should happen? Every consequence of
 * that answer lives here: the HTTP calls, the files written, the renames, and
 * the state row recorded for each one.
 *
 * Nothing in this file re-decides what the planner decided. There is no second
 * opinion here about which side wins an item, about what a module should
 * contain, or about where in it an item sits; an action is carried out as it
 * was given, or it fails and names itself. That is what lets the two halves be
 * tested apart — the planner with no network and no disk anywhere near it, this
 * file against a mocked Canvas and a temporary course tree.
 */

// ---------------------------------------------------------------------------
// Executing a plan
// ---------------------------------------------------------------------------

/**
 * Run the action list `lib/sync/plan.js` produced, in the order it was given.
 *
 * The order is not a suggestion and this never re-sorts it: the planner's ranks
 * already encode every dependency there is — re-keys before anything names a
 * path, creates before the reorder that places them, item deletes before the
 * module delete that would 404 them, base rows dropped last. Reordering here
 * would silently undo all of that.
 *
 * **The invariant that governs the whole rework lives in this file**: after any
 * write, in either direction, the resulting fingerprint is recorded for *both*
 * sides — `canvas_hash` from the API response to the write, `local_hash` from
 * the bytes that were written, never from a re-read. Record one and not the
 * other and the two sides ping-pong forever, each reading the other's write as
 * a change it has to answer. Every write path below ends in `recordRow`, and
 * the test that matters is that a second `plan()` over the state this leaves
 * behind produces an empty action list.
 *
 * Failures are collected per action and the run carries on: one that fails
 * costs that action and nothing else. A sync that dies in the middle would
 * leave Canvas half written and the state describing neither side, so the
 * state is saved at the end and after a failure alike.
 */

/** Canvas's own name for each of this project's types. */
const CANVAS_ITEM_TYPES = {
  page: 'Page',
  assignment: 'Assignment',
  discussion: 'Discussion',
  quiz: 'Quiz',
  sub_header: 'SubHeader',
  external_url: 'ExternalUrl',
  external_tool: 'ExternalTool',
  file: 'File',
};

/** The types with no Canvas object behind the module item. */
const REFERENCE_TYPES = new Set([
  'quiz',
  'sub_header',
  'external_url',
  'external_tool',
]);

/** The three types whose body is authored markdown, and so can hold a callout. */
const CONTENT_TYPES = new Set(['page', 'assignment', 'discussion']);

/**
 * Whether this run will render markdown into Canvas HTML, which is the only
 * thing the alert icons are for.
 *
 * A pull-only or local-only run must issue no upload at all: the icons are
 * files in the Canvas course, and a run that writes nothing there has no
 * business putting anything in it. Only the three authored types go through
 * `markdownToHtml` — a link, a quiz, a text header and a file never do.
 */
function needsAlertIcons(plan) {
  return (plan.actions || []).some(
    (action) =>
      (action.type === 'create-canvas-item' ||
        action.type === 'update-canvas-item') &&
      CONTENT_TYPES.has(action.canvasType),
  );
}

/** What this tool sends Canvas for each of the three authored types. */
const CONTENT_STRATEGIES = {
  page: pageStrategy,
  assignment: assignmentStrategy,
  discussion: discussionStrategy,
};

/** Everything one run of `applyPlan` carries around, assembled once. */
function createContext(plan, options) {
  const ctx = {
    plan,
    courseId: options.courseId,
    courseDir: options.courseDir,
    state: options.state,
    canvasContent: options.canvasContent || new Map(),
    save: options.save || ((state) => saveState(state)),
    now: options.now || (() => new Date().toISOString()),
    log: options.log || {
      info: () => {},
      warn: () => {},
      verbose: () => {},
      error: () => {},
    },
    applied: [],
    errors: [],
    // Items whose markdown referenced a page that did not exist yet when they
    // were written; revisited once the run has created everything.
    unresolved: new Map(),
    maps: null,
  };

  // The link map is derived from the state, and the state changes under every
  // create, so it is rebuilt on demand rather than held. Cheap: it walks rows
  // already in memory.
  ctx.invalidate = () => {
    ctx.maps = null;
  };
  ctx.linkMaps = () => {
    if (!ctx.maps) {
      ctx.maps = {
        ...buildLinkMap(ctx.state),
        ...buildFileMap(ctx.state),
      };
    }
    return ctx.maps;
  };
  ctx.iconUrls = getIconUrls(ctx.state);
  ctx.labels = loadCourseConfig().labels;
  return ctx;
}

/** The absolute path of an item path, which is stored relative to `course/`. */
function absolutePath(ctx, itemPath) {
  return path.join(ctx.courseDir, itemPath);
}

/**
 * The Canvas module id an action should be issued against.
 *
 * The planner fills in what it knew when it planned, which for a module created
 * in this same run is nothing — the id did not exist yet. The state is what
 * learned it, a few actions ago, so it answers whatever the plan could not.
 */
function moduleIdFor(ctx, action) {
  if (action.canvasModuleId != null) return action.canvasModuleId;
  const entry = getModule(ctx.state, action.folder);
  return entry && entry.canvas_module_id != null
    ? entry.canvas_module_id
    : null;
}

/** The module item id recorded for a path, for an action planned before it existed. */
function moduleItemIdFor(ctx, action) {
  if (action.moduleItemId != null) return action.moduleItemId;
  const found = getItem(ctx.state, action.itemPath);
  return found && found.entry.module_item_id != null
    ? found.entry.module_item_id
    : null;
}

/**
 * Write one item's row, stamping both fingerprints and the moment.
 *
 * Every write in this file ends here. Fields the caller did not resolve keep
 * whatever the previous sync recorded — blanking a hash this run never computed
 * would make the next one call the item changed.
 */
function recordRow(ctx, folder, itemPath, fields) {
  ensureModule(ctx.state, folder, {});
  const previous = getItem(ctx.state, itemPath);
  const entry = previous ? { ...previous.entry } : {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) entry[key] = value;
  }
  entry.synced_at = ctx.now();
  const stored = setItem(ctx.state, folder, itemPath, entry);
  ctx.invalidate();
  return stored;
}

/** The local file's fingerprint, chosen by extension the way `gather` chooses it. */
function localHashOf(ctx, itemPath) {
  try {
    return localFileHash(absolutePath(ctx, itemPath), itemPath);
  } catch {
    return undefined;
  }
}

/** The frontmatter of a local markdown item, or an empty object. */
function frontmatterOf(ctx, itemPath) {
  try {
    return (
      parseFrontmatter(fs.readFileSync(absolutePath(ctx, itemPath), 'utf8'))
        .data || {}
    );
  } catch {
    return {};
  }
}

/**
 * Write `title:` into a markdown item's frontmatter when it has none.
 *
 * This is what makes "the filename is the address, `title:` is the display
 * name" true rather than aspirational. Without it the scanner falls back to the
 * de-prefixed filename, so renaming a file silently renames the Canvas item it
 * created — and `renumber` renames files by the dozen. Writing the title once,
 * at the moment sync creates or adopts the Canvas object, breaks that coupling
 * for good.
 *
 * A file that already declares one is left exactly as it is: the author's title
 * is the author's, and rewriting it would be sync deciding what their item is
 * called.
 *
 * It runs *after* the content write and before the row is recorded, so the
 * `local_hash` on that row describes the file including the line this just
 * added. The other order would leave every created item reading as changed
 * locally on the very next run. It is safe to run after the push because
 * `markdownToHtml` strips frontmatter, so the byte this adds never reaches the
 * HTML Canvas was handed.
 *
 * @returns {boolean} Whether a title was written.
 */
function writeTitleIfAbsent(ctx, itemPath, title) {
  if (!itemPath.endsWith('.md') || title == null) return false;
  const absolute = absolutePath(ctx, itemPath);
  try {
    const { data, content } = parseFrontmatter(
      fs.readFileSync(absolute, 'utf8'),
    );
    if (data.title != null) return false;
    // The key goes first in the block: it is the one an author reads.
    fs.writeFileSync(
      absolute,
      serializeFrontmatter({ title, ...data }, content),
      'utf8',
    );
    ctx.log.verbose(`Wrote title "${title}" to ${itemPath}`);
    return true;
  } catch (err) {
    ctx.log.warn(
      `  [sync] Could not write the title into ${itemPath}: ${err.message}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Canvas-side writes
// ---------------------------------------------------------------------------

/**
 * Upload every binary a markdown item embeds that Canvas does not already hold
 * the current version of.
 *
 * Keyed on the file's own hash rather than its mtime, so a clone — which
 * rewrites every mtime — does not re-upload the whole course, and an edited
 * image does.
 */
async function uploadEmbeddedFiles(ctx, itemPath, raw, folder) {
  if (!ctx.state.files) ctx.state.files = {};
  for (const ref of extractFileReferences(raw, itemPath)) {
    const localPath = absolutePath(ctx, ref);
    if (!fs.existsSync(localPath)) {
      ctx.log.warn(`  [sync] Referenced file not found: ${ref}`);
      continue;
    }
    const hash = hashBinaryFile(localPath);
    const tracked = ctx.state.files[ref];
    if (tracked && tracked.sha256 === hash) continue;

    const result = await uploadFile(ctx.courseId, localPath, {
      parentFolderPath: folder,
    });
    ctx.state.files[ref] = {
      canvas_file_id: result.id,
      canvas_url: `/courses/${ctx.courseId}/files/${result.id}/preview`,
      sha256: hash,
    };
    ctx.invalidate();
  }
}

/**
 * A markdown item as the HTML Canvas should hold, with its internal links
 * resolved against what the state knows so far.
 *
 * `unresolved` says the item linked to another item this run has not created
 * yet. The caller notes it and comes back at the end — the same second pass
 * push has always made, and it has to re-record the fingerprint when it does,
 * or the second write reads as a Canvas-side change forever after.
 */
function renderForCanvas(ctx, itemPath, raw) {
  const { relativeToCanvas } = ctx.linkMaps();
  let unresolved = false;
  const linkResolver = (href) => {
    const { resolved, wasInternal } = resolveRelativeLink(
      href,
      itemPath,
      relativeToCanvas,
      ctx.courseId,
    );
    if (wasInternal) unresolved = true;
    return resolved;
  };
  const fileResolver = buildFileResolver(itemPath, ctx.state);
  const html = markdownToHtml(raw, {
    iconUrls: ctx.iconUrls,
    alertTitles: ctx.labels.alerts,
    linkResolver,
    fileResolver,
  });
  return { html, unresolved };
}

/**
 * Push a page, assignment or discussion's content and hand back what Canvas
 * stored, which is what the fingerprint is taken from.
 *
 * The response and not the request: Canvas rewrites markup it is handed, so
 * hashing what was sent would leave a baseline no later read ever matches, and
 * every sync after this one would report a remote change nobody made.
 */
async function writeContent(ctx, action, { canvasId, folder }) {
  const strategy = CONTENT_STRATEGIES[action.canvasType];
  const itemPath = action.itemPath;
  const raw = fs.readFileSync(absolutePath(ctx, itemPath), 'utf8');
  const frontmatter = frontmatterOf(ctx, itemPath);

  await uploadEmbeddedFiles(ctx, itemPath, raw, folder);
  const { html, unresolved } = renderForCanvas(ctx, itemPath, raw);
  const opts = strategy.buildOpts(action.title, html, frontmatter);

  let result;
  if (canvasId != null) {
    try {
      result = await strategy.update(ctx.courseId, canvasId, opts);
    } catch (err) {
      if (!String(err.message).includes('404')) throw err;
      ctx.log.warn(
        `  [sync] ${strategy.label} ${canvasId} is gone from Canvas; creating it again.`,
      );
      result = await strategy.create(ctx.courseId, opts);
    }
  } else {
    result = await strategy.create(ctx.courseId, opts);
  }

  return {
    result,
    raw,
    frontmatter,
    unresolved,
    canvasId: strategy.extractId(result),
    pageUrl: strategy.extractSlug ? strategy.extractSlug(result) : null,
  };
}

/** What `createModuleItem` needs for this type, beyond the common fields. */
function moduleItemIdentity(canvasType, { canvasId, pageUrl, frontmatter }) {
  if (canvasType === 'page') return { pageUrl };
  if (canvasType === 'sub_header') return {};
  if (canvasType === 'external_url' || canvasType === 'external_tool') {
    return {
      externalUrl: frontmatter.external_url,
      ...newTabOf(canvasType, frontmatter),
    };
  }
  return { contentId: canvasId };
}

/**
 * What to say about `new_tab`, which the two link types answer differently —
 * push's distinction, kept rather than tidied away.
 *
 * An external URL is this project's own creation, so a frontmatter that says
 * nothing means "open in a new tab" and that is sent. An LTI link points at a
 * tool this project did not install, and Canvas does not report `new_tab`
 * reliably for one, so an author who said nothing gets nothing sent — guessing
 * would issue a PUT that changes nothing on every single run.
 */
function newTabOf(canvasType, frontmatter) {
  if (canvasType === 'external_url') {
    return { newTab: frontmatter.new_tab !== false };
  }
  return frontmatter.new_tab != null ? { newTab: frontmatter.new_tab } : {};
}

/**
 * Upload the binary an item of type `file` stands for, and say which file it is.
 *
 * @returns {Promise<{result: object, name: string}>} What Canvas stored, and
 *   the name it holds it under. The name is Canvas's own `display_name` where
 *   the response carries one, because that is what the next upload's
 *   `on_duplicate` is keyed against — the local basename only stands in when
 *   Canvas said nothing.
 */
async function writeFileContent(ctx, action, folder) {
  const itemPath = action.itemPath;
  const absolute = absolutePath(ctx, itemPath);
  let binary = absolute;
  if (itemPath.endsWith('.md')) {
    const frontmatter = frontmatterOf(ctx, itemPath);
    if (!frontmatter.file_ref) {
      throw new Error(
        `${itemPath} is a file item but its frontmatter names no file_ref, so ` +
          'there is no binary to upload.',
      );
    }
    binary = path.resolve(path.dirname(absolute), frontmatter.file_ref);
  }
  const result = await uploadFile(ctx.courseId, binary, {
    parentFolderPath: folder,
  });
  return {
    result,
    name: (result && result.display_name) || path.basename(binary),
  };
}

/**
 * What else in the sync state names a Canvas file, if anything does.
 *
 * Three places hold a file id: the embedded binaries under `state.files`, the
 * alert icons, and the row of any item whose type is `file`. All three are read
 * rather than only the obvious one, because the question being asked is "is
 * anything at all still pointing here" and a partial answer to that is worse
 * than none.
 *
 * @returns {string|null} The first holder found, phrased for a log line.
 */
function fileStillReferenced(ctx, fileId) {
  const wanted = String(fileId);
  for (const [ref, row] of Object.entries(ctx.state.files || {})) {
    if (row && String(row.canvas_file_id) === wanted) {
      return `the embedded file ${ref}`;
    }
  }
  for (const [type, row] of Object.entries(ctx.state.icons || {})) {
    if (row && String(row.canvas_file_id) === wanted) {
      return `the ${type} alert icon`;
    }
  }
  for (const module of Object.values(ctx.state.modules || {})) {
    for (const [itemPath, row] of Object.entries(
      (module && module.items) || {},
    )) {
      if (
        row &&
        row.canvas_type === 'file' &&
        String(row.canvas_id) === wanted
      ) {
        return `the file item ${itemPath}`;
      }
    }
  }
  return null;
}

/**
 * Delete the Canvas file a renamed binary left behind — and only when it really
 * was left behind.
 *
 * Canvas keys an upload on the filename, so renaming a binary lands it as a new
 * Canvas file and leaves the old one sitting in the course Files area with
 * nothing pointing at it. Nothing else ever cleans that up: `push
 * --prune-canvas` only reaches a file whose *local* counterpart is gone, and
 * after a rename the item is still there. So this is the only chance, and it is
 * also a delete nobody asked for with a flag — which is why what it checks has
 * three legs and not one.
 *
 * **A changed id is the cheap leg, and only a necessary condition.** The caller
 * has both ids already, and an upload that came back with the id we had
 * recorded landed on that same file, so there is provably nothing behind it to
 * orphan. What a *changed* id does not say is why it changed. Canvas answers an
 * `on_duplicate=overwrite` upload by replacing the file of that name and this
 * project has never verified which id that replacement carries — `1ee4bb1`
 * declined to bet on it and nothing since has settled it. Worse, an author who
 * moved the old file to another Canvas folder by hand gets a new id from the
 * very next upload while their file sits there, live and deliberate.
 *
 * **The name is the leg that says "orphan".** The old file is stranded exactly
 * when the upload was keyed on a different filename, so its `display_name` is
 * fetched and compared against the name just uploaded. A read that fails
 * answers the question too: the file is gone or unreadable, and either way this
 * run has nothing to clean up. That is `1ee4bb1`'s test kept for `1ee4bb1`'s
 * reason, with the id check in front of it so the ordinary case pays no
 * request.
 *
 * **And nothing else in the state may still name it.** A binary that a page
 * also links has its own row under `state.files`, and that row is what the
 * page's HTML in Canvas points at; a second wrapper may carry the same id. The
 * item's own row is not a false positive, because the caller records it against
 * the new file before calling this.
 *
 * A delete that fails is warned about and swallowed. An already-deleted file or
 * a permissions error is not a reason to fail a push that otherwise worked, and
 * the warning names the id so it can be cleared by hand.
 */
async function deleteRenamedFile(ctx, { itemPath, previousId, uploadedName }) {
  if (previousId == null) return;

  let previousName = null;
  try {
    const previous = await getFile(previousId);
    previousName = previous && previous.display_name;
  } catch (err) {
    ctx.log.verbose(
      `Canvas file ${previousId} could not be read (${err.message}), so ` +
        `nothing was cleaned up for ${itemPath}.`,
    );
    return;
  }
  if (!previousName || previousName === uploadedName) return;

  const holder = fileStillReferenced(ctx, previousId);
  if (holder) {
    ctx.log.verbose(
      `Left Canvas file ${previousId} ("${previousName}") alone: ${holder} ` +
        'still names it.',
    );
    return;
  }

  try {
    await deleteFile(previousId);
    ctx.log.verbose(
      `Deleted the orphaned Canvas file ${previousId} ("${previousName}") ` +
        `that ${itemPath} renamed.`,
    );
  } catch (err) {
    ctx.log.warn(
      `  [sync] Could not delete Canvas file ${previousId} ("${previousName}"), ` +
        `which ${itemPath} renamed away from: ${err.message}. It is still in ` +
        'the course Files area.',
    );
  }
}

/**
 * Record what a Canvas-side write settled, for both sides at once.
 *
 * `canvas_hash` is rebuilt from the module item Canvas handed back and the
 * content object it stored; `local_hash` from the file as it sits on disk,
 * which is the file that produced the write.
 */
function recordCanvasWrite(ctx, action, { item, content, canvasId, pageUrl }) {
  const canvasType = action.canvasType;
  let canvasHash;
  try {
    canvasHash = canvasFingerprint({ item, content }, canvasType);
  } catch (err) {
    ctx.log.verbose(`No fingerprint for ${action.itemPath}: ${err.message}`);
  }

  recordRow(ctx, action.folder, action.itemPath, {
    canvas_type: canvasType,
    canvas_id: canvasId ?? undefined,
    page_url: pageUrl ?? undefined,
    module_item_id: item && item.id != null ? item.id : undefined,
    title: item && item.title != null ? item.title : action.title,
    external_url:
      item && item.external_url != null ? item.external_url : undefined,
    local_hash:
      canvasType === 'sub_header'
        ? subHeaderHash({ title: action.title, indent: action.indent })
        : localHashOf(ctx, action.itemPath),
    canvas_hash: canvasHash,
    canvas_updated_at:
      content && content.updated_at ? content.updated_at : null,
  });
}

/**
 * Create the Canvas object an item stands for, place it in its module, and
 * record both — or throw, saying why, and record nothing.
 *
 * There is no third way out on purpose. `applyPlan` reads a handler that
 * returns as a handler that succeeded, so a `return` from here puts the action
 * in `applied` and the run reports an item it did not create. Every branch
 * below therefore either resolves what the module item will point at or
 * throws, and the type that cannot be resolved is the one that gets a create
 * planned for it again on the next run, which is what makes stopping cheap.
 */
async function createCanvasItem(ctx, action) {
  const moduleId = moduleIdFor(ctx, action);
  if (moduleId == null) {
    throw new Error(
      `no Canvas module id for ${action.folder}; the module was not created.`,
    );
  }

  const canvasType = action.canvasType;
  const common = {
    title: action.title,
    type: CANVAS_ITEM_TYPES[canvasType],
    position: action.position ?? undefined,
    indent: action.indent ?? undefined,
  };

  if (!common.type) {
    throw new Error(
      `${action.itemPath} declares canvas_type "${canvasType}", which Canvas ` +
        'has no module item type for.',
    );
  }

  let content = null;
  let canvasId = null;
  let pageUrl = null;
  let frontmatter = frontmatterOf(ctx, action.itemPath);
  let unresolved = false;

  if (
    canvasType === 'page' ||
    canvasType === 'assignment' ||
    canvasType === 'discussion'
  ) {
    const written = await writeContent(ctx, action, {
      canvasId: null,
      folder: action.folder,
    });
    content = written.result;
    canvasId = written.canvasId;
    pageUrl = written.pageUrl;
    frontmatter = written.frontmatter;
    unresolved = written.unresolved;
  } else if (canvasType === 'file') {
    const uploaded = await writeFileContent(ctx, action, action.folder);
    content = uploaded.result;
    canvasId = content.id;
  } else if (canvasType === 'quiz') {
    // Which quiz an item names is resolved against the course's quiz list, by
    // id and then by title — push's rule, kept whole because it is the one that
    // survives a QTI package being imported twice. A quiz it cannot resolve
    // throws, and the reason it throws with is the half of the answer that says
    // what to do: an import that has not happened yet is a different problem
    // from two quizzes sharing a title.
    const descriptor = await pushQuiz(
      ctx.courseId,
      {
        title: action.title,
        canvasId: null,
        position: action.position,
        indent: action.indent,
        frontmatter,
      },
      false,
    );
    canvasId = descriptor.contentId;
  } else if (canvasType === 'external_tool') {
    // Called for the launch-URL check and the refusal it can raise, not for
    // what it returns: the module item carries the URL itself, so
    // `moduleItemIdentity` builds it from this same frontmatter.
    await pushExternalTool(
      ctx.courseId,
      {
        title: action.title,
        position: action.position,
        indent: action.indent,
        frontmatter,
      },
      false,
    );
  } else if (canvasType === 'external_url' && !frontmatter.external_url) {
    throw new Error(
      `${action.itemPath} declares canvas_type external_url but names no ` +
        'external_url in its frontmatter.',
    );
  }

  const item = await createModuleItem(ctx.courseId, moduleId, {
    ...common,
    ...moduleItemIdentity(canvasType, { canvasId, pageUrl, frontmatter }),
  });

  if (REFERENCE_TYPES.has(canvasType) && canvasType !== 'quiz') {
    // The module item is the whole of these, so it is also their content id.
    canvasId = canvasType === 'sub_header' ? null : item.id;
  }

  // Before the row is recorded, so `local_hash` describes the file as it now is.
  writeTitleIfAbsent(ctx, action.itemPath, action.title);
  recordCanvasWrite(ctx, action, { item, content, canvasId, pageUrl });
  if (unresolved) ctx.unresolved.set(action.itemPath, action);
}

/**
 * Bring the module item in line with the local file, and only when it is not
 * already: a PUT that changes nothing is a request the no-op sync must not make.
 */
async function alignModuleItem(ctx, moduleId, moduleItemId, wanted) {
  if (moduleItemId == null) return null;
  const cached = ctx.canvasContent.get(String(moduleItemId));
  const live = cached ? cached.item : null;
  const changes = {};
  if (live == null || String(live.title ?? '') !== String(wanted.title ?? '')) {
    changes.title = wanted.title;
  }
  if (live == null || Number(live.indent ?? 0) !== Number(wanted.indent ?? 0)) {
    changes.indent = wanted.indent ?? 0;
  }
  if (
    wanted.externalUrl !== undefined &&
    (live == null || live.external_url !== wanted.externalUrl)
  ) {
    changes.externalUrl = wanted.externalUrl;
  }
  if (
    wanted.newTab !== undefined &&
    live != null &&
    Boolean(live.new_tab) !== Boolean(wanted.newTab)
  ) {
    changes.newTab = wanted.newTab;
  }
  if (Object.keys(changes).length === 0) return live;
  return updateModuleItem(ctx.courseId, moduleId, moduleItemId, changes);
}

/**
 * The Canvas file a `file` item stands for, as the gather already read it, and
 * only when this write is not going to replace it.
 *
 * The skipped-upload path below is the one caller, and it needs this for one
 * reason: `recordCanvasWrite` rebuilds `canvas_hash` from the module item *and*
 * the object behind it, and a `file`'s half of that is `display_name`, `size`
 * and `updated_at`. Record the row with no content object and all three go in
 * as null, which no gather ever produces — the item would read as changed on
 * Canvas on the very next run and pull the remote copy over the author's file.
 * Nothing was written to the object, so what the gather read is still true.
 *
 * **A miss is answered with `null`, and the caller then uploads after all.**
 * The cache misses for real: `gatherCanvas` records `contentObject: null` when
 * `GET /files/:id` fails, and that also leaves `canvasHash` null, which reads
 * as "Canvas unchanged" and lets the item reach this path. Skipping the upload
 * on the strength of a file nothing could read would write exactly the row
 * described above. Uploading is what this always did, so it is what a run that
 * cannot prove otherwise goes back to.
 */
function cachedFileFor(ctx, action, moduleItemId) {
  if (action.canvasType !== 'file' || !action.contentUnchanged) return null;
  if (moduleItemId == null) return null;
  const cached = ctx.canvasContent.get(String(moduleItemId));
  return (cached && cached.content) || null;
}

async function updateCanvasItem(ctx, action) {
  const moduleId = moduleIdFor(ctx, action);
  const moduleItemId = moduleItemIdFor(ctx, action);
  const canvasType = action.canvasType;
  const cachedFile = cachedFileFor(ctx, action, moduleItemId);
  let content = null;
  let canvasId = action.canvasId ?? null;
  let pageUrl = action.pageUrl ?? null;
  let frontmatter = frontmatterOf(ctx, action.itemPath);
  let unresolved = false;

  if (
    canvasType === 'page' ||
    canvasType === 'assignment' ||
    canvasType === 'discussion'
  ) {
    const written = await writeContent(ctx, action, {
      canvasId,
      folder: action.folder,
    });
    content = written.result;
    canvasId = written.canvasId;
    pageUrl = written.pageUrl;
    frontmatter = written.frontmatter;
    unresolved = written.unresolved;
  } else if (cachedFile) {
    // The planner proved the binary is the one Canvas already holds, so the
    // upload is not merely wasteful. Canvas keys an upload on the filename: a
    // renamed wrapper sends the same bytes under a new name, gets a *new* file
    // id back, and the branch below then repoints the module item and deletes
    // the file every existing student link resolves to. All to change a string.
    content = cachedFile;
  } else if (canvasType === 'file') {
    const uploaded = await writeFileContent(ctx, action, action.folder);
    content = uploaded.result;
    if (canvasId != null && String(content.id) !== String(canvasId)) {
      // A renamed binary lands as a new Canvas file, so the item has to point
      // somewhere else — and a module item's content id cannot be changed.
      if (moduleItemId != null) {
        await deleteModuleItem(ctx.courseId, moduleId, moduleItemId);
      }
      const replacement = await createModuleItem(ctx.courseId, moduleId, {
        title: action.title,
        type: 'File',
        contentId: content.id,
        indent: action.indent ?? undefined,
      });
      // Recorded before the cleanup below, so that this item's own row already
      // names the new file when `deleteRenamedFile` asks what still points at
      // the old one. The other order would have the row answer "yes, I do".
      recordCanvasWrite(ctx, action, {
        item: replacement,
        content,
        canvasId: content.id,
        pageUrl: null,
      });
      await deleteRenamedFile(ctx, {
        itemPath: action.itemPath,
        previousId: canvasId,
        uploadedName: uploaded.name,
      });
      return;
    }
    canvasId = content.id;
  }

  const item = await alignModuleItem(ctx, moduleId, moduleItemId, {
    title: action.title,
    indent: action.indent,
    ...(canvasType === 'external_url' || canvasType === 'external_tool'
      ? {
          externalUrl: frontmatter.external_url,
          ...newTabOf(canvasType, frontmatter),
        }
      : {}),
  });

  recordCanvasWrite(ctx, action, {
    item: item || {
      id: moduleItemId,
      title: action.title,
      indent: action.indent,
    },
    content,
    canvasId,
    pageUrl,
  });
  if (unresolved) ctx.unresolved.set(action.itemPath, action);
}

/**
 * Move a module item into another module without touching what it points at.
 *
 * Canvas takes the target module on the item's own update endpoint, so the item
 * keeps its id — which is the whole point of this rework, and the reason this
 * is not a delete followed by a create.
 */
async function moveCanvasItem(ctx, action) {
  const moduleItemId = moduleItemIdFor(ctx, action);
  if (moduleItemId == null) return;
  const target =
    action.toCanvasModuleId ??
    (getModule(ctx.state, action.toFolder) || {}).canvas_module_id;
  if (target == null) {
    throw new Error(`no Canvas module id for ${action.toFolder}.`);
  }
  await updateModuleItem(
    ctx.courseId,
    action.fromCanvasModuleId,
    moduleItemId,
    {
      moduleId: target,
      position: action.position ?? undefined,
      indent: action.indent ?? undefined,
    },
  );
  recordRow(ctx, action.toFolder, action.itemPath, {
    module_item_id: moduleItemId,
  });
}

async function deleteCanvasItem(ctx, action) {
  const canvasType = action.canvasType;
  const moduleId = moduleIdFor(ctx, action);
  const moduleItemId = moduleItemIdFor(ctx, action);

  try {
    if (canvasType === 'page') {
      await deletePage(ctx.courseId, action.pageUrl || action.canvasId);
    } else if (canvasType === 'assignment') {
      // An assignment id can name a quiz. Deleting it would take the quiz and
      // every submission in it, so that one is refused rather than done.
      const refusal = await refuseQuizBackedDelete(ctx.courseId, {
        canvasId: action.canvasId,
        relativePath: action.itemPath,
      });
      if (refusal) throw new Error(refusal.error);
      await deleteAssignment(ctx.courseId, action.canvasId);
    } else if (canvasType === 'discussion') {
      await deleteDiscussion(ctx.courseId, action.canvasId);
    } else if (canvasType === 'file') {
      await deleteFile(action.canvasId);
    } else if (moduleItemId != null) {
      // A quiz, a link or a text header: the module item is all this tool owns,
      // so removing it never reaches the quiz or the tool behind it.
      await deleteModuleItem(ctx.courseId, moduleId, moduleItemId);
    }
  } catch (err) {
    if (!String(err.message).includes('404')) throw err;
    ctx.log.verbose(`Already gone from Canvas: ${action.itemPath}`);
  }
  deleteItem(ctx.state, action.itemPath);
  ctx.invalidate();
}

/**
 * Take the local order to Canvas, and record it only if it is what happened.
 *
 * `item_order` is the base leg of the next run's ordering comparison — the
 * sequence the two sides last agreed on. A reorder that ran in full is exactly
 * such an agreement, and the plan is a faithful record of it, because every
 * position in it was sent. A reorder that could not move one of its items
 * reaches no agreement at all, and reaches nothing this function can name
 * either: Canvas puts the skipped item wherever placing its neighbours leaves
 * it, and that same shifting carries the items that *did* move away from the
 * positions they were sent to. The plan is then wrong about the whole tail
 * rather than about the one entry.
 *
 * Writing it regardless is what made the defect. The plan is also the local
 * order — a `reorder-canvas-module` is planned because local won — so a base
 * equal to local with a Canvas that differs reads on the next run as **Canvas**
 * having been reordered, and `sync` or `pull` renumbers the author's files into
 * an order that exists only because the reposition failed. Leaving the previous
 * sequence alone says the true thing instead, that no new agreement was
 * reached: both sides now differ from the base, which is the one shape that
 * makes the planner weigh the two live orders against each other rather than
 * trust the base. It then either finds them already agreed or puts both in
 * front of the author, and neither answer renumbers a file behind their back.
 *
 * A throw from `updateModuleItem` arrives at the same place by propagating, and
 * deliberately gets no `finally`. Its local counterpart has one because renames
 * that landed are facts on disk this code performed; here nothing is recorded
 * per item, and where Canvas left the ones that moved is Canvas's answer rather
 * than this function's.
 */
async function reorderCanvasModule(ctx, action) {
  const moduleId = moduleIdFor(ctx, action);
  if (moduleId == null) return;
  let sentEveryPosition = true;
  // Ascending, because Canvas shifts everything at or after the position it is
  // given: placing each item in turn never disturbs one already placed.
  for (const entry of action.order) {
    const moduleItemId = moduleItemIdFor(ctx, entry);
    if (moduleItemId == null) {
      // Said out loud rather than skipped, the same as a missing source in
      // `parkForReorder`. The plan named this item, so nothing recording a
      // module item for it means a create that failed earlier in this same
      // run, a quiz or external tool that resolved to nothing, or a state
      // edited by hand — and until this line every one of them was silent.
      sentEveryPosition = false;
      ctx.log.warn(
        `  [sync] Could not reorder ${entry.itemPath} to position ` +
          `${entry.position}: no Canvas module item is recorded for it. ` +
          'Canvas shifts it as the items around it are placed, so this run ' +
          'cannot say what order the module is in and the recorded one is ' +
          'left as it was.',
      );
      continue;
    }
    await updateModuleItem(ctx.courseId, moduleId, moduleItemId, {
      position: entry.position,
    });
  }
  if (!sentEveryPosition) return;

  const module = getModule(ctx.state, action.folder);
  // An order naming nothing is not an order to empty the module by: the
  // sequence is rewritten wholesale, so the length check is what keeps a
  // degenerate action from erasing the base every later run compares against.
  if (module && action.order.length > 0) {
    module.item_order = action.order.map((entry) =>
      toPosixPath(entry.itemPath),
    );
  }
}

// ---------------------------------------------------------------------------
// Local-side writes
// ---------------------------------------------------------------------------

/**
 * Say the one thing a discussion's markdown cannot say for itself.
 *
 * Points, due date, grading type and group set live only in Canvas: they are
 * not in the file and no push or pull touches them. Push says so on every
 * create and update (`warnIfGradedDiscussion`), and the local direction needs
 * it at least as much — an author who has only ever seen the file has no other
 * way to learn that the file is not the whole truth.
 *
 * It hangs off `contentFor` rather than off the `getDiscussion` below, because
 * the fetch is the uncommon path: `gatherCanvas` reads every discussion in the
 * course in one list request and hands the topic over in `canvasContent`, so a
 * normal pull never calls `getDiscussion` at all.
 *
 * A `sync` that writes the same discussion in both directions cannot happen, so
 * there is nothing here to stop the line printing twice: the planner resolves
 * an item to one side or the other, and `planKnownItem` emits either a Canvas
 * update or a local one, never both.
 */
function warnGradedDiscussion(ctx, canvasType, resolved) {
  if (canvasType !== 'discussion') return resolved;
  const line = gradedDiscussionWarning(resolved.content);
  if (line) ctx.log.warn(`  [sync] ${line}`);
  return resolved;
}

/** The Canvas object behind an item, from the run's cache or, failing that, fetched. */
async function contentFor(ctx, action) {
  const cached = ctx.canvasContent.get(String(action.moduleItemId));
  if (cached && cached.content) {
    return warnGradedDiscussion(ctx, action.canvasType, cached);
  }
  const item = (cached && cached.item) || {
    id: action.moduleItemId,
    title: action.title,
    indent: action.indent,
  };
  if (action.canvasType === 'page') {
    return {
      item,
      content: await getPage(ctx.courseId, action.pageUrl ?? action.canvasId),
    };
  }
  if (action.canvasType === 'assignment') {
    return {
      item,
      content: await getAssignment(ctx.courseId, action.canvasId),
    };
  }
  if (action.canvasType === 'discussion') {
    return warnGradedDiscussion(ctx, action.canvasType, {
      item,
      content: await getDiscussion(ctx.courseId, action.canvasId),
    });
  }

  // A link has no object behind it: the launch URL on the module item is the
  // whole of it, and the planner's action does not carry one — `plan.js` keeps
  // only the fields it reasons about, and a URL is not one of them. The run's
  // content cache is the supported way to supply it: `gatherCanvas` puts the
  // raw module item there, URL and all, and the command always passes it.
  //
  // A caller that does not is refused rather than served. Writing the stub
  // anyway produces a file that looks like a link and points nowhere, which is
  // worse than a failed action: the next run sees a local file, reads it as
  // done, and never tries again — so the item is quietly broken for good.
  if (
    action.canvasType === 'external_url' ||
    action.canvasType === 'external_tool'
  ) {
    if (!item.external_url) {
      throw new Error(
        `cannot write ${action.itemPath}: nothing supplied the launch URL of ` +
          `this ${action.canvasType}. The Canvas module item carries it, so ` +
          "pass gatherCanvas's `content` map to applyPlan as `canvasContent`. " +
          'No file was written, because one without a URL would look like a ' +
          'link and go nowhere.',
      );
    }
  }

  // A quiz has no content of its own here: the questions live in Canvas and in
  // the QTI package, so what gets written is a reference, and which quiz it
  // refers to is the whole of what it says. Canvas states that as the module
  // item's `content_id`, and an item that carries none leaves nothing to write
  // down — `gatherCanvas` records `canvasId: null` and the planner emits the
  // create regardless.
  //
  // Refused for the same reason as the URL-less link above. The reference file
  // would look like a synced quiz while its row named no Canvas object, and the
  // next run would see a local file with a base row, read it as done, and never
  // try again — so the item is quietly broken for good.
  if (action.canvasType === 'quiz' && action.canvasId == null) {
    throw new Error(
      `cannot write ${action.itemPath}: the Canvas module item for quiz ` +
        `"${action.title}" (module item ${action.moduleItemId}) names no ` +
        'content_id, so there is no quiz for the reference file to point at. ' +
        'No file was written, because one without an id would look synced and ' +
        'never be retried. Check the item in Canvas — a quiz item usually ' +
        'loses its content_id when the quiz behind it was deleted.',
    );
  }

  return { item, content: null };
}

/** Write a text header's subfolder: the directory and the label Docusaurus reads. */
function writeLocalHeader(ctx, action) {
  const dir = absolutePath(ctx, action.itemPath);
  fs.mkdirSync(dir, { recursive: true });
  writeCategoryFile(dir, action.title, action.position ?? 0);
}

/** Download the binary a File item stands for and write the wrapper that names it. */
async function writeLocalFileItem(ctx, action, item, content) {
  const absolute = absolutePath(ctx, action.itemPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const displayName = (content && content.display_name) || action.title;
  const binaryName = toFileSlug(displayName);
  const filesDir = path.join(path.dirname(absolute), '_files');
  fs.mkdirSync(filesDir, { recursive: true });
  await downloadFile(action.canvasId, path.join(filesDir, binaryName));

  const wrapper = {
    title: action.title,
    canvas_type: 'file',
    file_ref: `_files/${binaryName}`,
  };
  for (const [key, value] of Object.entries(
    frontmatterOf(ctx, action.itemPath),
  )) {
    if (key in wrapper) continue;
    wrapper[key] = value;
  }
  const markdown = serializeFrontmatter(wrapper, '');
  fs.writeFileSync(absolute, markdown, 'utf8');
  return markdown;
}

/**
 * The `local_hash` of what a local write just produced.
 *
 * Taken from the markdown in hand rather than from a re-read of the file:
 * re-reading opens a window for an editor's autosave to land in between, which
 * would leave a row describing a file this run never wrote.
 *
 * A `file` item is the one that cannot be answered from memory alone. Its
 * fingerprint covers the binary as well as the wrapper — that is what makes a
 * replaced PDF reach Canvas at all (`fileItemHash` in `lib/sync/gather.js`) —
 * and the only copy of those bytes is the one `writeLocalFileItem` has just
 * downloaded to disk. So the wrapper's half comes from memory and the binary's
 * from the file, which is also exactly what the next `gatherLocal` will read.
 *
 * A text header has no file at all: a subfolder and the label in its
 * `_category_.json` are the whole of it, so it is hashed from the two values
 * Canvas holds for one.
 */
function localWriteHash(ctx, action, markdown) {
  if (action.canvasType === 'sub_header') {
    return subHeaderHash({ title: action.title, indent: action.indent });
  }
  if (action.canvasType === 'file') {
    return fileItemHash(markdown, absolutePath(ctx, action.itemPath));
  }
  return hashText(markdown);
}

/**
 * Write one item into the working tree, and record both fingerprints for it.
 *
 * `canvas_hash` is the one the gather already computed for the item — the write
 * did not change Canvas, so nothing about it can have moved. `local_hash` is
 * `localWriteHash` above.
 */
async function writeLocalItem(ctx, action) {
  const canvasType = action.canvasType;
  let markdown = null;

  if (canvasType === 'sub_header') {
    writeLocalHeader(ctx, action);
  } else {
    const { item, content } = await contentFor(ctx, action);
    if (canvasType === 'file') {
      markdown = await writeLocalFileItem(ctx, action, item, content);
    } else {
      const absolute = absolutePath(ctx, action.itemPath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const maps = ctx.linkMaps();
      const body =
        (content && (content.body || content.description || content.message)) ||
        '';
      if (body) {
        await downloadReferencedFiles(
          ctx.courseId,
          body,
          action.folder,
          ctx.state,
          maps.canvasToLocal,
          ctx.courseDir,
        );
        ctx.invalidate();
      }
      markdown = canvasItemToMarkdown(
        content || {
          title: action.title,
          external_url: item.external_url,
          content_id: item.content_id,
          id: item.id,
          new_tab: item.new_tab,
        },
        canvasType,
        {
          linkResolver: (href) =>
            resolveCanvasLink(href, action.itemPath, maps.canvasToRelative),
          fileResolver: createPullFileResolver(
            ctx.courseId,
            action.itemPath,
            ctx.linkMaps().canvasToLocal,
          ),
          existingFrontmatter: frontmatterOf(ctx, action.itemPath),
        },
      );
      fs.writeFileSync(absolute, markdown, 'utf8');
    }
  }

  recordRow(ctx, action.folder, action.itemPath, {
    canvas_type: canvasType,
    canvas_id: action.canvasId ?? undefined,
    page_url: action.pageUrl ?? undefined,
    module_item_id: action.moduleItemId ?? undefined,
    title: action.title,
    local_hash: localWriteHash(ctx, action, markdown),
    canvas_hash: action.canvasHash ?? undefined,
    canvas_updated_at: action.canvasUpdatedAt ?? null,
  });
}

function deleteLocalItem(ctx, action) {
  fs.rmSync(absolutePath(ctx, action.itemPath), {
    recursive: true,
    force: true,
  });
  deleteItem(ctx.state, action.itemPath);
  ctx.invalidate();
}

/** The same basename under a different two-digit prefix. */
function renumberPath(itemPath, position) {
  const slash = itemPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : itemPath.slice(0, slash + 1);
  const base = itemPath.slice(slash + 1).replace(/^\d+-/, '');
  return `${dir}${String(position).padStart(2, '0')}-${base}`;
}

/** A path rewritten through the renames already decided for its parents. */
function throughRemap(itemPath, remap) {
  let best = itemPath;
  for (const [from, to] of remap) {
    if (itemPath === from) return to;
    if (itemPath.startsWith(`${from}/`)) {
      best = `${to}${itemPath.slice(from.length)}`;
    }
  }
  return best;
}

/**
 * Two item paths in the order the scanner reads them out of the tree.
 *
 * Segment by segment on the numeric prefix, with the shorter path first where
 * one is a prefix of the other — which is what puts a text header ahead of the
 * items inside it, the same arrangement `flattenScannedItems` produces. The
 * prefix itself comes from `extractPosition`, so there is one definition of
 * what a numbering means rather than a second one here.
 *
 * Needed because `item_order` has to describe the tree as it now stands, and a
 * renumber that could not happen leaves its item at the number it already had.
 * Two siblings under one prefix is a numbering the author has to fix either
 * way; the tie-break on the name only keeps the answer the same twice running.
 */
function compareItemPaths(a, b) {
  const left = a.split('/');
  const right = b.split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] === right[i]) continue;
    const byPosition = extractPosition(left[i]) - extractPosition(right[i]);
    if (byPosition !== 0) return byPosition;
    return left[i] < right[i] ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * Move every file of a reorder out of the way, so none can land on another.
 *
 * The parking half is the dangerous half. A throw partway through — EPERM, a
 * full disk, an editor holding a handle — used to leave the files it had
 * already moved sitting under a temporary name that `scanCourse` skips, so the
 * next run read them as locally deleted and `push --prune-canvas` offered to
 * delete their Canvas objects. Every file it moved is therefore put back before
 * the error propagates, and a restore that itself fails names the files rather
 * than going quiet: those are the ones somebody has to rename by hand.
 *
 * The temporary name carries the original basename, which is what lets
 * `recoverOrderTemps` in `lib/sync/gather.js` clean up after a process that was
 * killed outright and never ran this unwind at all.
 */
function parkForReorder(ctx, moves) {
  const parked = [];
  try {
    for (const move of moves) {
      const { from, to } = move;
      const source = absolutePath(ctx, from);
      // Said out loud rather than skipped. The plan was built from a scan that
      // saw this path, so a source that is gone by the time the rename runs is
      // either a file the author deleted in the seconds since or a caller
      // handing over a path that was never there — and until this line, a bug
      // of the second kind looked exactly like the first and neither said
      // anything at all. Either way the item keeps the number it has while
      // everything around it moves, which is a module in an order nobody asked
      // for, and worth a line whichever of the two put it there.
      if (!fs.existsSync(source)) {
        ctx.log.warn(
          `  [sync] Could not reorder ${from} to ${to}: there is nothing at ` +
            `${from}. It keeps its current number and the rest of the module ` +
            'is renumbered around it.',
        );
        continue;
      }
      const tempPath = `${path.posix.dirname(from)}/${ORDER_TEMP_PREFIX}${path.posix.basename(from)}`;
      const temp = absolutePath(ctx, tempPath);
      // Only ever a leftover `recoverOrderTemps` could not put back. Renaming
      // over it would destroy the one copy of whatever it holds, so the reorder
      // stops instead and the unwind below undoes what it has done so far.
      if (fs.existsSync(temp)) {
        throw new Error(
          `${from} cannot be renumbered: ${tempPath} is already there, left ` +
            'over from an interrupted run. Move or remove it and run again.',
        );
      }
      fs.renameSync(source, temp);
      parked.push({ ...move, temp });
    }
  } catch (err) {
    const stranded = [];
    for (const entry of parked) {
      try {
        fs.renameSync(entry.temp, absolutePath(ctx, entry.from));
      } catch {
        stranded.push(entry.from);
      }
    }
    if (stranded.length === 0) throw err;
    const names = stranded.join(', ');
    ctx.log.error(
      `  [sync] Renumbering failed and these files could not be put back ` +
        `under their own names: ${names}. Each is still on disk under ` +
        `${ORDER_TEMP_PREFIX}<name> in its own folder — rename it by hand ` +
        'before the next sync, which would otherwise read it as deleted.',
    );
    throw new Error(
      `${err.message} (and ${names} could not be put back — see above)`,
    );
  }
  return parked;
}

/**
 * Take the module's order from Canvas, which locally means renaming files.
 *
 * The numeric prefix *is* the local order, so there is nothing else to change.
 * Every rename lands via a temporary name, because a reorder routinely moves
 * two files into each other's slots and the second would overwrite the first.
 *
 * **One depth at a time**, and that is what the loop is shaped around. Renaming
 * a subfolder moves every path inside it, so a child's source is not knowable
 * until its parent has landed. Parking the whole module up front looked for the
 * children under the parent's *new* name while the parent was still sitting
 * under its temporary one, found them at neither name, and skipped every one of
 * them in silence — the folder then unparked carrying its children at their old
 * numbers, while the state recorded the new ones. Parking a level only once the
 * level above it has landed is what makes the source exist. It gives up nothing
 * the parking is for: a renumber never leaves its own directory, so only items
 * at the same depth can land on each other, and those are still parked together
 * before any of them moves.
 *
 * `remap` holds where each planned path actually **is**, not where the plan
 * wanted it. A move that did not happen leaves its entry at the path it still
 * has, the items under it resolve through that, and both the state's rows and
 * its `item_order` come out describing the disk rather than the plan.
 */
function reorderLocalModule(ctx, action) {
  const levels = new Map();
  for (const entry of action.order) {
    const depth = entry.itemPath.split('/').length;
    const level = levels.get(depth);
    if (level) level.push(entry);
    else levels.set(depth, [entry]);
  }

  const remap = new Map();
  // Carried to the state one level at a time, because `renamePaths` expands a
  // directory move over everything under it: handed a parent and its children
  // in one batch, the parent's expansion claims the children first and their
  // own renames become no-ops. A level at a time is also the batch that needs
  // the temporary keys, since only siblings swap slots.
  let landed = [];
  const record = () => {
    if (landed.length === 0) return;
    renamePaths(ctx.state, landed);
    landed = [];
  };

  try {
    for (const depth of [...levels.keys()].sort((a, b) => a - b)) {
      const moves = [];
      for (const entry of levels.get(depth)) {
        const current = throughRemap(entry.itemPath, remap);
        remap.set(entry.itemPath, current);
        const target = renumberPath(current, entry.position);
        if (current !== target)
          moves.push({ entry, from: current, to: target });
      }
      if (moves.length === 0) continue;

      for (const { entry, temp, from, to } of parkForReorder(ctx, moves)) {
        const destination = absolutePath(ctx, to);
        if (fs.existsSync(destination)) {
          fs.renameSync(temp, absolutePath(ctx, from));
          ctx.log.warn(
            `  [sync] Could not reorder ${from} to ${to}: something is already there.`,
          );
          continue;
        }
        fs.renameSync(temp, destination);
        remap.set(entry.itemPath, to);
        landed.push({ from, to });
      }
      record();
    }
  } finally {
    // In a `finally` because a throw from a later level must not leave the
    // state describing files an earlier one has already moved. An item row at a
    // path nothing is on is exactly what the next run reads as locally deleted.
    record();
    const module = getModule(ctx.state, action.folder);
    // An order naming nothing is not an order to empty the module by: the
    // sequence is rewritten wholesale, so the length check is what keeps a
    // degenerate action from erasing the base every later run compares against.
    if (module && action.order.length > 0) {
      module.item_order = action.order
        .map((entry) => throughRemap(entry.itemPath, remap))
        .sort(compareItemPaths);
    }
    ctx.invalidate();
  }
}

// ---------------------------------------------------------------------------
// The dispatch table
// ---------------------------------------------------------------------------

const HANDLERS = {
  'rekey-base': (ctx, action) => {
    renamePaths(ctx.state, [{ from: action.from, to: action.to }]);
    ctx.invalidate();
  },
  // Not a write to either side: it records that a local folder and a Canvas
  // module are the same module, which is the one thing an adopted module has
  // nobody else to learn. Every action below addresses Canvas by a module id,
  // and `moduleIdFor` reads this row when the plan could not name one.
  'link-base-module': (ctx, action) => {
    ensureModule(ctx.state, action.folder, {
      canvas_module_id: action.canvasModuleId,
      name: action.name,
      position: action.position,
    });
    ctx.invalidate();
  },
  'drop-base-row': (ctx, action) => {
    deleteItem(ctx.state, action.itemPath);
    ctx.invalidate();
  },
  'drop-base-module': (ctx, action) => {
    deleteModuleFromState(ctx.state, action.folder);
    ctx.invalidate();
  },

  'create-canvas-module': async (ctx, action) => {
    const result = await createModule(ctx.courseId, {
      name: action.name,
      position: action.position,
    });
    ensureModule(ctx.state, action.folder, {
      canvas_module_id: result.id,
      name: action.name,
      position: action.position,
    });
  },
  'update-canvas-module': async (ctx, action) => {
    await updateModule(ctx.courseId, moduleIdFor(ctx, action), {
      name: action.name,
      position: action.position,
    });
    ensureModule(ctx.state, action.folder, {
      name: action.name,
      position: action.position,
    });
  },
  'delete-canvas-module': async (ctx, action) => {
    try {
      await deleteCanvasModule(ctx.courseId, moduleIdFor(ctx, action));
    } catch (err) {
      if (!String(err.message).includes('404')) throw err;
    }
    deleteModuleFromState(ctx.state, action.folder);
    ctx.invalidate();
  },

  'create-canvas-item': createCanvasItem,
  'update-canvas-item': updateCanvasItem,
  'move-canvas-item': moveCanvasItem,
  'delete-canvas-item': deleteCanvasItem,
  'reorder-canvas-module': reorderCanvasModule,

  'create-local-module': (ctx, action) => {
    const dir = absolutePath(ctx, action.folder);
    fs.mkdirSync(dir, { recursive: true });
    writeCategoryFile(dir, action.name, action.position ?? 0);
    ensureModule(ctx.state, action.folder, {
      canvas_module_id: action.canvasModuleId,
      name: action.name,
      position: action.position,
    });
  },
  'update-local-module': (ctx, action) => {
    const dir = absolutePath(ctx, action.folder);
    const module = getModule(ctx.state, action.folder) || {};
    fs.mkdirSync(dir, { recursive: true });
    writeCategoryFile(dir, action.name, module.position ?? 0);
    ensureModule(ctx.state, action.folder, { name: action.name });
  },
  'delete-local-module': (ctx, action) => {
    fs.rmSync(absolutePath(ctx, action.folder), {
      recursive: true,
      force: true,
    });
    deleteModuleFromState(ctx.state, action.folder);
    ctx.invalidate();
  },

  'create-local-item': writeLocalItem,
  'update-local-item': writeLocalItem,
  'delete-local-item': deleteLocalItem,
  'reorder-local-module': reorderLocalModule,
};

/** What an action is called in a report line. */
function describeAction(action) {
  return action.itemPath || action.folder || action.from || action.type;
}

/**
 * The second pass, for items whose markdown linked to something this run had
 * not created yet.
 *
 * Push has always made this pass; what is new is that it re-records the
 * fingerprint. Writing the resolved HTML and leaving the row describing the
 * unresolved version would make every later sync see a Canvas-side change that
 * nobody made — and pull it over the author's file.
 */
async function resolvePendingLinks(ctx) {
  if (ctx.unresolved.size === 0) return;
  ctx.invalidate();
  for (const action of ctx.unresolved.values()) {
    const found = getItem(ctx.state, action.itemPath);
    if (!found) continue;
    try {
      const written = await writeContent(ctx, action, {
        canvasId: found.entry.canvas_id,
        folder: action.folder,
      });
      const moduleItemId = found.entry.module_item_id ?? null;
      recordCanvasWrite(ctx, action, {
        item: {
          id: moduleItemId,
          title: action.title,
          indent: action.indent ?? 0,
        },
        content: written.result,
        canvasId: written.canvasId,
        pageUrl: written.pageUrl,
      });
    } catch (err) {
      ctx.errors.push({
        action: { type: 'resolve-links', itemPath: action.itemPath },
        error: err.message,
      });
    }
  }
}

/**
 * Execute a plan.
 *
 * @param {object} plan - What `plan()` returned; only `actions` is read.
 * @param {object} options
 * @param {string|number} options.courseId
 * @param {string} options.courseDir      - Absolute path of `course/`.
 * @param {object} options.state          - Loaded sync state, written in place.
 * @param {Map} [options.canvasContent]   - What `gatherCanvas` returned as
 *   `content`: the raw module item and the object behind it, keyed by module
 *   item id. Lets a local write happen without fetching anything twice.
 * @param {Function} [options.save]       - Injection point for tests.
 * @param {Function} [options.now]        - Injection point for tests.
 * @param {object} [options.log]
 * @returns {Promise<{applied: object[], errors: object[]}>}
 */
async function applyPlan(plan, options = {}) {
  const ctx = createContext(plan, options);

  // The engine renders the HTML that names the alert icons, so the engine is
  // what makes them exist. Leaving that to each command is how `sync` shipped
  // reading `getIconUrls` with nothing ever calling `ensureIcons`: every
  // callout went to Canvas with no `<img>` at all — `markdownToHtml` simply
  // omits it when the URL is missing, so it degraded quietly — and the page was
  // then fingerprinted as synced, so no later run ever put the icon back.
  if (needsAlertIcons(plan)) {
    let failure = null;
    try {
      await ensureIcons(ctx.courseId, ctx.state);
    } catch (err) {
      failure = err;
      ctx.errors.push({
        action: { type: 'ensure-icons' },
        error:
          `the alert icons could not be uploaded (${err.message}), so nothing ` +
          'was written on either side. Every page, assignment and discussion ' +
          'this run would have pushed names those icons by URL, and Canvas is ' +
          'handed no <img> at all when the URL is missing — the callouts would ' +
          'go up unmarked, be recorded as synced, and no later run would put ' +
          'them back, because the fingerprints would match. Fix the upload and ' +
          'run again.',
      });
    }

    // Saved either way, and this is the reason stopping is not the same as
    // losing the work: whatever uploaded before the failure is recorded, so the
    // next run resumes from there instead of putting a second copy of those
    // icons into the Canvas course. `ensureIcons` skips an icon whose stored
    // theme fingerprint still matches, and that record is the whole of its
    // idempotency.
    ctx.save(ctx.state);

    if (failure) {
      // Before any action, so nothing has been written and stopping costs
      // nothing. `last_sync` is deliberately not stamped: no sync happened, and
      // a run that claims one poisons the base the next run reasons from.
      return { applied: ctx.applied, errors: ctx.errors };
    }

    ctx.iconUrls = getIconUrls(ctx.state);
  }

  for (const action of plan.actions || []) {
    const handler = HANDLERS[action.type];
    if (!handler) {
      ctx.errors.push({
        action,
        error: `no executor for action type "${action.type}".`,
      });
      continue;
    }
    try {
      await handler(ctx, action);
      ctx.applied.push(action);
    } catch (err) {
      // One failed action costs that action and nothing else. Stopping here
      // would leave Canvas half written with a state describing neither side.
      ctx.errors.push({ action, error: err.message });
      ctx.log.error(
        `  [sync] ${action.type} failed for ${describeAction(action)}: ${err.message}`,
      );
      ctx.save(ctx.state);
    }
  }

  await resolvePendingLinks(ctx);

  ctx.state.last_sync = ctx.now();
  ctx.save(ctx.state);
  return { applied: ctx.applied, errors: ctx.errors };
}

module.exports = { applyPlan };
// Exported for testing
module.exports._renumberPath = renumberPath;
