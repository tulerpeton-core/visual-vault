const legacyTagNames = new Map([
  ['Мем', 'Inspiration'],
  ['Референс', 'Reference'],
  ['Работа', 'Work'],
  ['Баг', 'UI'],
  ['Иллюстрация', 'Illustration'],
  ['Код', 'UI'],
  ['ÐœÐµÐ¼', 'Inspiration'],
  ['Ð ÐµÑ„ÐµÑ€ÐµÐ½Ñ', 'Reference'],
  ['Ð Ð°Ð±Ð¾Ñ‚Ð°', 'Work'],
  ['Ð‘Ð°Ð³', 'UI'],
  ['Ð˜Ð»Ð»ÑŽÑÑ‚Ñ€Ð°Ñ†Ð¸Ñ', 'Illustration'],
  ['ÐšÐ¾Ð´', 'UI'],
]);

function migrateLegacyTags(db) {
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  for (const [legacyName, englishName] of legacyTagNames) {
    const legacyTag = findTag.get(legacyName);
    if (!legacyTag) continue;
    const englishTag = findTag.get(englishName);
    if (!englishTag) {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(englishName, legacyTag.id);
      continue;
    }
    db.prepare(
      `INSERT OR IGNORE INTO image_tags (image_id, tag_id)
       SELECT image_id, ? FROM image_tags WHERE tag_id = ?`,
    ).run(englishTag.id, legacyTag.id);
    db.prepare('DELETE FROM image_tags WHERE tag_id = ?').run(legacyTag.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(legacyTag.id);
  }
}

module.exports = { legacyTagNames, migrateLegacyTags };
