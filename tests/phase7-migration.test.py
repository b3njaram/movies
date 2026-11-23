"""New-episode tracking only adds profile-scoped tables to an existing SQLite database."""
import sqlite3
import re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
text=(root/'backend/episode-following.js').read_text()
schema=re.search(r'db\.exec\(`(.*?)`\);',text,re.S)
assert schema, 'No additive follow migration found'
con=sqlite3.connect(':memory:')
con.execute('PRAGMA foreign_keys=ON')
con.executescript('''
CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,password_hash TEXT);
CREATE TABLE profiles(id INTEGER PRIMARY KEY,user_id INTEGER,max_age INTEGER);
CREATE TABLE progress(profile_id INTEGER,content_key TEXT,position_seconds REAL);
CREATE TABLE my_list(profile_id INTEGER,media_type TEXT,tmdb_id INTEGER);
INSERT INTO users VALUES(1,'existing','password-hash');
INSERT INTO profiles VALUES(5,1,18);
INSERT INTO progress VALUES(5,'tv:99:s1e1',120.0);
INSERT INTO my_list VALUES(5,'tv',99);
''')
con.executescript(schema.group(1))
con.execute("INSERT INTO tv_episode_follows(profile_id,tv_id,title,followed_at) VALUES(5,99,'Existing show',1000)")
con.executescript(schema.group(1))
assert con.execute('SELECT username,password_hash FROM users').fetchone()==('existing','password-hash')
assert con.execute('SELECT content_key,position_seconds FROM progress').fetchone()==('tv:99:s1e1',120)
assert con.execute('SELECT media_type,tmdb_id FROM my_list').fetchone()==('tv',99)
assert con.execute('SELECT tv_id,title FROM tv_episode_follows').fetchone()==(99,'Existing show')
con.execute('DELETE FROM profiles WHERE id=5')
assert con.execute('SELECT COUNT(*) FROM tv_episode_follows').fetchone()[0]==0
assert "./data/app:/app/data" in (root/'docker-compose.yml').read_text()
assert ".env" in (root/'.gitignore').read_text()
print('Phase 7 additive follows migration and original data mounts passed.')
