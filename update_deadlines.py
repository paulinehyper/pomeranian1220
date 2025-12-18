# 이메일 본문에서 deadline을 재추출하여 DB에 업데이트
import sqlite3
import re
from datetime import datetime

def extract_deadline(body):
    if not body:
        return None
    # 1. YYYY년 MM월 DD일
    m = re.search(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', body)
    if m:
        return f"{m.group(1)}/{int(m.group(2)):02d}/{int(m.group(3)):02d}"
    # 2. YYYY-MM-DD, YYYY/MM/DD
    m = re.search(r'(\d{4})[./-](\d{1,2})[./-](\d{1,2})', body)
    if m:
        return f"{m.group(1)}/{int(m.group(2)):02d}/{int(m.group(3)):02d}"
    # 3. MM월 DD일
    m = re.search(r'(\d{1,2})월\s?(\d{1,2})일', body)
    if m:
        return f"{datetime.now().year}/{int(m.group(1)):02d}/{int(m.group(2)):02d}"
    # 4. MM/DD, MM-DD
    m = re.search(r'(\d{1,2})[./-](\d{1,2})', body)
    if m:
        return f"{datetime.now().year}/{int(m.group(1)):02d}/{int(m.group(2)):02d}"
    # 5. DD일까지, DD일
    m = re.search(r'(\d{1,2})일(까지)?', body)
    if m:
        return f"{datetime.now().year}/{datetime.now().month:02d}/{int(m.group(1)):02d}"
    return None

conn = sqlite3.connect('todo.db')
c = conn.cursor()
rows = c.execute("SELECT id, subject, body FROM emails").fetchall()
updated = 0
for row in rows:
    id, subject, body = row
    deadline = extract_deadline(subject + ' ' + (body or ''))
    if deadline:
        c.execute("UPDATE emails SET deadline = ? WHERE id = ?", (deadline, id))
        updated += 1
conn.commit()
conn.close()
print(f"Updated {updated} emails with deadline.")
