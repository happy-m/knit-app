#!/usr/bin/env python3
"""버전 올리기: python3 scripts/bump.py patch|minor|major "바뀐 점"

- major: 데이터 형식이 바뀌어 예전 백업과 호환되지 않는 등 큰 변경
- minor: 새 기능
- patch: 버그 수정, 문구·디자인 손보기

js/main.js의 APP_VERSION, sw.js의 VERSION(캐시 이름)을 함께 바꾸고
CHANGELOG.md 맨 위에 항목을 추가한다. 커밋과 태그(vX.Y.Z)는 직접 한다.
"""
import datetime, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
kind = sys.argv[1] if len(sys.argv) > 1 else ''
note = sys.argv[2] if len(sys.argv) > 2 else ''
if kind not in ('major', 'minor', 'patch') or not note:
    sys.exit(__doc__)

main = ROOT / 'js/main.js'
src = main.read_text()
cur = re.search(r"const APP_VERSION = '(\d+)\.(\d+)\.(\d+)';", src)
ma, mi, pa = map(int, cur.groups())
ma, mi, pa = {'major': (ma + 1, 0, 0), 'minor': (ma, mi + 1, 0), 'patch': (ma, mi, pa + 1)}[kind]
new = f'{ma}.{mi}.{pa}'

main.write_text(src.replace(cur.group(0), f"const APP_VERSION = '{new}';"))
sw = ROOT / 'sw.js'
sw.write_text(re.sub(r"const VERSION = 'knit-[^']*';", f"const VERSION = 'knit-{new}';", sw.read_text()))

log = ROOT / 'CHANGELOG.md'
text = log.read_text()
head, _, rest = text.partition('\n## ')
entry = f"\n## {new} — {datetime.date.today():%Y-%m-%d}\n- {note}\n"
log.write_text(head.rstrip('\n') + '\n' + entry + ('\n## ' + rest if rest else ''))
print(f'{cur.group(1)}.{cur.group(2)}.{cur.group(3)} → {new}')
