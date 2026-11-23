#!/usr/bin/env python3
"""Verify the additive SQLite schema on a real legacy schema without deleting rows."""
import re
import sqlite3
from pathlib import Path

src = (Path(__file__).resolve().parent.parent/'backend/db.js').read_text()
initial = re.search(r'db\.exec\(`(.*?)`\);', src, re.S).group(1)
legacy = sqlite3.connect(':memory:')
legacy.executescript(initial)
legacy.execute('INSERT INTO users(username,password_hash) VALUES (?,?)', ('original', 'hash-old'))
legacy.execute('INSERT INTO profiles(user_id,name,avatar,kids) VALUES (1,?,?,?)', ('Original Viewer',0,0))
legacy.execute('INSERT INTO progress(profile_id,content_key,media_type,title) VALUES (1,?,?,?)',('movie:1','movie','Movie'))
legacy.execute('INSERT INTO my_list(profile_id,media_type,tmdb_id,title) VALUES (1,?,?,?)',('movie',1,'Movie'))
try:
    legacy.execute("ALTER TABLE profiles ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'")
except sqlite3.OperationalError:
    pass
columns = [
  "ALTER TABLE profiles ADD COLUMN sub_lang TEXT NOT NULL DEFAULT 'off'",
  "ALTER TABLE profiles ADD COLUMN ui_lang TEXT NOT NULL DEFAULT 'en'",
  "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE profiles ADD COLUMN pin_hash TEXT",
  "ALTER TABLE profiles ADD COLUMN pin_version INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE profiles ADD COLUMN max_age INTEGER",
]
for ddl in columns: assert ddl in src; legacy.execute(ddl)
legacy.execute('UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)')
legacy.execute('UPDATE profiles SET max_age = CASE WHEN kids = 1 THEN 10 ELSE 18 END WHERE max_age IS NULL')
legacy.executescript('CREATE TABLE IF NOT EXISTS skip_markers (profile_id INTEGER NOT NULL, content_key TEXT NOT NULL, intro_start INTEGER, intro_end INTEGER, credits_start INTEGER, PRIMARY KEY(profile_id,content_key), FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE);')
assert legacy.execute('SELECT username,password_hash,is_admin,disabled,session_version FROM users').fetchone()==('original','hash-old',1,0,0)
assert legacy.execute('SELECT name,lang,sub_lang,ui_lang,max_age,pin_hash,pin_version FROM profiles').fetchone()==('Original Viewer','en','off','en',18,None,0)
assert legacy.execute('SELECT title FROM progress').fetchone()==('Movie',)
assert legacy.execute('SELECT title FROM my_list').fetchone()==('Movie',)
legacy.execute('INSERT INTO skip_markers(profile_id,content_key,intro_start,intro_end) VALUES (1,?,?,?)', ('movie:1',10,85))
assert legacy.execute('SELECT intro_start,intro_end FROM skip_markers').fetchone()==(10,85)
assert 'data/app:/app/data' in (Path(__file__).resolve().parent.parent/'docker-compose.yml').read_text()
print('PASS: existing accounts, profiles, progress, My List and DB mount preserved')
