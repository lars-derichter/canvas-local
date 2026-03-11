const matter = require('gray-matter');
const fs = require('fs');
const path = require('path');

/**
 * Parse YAML frontmatter from a file content string.
 * @param {string} fileContent - Raw file content with optional YAML frontmatter.
 * @returns {{ data: object, content: string }} Parsed frontmatter data and body content.
 */
function parseFrontmatter(fileContent) {
  const result = matter(fileContent);
  return { data: result.data, content: result.content };
}

/**
 * Serialize frontmatter data and body content back into a full file string.
 * @param {object} data - Frontmatter key-value pairs.
 * @param {string} content - Markdown body content.
 * @returns {string} Full file string with YAML frontmatter block.
 */
function serializeFrontmatter(data, content) {
  // gray-matter.stringify adds frontmatter fences and joins with content
  return matter.stringify(content, data);
}

/**
 * Read a file, merge updates into its frontmatter, and write it back.
 * Useful for writing back canvas_id after first push.
 * @param {string} filePath - Absolute or relative path to the markdown file.
 * @param {object} updates - Key-value pairs to merge into existing frontmatter.
 */
function updateFrontmatter(filePath, updates) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const { data, content } = parseFrontmatter(raw);

  const merged = { ...data, ...updates };
  const output = serializeFrontmatter(merged, content);

  fs.writeFileSync(resolved, output, 'utf8');
}

module.exports = {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
};
