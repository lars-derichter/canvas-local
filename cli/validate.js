const fs = require('fs');
const path = require('path');

const { scanCourse } = require('../lib/convert/course-scanner');
const { parseFrontmatter } = require('../lib/convert/frontmatter');
const { extractFileReferences } = require('../lib/convert/link-resolver');

const COURSE_DIR = path.resolve(process.cwd(), 'course');

const VALID_CANVAS_TYPES = new Set(['page', 'assignment', 'external_url']);

/**
 * Flatten items list, expanding subheader children.
 */
function flattenItems(items) {
  const result = [];
  for (const item of items) {
    if (item.type === 'subheader') {
      result.push(item);
      if (item.items) {
        for (const child of item.items) {
          result.push(child);
        }
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

async function validate() {
  if (!fs.existsSync(COURSE_DIR)) {
    console.error('[validate] No course/ directory found.');
    process.exit(1);
  }

  const modules = scanCourse(COURSE_DIR);
  const errors = [];
  const warnings = [];

  // Build a set of all known relative paths for link validation
  const allPaths = new Set();
  for (const mod of modules) {
    const flatItems = flattenItems(mod.items);
    for (const item of flatItems) {
      if (item.relativePath) {
        allPaths.add(item.relativePath);
      }
    }
  }

  console.log(`[validate] Checking ${modules.length} module(s)...\n`);

  for (const mod of modules) {
    // Check module naming convention
    if (!mod.folderName.match(/^\d{2}-/)) {
      warnings.push(`${mod.folderName}: folder name should start with a two-digit prefix (e.g. 01-)`);
    }

    const flatItems = flattenItems(mod.items);

    for (const item of flatItems) {
      if (item.type === 'subheader') continue;
      if (item.canvasType === 'file') continue; // Non-markdown files

      const filePath = path.resolve(COURSE_DIR, item.relativePath);

      // Check naming convention
      if (!item.file.match(/^\d{2}-/)) {
        warnings.push(`${item.relativePath}: filename should start with a two-digit prefix`);
      }

      // Validate frontmatter
      let raw;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        errors.push(`${item.relativePath}: cannot read file: ${err.message}`);
        continue;
      }

      let data;
      try {
        ({ data } = parseFrontmatter(raw));
      } catch (err) {
        errors.push(`${item.relativePath}: invalid frontmatter YAML: ${err.message}`);
        continue;
      }

      // Check canvas_type
      if (data.canvas_type && !VALID_CANVAS_TYPES.has(data.canvas_type)) {
        errors.push(`${item.relativePath}: unknown canvas_type "${data.canvas_type}" (expected: ${[...VALID_CANVAS_TYPES].join(', ')})`);
      }

      // Check external_url has a URL
      if (data.canvas_type === 'external_url' && !data.external_url) {
        errors.push(`${item.relativePath}: external_url type requires an external_url field`);
      }

      // Validate external_url format
      if (data.external_url) {
        try {
          new URL(data.external_url);
        } catch (_) {
          errors.push(`${item.relativePath}: invalid external_url "${data.external_url}"`);
        }
      }

      // Check internal links
      const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(raw)) !== null) {
        const href = match[2].split(/\s+/)[0]; // Strip title
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#') || href.startsWith('//')) {
          continue;
        }
        if (!href.endsWith('.md')) continue;

        // Resolve relative to the item's directory
        const itemDir = path.dirname(item.relativePath);
        const resolved = path.posix.normalize(path.posix.join(itemDir, href.split('#')[0]));

        if (!allPaths.has(resolved)) {
          errors.push(`${item.relativePath}: broken link to "${href}" (resolved: ${resolved})`);
        }
      }

      // Check file references exist on disk
      try {
        const refs = extractFileReferences(raw, item.relativePath);
        for (const ref of refs) {
          const refPath = path.resolve(COURSE_DIR, ref);
          if (!fs.existsSync(refPath)) {
            errors.push(`${item.relativePath}: referenced file not found: ${ref}`);
          }
        }
      } catch (_) {
        // extractFileReferences may fail on unusual content
      }
    }
  }

  // Report results
  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  ⚠ ${w}`);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e}`);
    }
    console.log();
    console.log(`[validate] Found ${errors.length} error(s) and ${warnings.length} warning(s).`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`[validate] No errors. ${warnings.length} warning(s).`);
  } else {
    console.log('[validate] All checks passed.');
  }
}

module.exports = validate;
