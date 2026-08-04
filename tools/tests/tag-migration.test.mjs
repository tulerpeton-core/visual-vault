import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { migrateLegacyTags } = require('../../electron/tag-migration.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL);
    CREATE TABLE image_tags (image_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (image_id, tag_id));
  `);
  return db;
}

test('renames Russian default tags to English', () => {
  const db = createDatabase();
  db.prepare('INSERT INTO tags (id, name, color) VALUES (1, ?, ?)').run('Референс', '#111111');
  db.prepare('INSERT INTO image_tags (image_id, tag_id) VALUES (10, 1)').run();

  migrateLegacyTags(db);

  assert.deepEqual([...db.prepare('SELECT name FROM tags').all()].map((row) => ({ ...row })), [{ name: 'Reference' }]);
  assert.deepEqual([...db.prepare('SELECT image_id, tag_id FROM image_tags').all()].map((row) => ({ ...row })), [{ image_id: 10, tag_id: 1 }]);
});

test('merges legacy tag links into an existing English tag', () => {
  const db = createDatabase();
  db.prepare('INSERT INTO tags (id, name, color) VALUES (1, ?, ?), (2, ?, ?)').run(
    'Работа', '#111111', 'Work', '#222222',
  );
  db.prepare('INSERT INTO image_tags (image_id, tag_id) VALUES (10, 1), (11, 2)').run();

  migrateLegacyTags(db);

  assert.deepEqual([...db.prepare('SELECT id, name FROM tags ORDER BY id').all()].map((row) => ({ ...row })), [{ id: 2, name: 'Work' }]);
  assert.deepEqual([...db.prepare('SELECT image_id, tag_id FROM image_tags ORDER BY image_id').all()].map((row) => ({ ...row })), [
    { image_id: 10, tag_id: 2 },
    { image_id: 11, tag_id: 2 },
  ]);
});
