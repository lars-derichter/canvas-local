const fs = require('fs');
const path = require('path');
const { pad, safeReadJSON } = require('./module-utils');

/**
 * Update the position field in a _category_.json file inside a directory entry.
 */
function updateCategoryPosition(dirPath, entryName, newPosition) {
  const catFile = path.join(dirPath, entryName, '_category_.json');
  if (!fs.existsSync(catFile)) return;
  const cat = safeReadJSON(catFile, null);
  if (!cat) return;
  cat.position = newPosition;
  fs.writeFileSync(catFile, JSON.stringify(cat, null, 2) + '\n', 'utf8');
}

/**
 * Renumber all entries in a directory sequentially (1, 2, 3, ...).
 * Uses a two-pass rename via temp names to avoid collisions.
 *
 * @param {string} dirPath - Directory containing the entries to renumber.
 * @param {Function} getEntries - Function that returns sorted array of { prefix, name, isDirectory }.
 * @returns {Array<{from: string, to: string}>} Array of renames performed.
 */
function renumberSequential(dirPath, getEntries) {
  const items = getEntries(dirPath);
  const tempPrefix = '__renumber_temp_';
  const renames = [];

  // First pass: rename all to temp names
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const tempName = `${tempPrefix}${pad(i + 1)}-${item.name.replace(/^\d+-/, '')}`;
    fs.renameSync(path.join(dirPath, item.name), path.join(dirPath, tempName));
    items[i] = { ...item, _tempName: tempName };
  }

  // Second pass: rename from temp to final sequential names
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const newPrefix = i + 1;
    const newName = item.name.replace(/^\d+/, pad(newPrefix));
    fs.renameSync(path.join(dirPath, item._tempName), path.join(dirPath, newName));

    if (item.isDirectory) {
      updateCategoryPosition(dirPath, newName, newPrefix);
    }

    if (newName !== item.name) {
      renames.push({ from: item.name, to: newName });
    }
  }

  return renames;
}

/**
 * Shift entries at or above a given position up by 1 to make room for an insertion.
 *
 * @param {string} dirPath - Directory containing the entries.
 * @param {Array} items - Sorted array of { prefix, name, isDirectory }.
 * @param {number} fromPosition - Position at which to start shifting.
 * @returns {Array<{from: string, to: string}>} Array of renames performed.
 */
function renumberUp(dirPath, items, fromPosition) {
  const toRenumber = items
    .filter((i) => i.prefix >= fromPosition)
    .sort((a, b) => b.prefix - a.prefix); // rename highest first to avoid collisions

  const renames = [];
  for (const item of toRenumber) {
    const newName = item.name.replace(/^\d+/, pad(item.prefix + 1));
    if (newName === item.name) continue;
    fs.renameSync(path.join(dirPath, item.name), path.join(dirPath, newName));

    if (item.isDirectory) {
      updateCategoryPosition(dirPath, newName, item.prefix + 1);
    }

    renames.push({ from: item.name, to: newName });
  }
  return renames;
}

/**
 * Reorder entries by moving one to a new position, then renumbering all sequentially.
 * Uses a two-pass rename via temp names.
 *
 * @param {string} dirPath - Directory containing the entries.
 * @param {Array} entries - Sorted array of { prefix, name, isDirectory, folderName? }.
 * @param {number} sourcePrefix - Current prefix of the entry to move.
 * @param {number} targetPosition - 1-based target position.
 * @returns {Array<{from: string, to: string}>} Array of renames performed.
 */
function reorder(dirPath, entries, sourcePrefix, targetPosition) {
  const source = entries.find((e) => e.prefix === sourcePrefix);
  const remaining = entries.filter((e) => e.prefix !== sourcePrefix);
  remaining.splice(targetPosition - 1, 0, source);

  const tempPrefix = '__reorder_temp_';
  const renames = [];

  // First pass: rename all to temp names
  for (let i = 0; i < remaining.length; i++) {
    const entry = remaining[i];
    const nameWithoutPrefix = entry.name.replace(/^\d+-/, '');
    const tempName = `${tempPrefix}${pad(i + 1)}-${nameWithoutPrefix}`;
    fs.renameSync(path.join(dirPath, entry.name), path.join(dirPath, tempName));
    remaining[i] = { ...entry, _tempName: tempName };
  }

  // Second pass: rename from temp to final names
  for (let i = 0; i < remaining.length; i++) {
    const entry = remaining[i];
    const newPrefix = i + 1;
    const newName = entry.name.replace(/^\d+/, pad(newPrefix));
    fs.renameSync(path.join(dirPath, entry._tempName), path.join(dirPath, newName));

    if (entry.isDirectory !== false) {
      updateCategoryPosition(dirPath, newName, newPrefix);
    }

    if (newName !== entry.name) {
      renames.push({ from: entry.name, to: newName });
    }
  }

  return renames;
}

module.exports = {
  renumberSequential,
  renumberUp,
  reorder,
};
