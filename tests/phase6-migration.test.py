"""Additive engagement schema: old account/profile/watch data survives unchanged."""
import sqlite3
import re
from pathlib import Path

root=Path(__file__).resolve().parents[1]
source=(root/'backend/engagement.js').read_text()
sql=re.search(r'db\.exec\(`(.*?)`\);',source,re.S)
assert sql, 'Could not locate engagement table migration'
con=sqlite3.connect(':memory:')
con.executescript('''
PRAGMA foreign_keys=ON;
CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT);
CREATE TABLE profiles(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,name TEXT);
CREATE TABLE progress(id INTEGER PRIMARY KEY,profile_id INTEGER,media_type TEXT,tmdb_id INTEGER,completed INTEGER,updated_at TEXT);
CREATE TABLE my_list(profile_id INTEGER,media_type TEXT,tmdb_id INTEGER,title TEXT);
INSERT INTO users VALUES(1,'existing','hash');
INSERT INTO profiles VALUES(5,1,'Original profile');
INSERT INTO progress VALUES(8,5,'movie',123,1,'2026-01-01');
INSERT INTO my_list VALUES(5,'movie',123,'Old favorite');
''')
con.executescript(sql.group(1))
con.execute('INSERT INTO profile_notifications(profile_id,event_key,kind,title,message,created_at) VALUES(5,?,?,?,?,?)',('job:1','download','Done','Ready',100))
con.execute('INSERT INTO profile_home_preferences(profile_id,hide_watched) VALUES(5,1)')
con.executescript(sql.group(1))
assert con.execute('SELECT username,password_hash FROM users').fetchone()==('existing','hash')
assert con.execute('SELECT id,name FROM profiles').fetchone()==(5,'Original profile')
assert con.execute('SELECT tmdb_id,completed FROM progress').fetchone()==(123,1)
assert con.execute('SELECT title FROM my_list').fetchone()==('Old favorite',)
assert con.execute('SELECT COUNT(*) FROM profile_notifications').fetchone()[0]==1
assert con.execute('SELECT hide_watched FROM profile_home_preferences').fetchone()[0]==1
con.execute('DELETE FROM profiles WHERE id=5')
assert con.execute('SELECT COUNT(*) FROM profile_notifications').fetchone()[0]==0
assert con.execute('SELECT COUNT(*) FROM profile_home_preferences').fetchone()[0]==0
print('Phase 6 additive migration and cascade preserved.')
