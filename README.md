# 뜨개한단

PDF 뜨개 도안을 보면서 지금 뜨는 단과 코 위치를 표시하는 개인용 웹앱(PWA)입니다.
서버 없이 동작하며, 도안 PDF와 진행 기록은 모두 기기 안(IndexedDB)에만 저장됩니다.

## 올리기 (GitHub Pages)

1. 이 폴더의 파일을 GitHub 저장소 최상위에 올린다.
2. 저장소 Settings → Pages → Branch를 `main` / `(root)`로 정하고 저장한다.
3. 몇 분 뒤 `https://<아이디>.github.io/<저장소 이름>/` 주소가 생긴다.

## 아이폰에 설치

1. Safari로 위 주소를 연다.
2. 공유 버튼 → "홈 화면에 추가".
3. 홈 화면 아이콘으로 실행한다. 한 번 열고 나면 인터넷 없이도 켜진다.

## 고친 뒤 다시 올릴 때

`python3 scripts/bump.py patch|minor|major "바뀐 점"`으로 버전을 올린 뒤 올린다. 버전 규칙과 기록은 `CHANGELOG.md`에 있다.
폰에서 앱을 인터넷이 되는 상태로 한 번 열었다 닫으면 새 버전으로 바뀐다. 저장된 도안과 기록은 그대로 남는다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html`, `app.css` | 화면 틀과 스타일 |
| `js/main.js` | 시작점: 주소(#/…)와 화면 잇기, 서비스 워커, 시작 화면 |
| `js/core.js` | 공통: 화면 이동, 라우터, 머리줄 |
| `js/views/home.js` | 첫 화면(작품 목록), 새 작품, 백업 |
| `js/views/project.js` | 작품 화면(파트 목록), 내 사이즈, 파트 추가·고치기 |
| `js/views/info.js` | 작품 정보 탭(실·바늘·게이지·메모·영상·기간), 사진 |
| `js/views/cal.js` | 격자 맞추기(기호 차트·원형 차트), 글 설명 영역 |
| `js/views/knit.js` | 뜨기 화면 세 가지(기호 차트·원형 차트·글 설명) |
| `js/partnav.js` | 파트 상태 글귀와 화면 주소 |
| `js/labels.js` | PDF 글자에서 단·코 번호와 글줄 읽기 |
| `js/memo.js`, `js/legend.js`, `js/videoui.js`, `js/dialogs.js` | 단 메모, 기호 설명, 참고 영상, 공용 창 |
| `js/rectpicker.js`, `js/pins.js` | 영역 끌어 잡기(차트·글 설명·기호 설명 공용), 도안 핀 |
| `js/circ.js`, `js/sizes.js`, `js/videos.js`, `js/backup.js`, `js/stackview.js` | 원형 차트 계산, 사이즈 숫자 읽기, QR·링크 찾기, 백업 파일, 이어 붙여 보기 |
| `js/version.js` | 버전 (`scripts/bump.py`가 고친다) |
| `js/chartview.js` | 도안 영역 확대·이동, 띠와 코 표시 그리기 |
| `js/knitting.js` | 격자 계산, 다음 단·이전 단·반복 규칙 |
| `js/db.js` | 기기 안 저장소(IndexedDB) |
| `js/pdf.js`, `vendor/` | PDF 표시(pdf.js, Apache-2.0) |
| `sw.js`, `manifest.webmanifest`, `icons/` | 오프라인 실행과 홈 화면 설치 |

## 이 버전에 없는 것

줄글 파트, 자유 띠, 단 메모, 작품 정보, 참고 영상, 백업 내보내기·가져오기.
