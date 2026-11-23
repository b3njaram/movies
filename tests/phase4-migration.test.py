"""New Phase 4 objects must be additive on an existing SQLite database."""
from pathlib import Path
import re
import sqlite3
import unittest
ROOT=Path(__file__).resolve().parents[1]

class Phase4Migration(unittest.TestCase):
 def test_additive_ddl_preserves_old_rows_and_foreign_keys(self):
  conn=sqlite3.connect(':memory:')
  conn.execute('PRAGMA foreign_keys=ON')
  conn.executescript('''
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT);
    CREATE TABLE profiles(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id));
    CREATE TABLE progress(profile_id INTEGER,content_key TEXT,title TEXT);
    CREATE TABLE my_list(profile_id INTEGER,media_type TEXT,tmdb_id INTEGER);
    INSERT INTO users VALUES(9,'legacy');INSERT INTO profiles VALUES(8,9);
    INSERT INTO progress VALUES(8,'movie:42','Old watched movie');
    INSERT INTO my_list VALUES(8,'movie',42);
  ''')
  for filename in ('backend/community-db.js','backend/local-media.js'):
   src=(ROOT/filename).read_text()
   match=re.search(r'db\.exec\(`(.*?)`\);',src,re.S)
   self.assertIsNotNone(match,f'Missing schema in {filename}')
   conn.executescript(match.group(1))
  self.assertEqual(conn.execute("SELECT title FROM progress").fetchone()[0],'Old watched movie')
  self.assertEqual(conn.execute('SELECT COUNT(*) FROM my_list').fetchone()[0],1)
  conn.execute('INSERT INTO community_collections(profile_id,name,created_at) VALUES(8,?,1)',('Favorites',))
  c=conn.execute('SELECT id FROM community_collections').fetchone()[0]
  conn.execute('INSERT INTO community_collection_items VALUES(?,?,?,?,?,1)',(c,'movie',42,'Film',None))
  conn.execute('DELETE FROM profiles WHERE id=8')
  self.assertEqual(conn.execute('SELECT COUNT(*) FROM community_collection_items').fetchone()[0],0)
  self.assertEqual(conn.execute('SELECT COUNT(*) FROM progress').fetchone()[0],1)

if __name__=='__main__':unittest.main()
