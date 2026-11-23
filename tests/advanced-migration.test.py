#!/usr/bin/env python3
"""Apply the new additive Phase 3 SQLite DDL to a Phase 2 database clone."""
import re
import sqlite3
from pathlib import Path
root=Path(__file__).resolve().parents[1]
legacy=sqlite3.connect(':memory:')
base=(root/'backend/db.js').read_text()
legacy.executescript(re.search(r'db\.exec\(`(.*?)`\);',base,re.S).group(1))
legacy.execute("INSERT INTO users(username,password_hash) VALUES ('viewer','hash')")
legacy.execute("INSERT INTO profiles(user_id,name,kids) VALUES (1,'Family',1)")
legacy.execute("INSERT INTO progress(profile_id,content_key,media_type,title,position_seconds) VALUES (1,'movie:22','movie','Saved Movie',120)")
legacy.execute("INSERT INTO my_list(profile_id,media_type,tmdb_id,title) VALUES (1,'movie',22,'Saved Movie')")
for line in ["ALTER TABLE profiles ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'", "ALTER TABLE profiles ADD COLUMN sub_lang TEXT NOT NULL DEFAULT 'off'", "ALTER TABLE profiles ADD COLUMN ui_lang TEXT NOT NULL DEFAULT 'en'", "ALTER TABLE profiles ADD COLUMN pin_hash TEXT", "ALTER TABLE profiles ADD COLUMN pin_version INTEGER NOT NULL DEFAULT 0", "ALTER TABLE profiles ADD COLUMN max_age INTEGER", "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0", "ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0", "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0"]:
    legacy.execute(line)
legacy.execute("UPDATE profiles SET max_age=10 WHERE kids=1")
advanced=(root/'backend/advanced-db.js').read_text()
new_schema=re.search(r'db\.exec\(`(.*?)`\);',advanced,re.S).group(1)
legacy.executescript(new_schema)
for col in ["ALTER TABLE profiles ADD COLUMN playback_quality TEXT NOT NULL DEFAULT 'auto'", 'ALTER TABLE profiles ADD COLUMN bandwidth_mbps INTEGER NOT NULL DEFAULT 0']:
    assert col in advanced
    legacy.execute(col)
assert legacy.execute('SELECT username,password_hash FROM users').fetchone()==('viewer','hash')
assert legacy.execute('SELECT name,max_age,playback_quality,bandwidth_mbps FROM profiles').fetchone()==('Family',10,'auto',0)
assert legacy.execute('SELECT title,position_seconds FROM progress').fetchone()==('Saved Movie',120)
assert legacy.execute('SELECT title FROM my_list').fetchone()==('Saved Movie',)
legacy.execute('INSERT INTO download_jobs(user_id,profile_id,hash,file_index,file_name,title,content_key,media_type) VALUES (1,1,?,?,?, ?,?,?)',('a'*40,1,'film.mkv','Film','movie:22','movie'))
legacy.execute('INSERT INTO playback_devices(profile_id,device_id,device_name,content_key,media_type,title,updated_at) VALUES (1,?,?,?, ?,?,?)',('device_1234567890','Browser','movie:22','movie','Film',1234))
assert legacy.execute('SELECT count(*) FROM download_jobs').fetchone()[0]==1
assert legacy.execute('SELECT count(*) FROM playback_devices').fetchone()[0]==1
assert 'data/app:/app/data' in (root/'docker-compose.yml').read_text()
assert '.env' in (root/'.gitignore').read_text()
print('PASS: additive Phase 3 migration, old data, existing mounts and .env ignore unchanged')
