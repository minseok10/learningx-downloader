#!/usr/bin/env bash
# Safari Web Extension 빌드 스크립트 (macOS + Xcode 필요)
#
# 1) dist/safari/extension 에 Safari용 manifest로 확장 파일을 복사하고
# 2) xcrun safari-web-extension-converter 로 Xcode 프로젝트를 생성합니다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/safari"
EXT="$OUT/extension"

rm -rf "$OUT"
mkdir -p "$EXT"

cp "$ROOT"/{background.js,popup.html,popup.js,style.css,icon-16.png,icon-48.png,icon-128.png} "$EXT/"

# Safari용 manifest:
#  - webRequest 제거 (Safari MV3에서 미지원, popup이 프레임을 직접 스캔함)
#  - background는 non-persistent 스크립트로 지정
#  - 프레임 스캔/메타데이터 조회를 위해 commons.khu.ac.kr 권한 유지
python3 - "$ROOT/manifest.json" "$EXT/manifest.json" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
m = json.load(open(src, encoding="utf-8"))
m["permissions"] = [p for p in m.get("permissions", []) if p != "webRequest"]
m["background"] = {"scripts": ["background.js"], "persistent": False}
json.dump(m, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY

echo "Safari용 확장 파일 생성: $EXT"

if [[ "$(uname)" != "Darwin" ]] || ! command -v xcrun >/dev/null 2>&1; then
  echo "macOS/Xcode가 없어 Xcode 프로젝트 변환은 건너뜁니다."
  echo "Mac에서 다시 실행하거나 아래 명령을 직접 실행하세요:"
  echo "  xcrun safari-web-extension-converter \"$EXT\" --project-location \"$OUT\" --app-name \"LearningX Downloader\" --bundle-identifier com.mechaminu.learningx-downloader --macos-only --copy-resources --no-open"
  exit 0
fi

xcrun safari-web-extension-converter "$EXT" \
  --project-location "$OUT" \
  --app-name "LearningX Downloader" \
  --bundle-identifier "com.mechaminu.learningx-downloader" \
  --macos-only \
  --copy-resources \
  --no-open \
  --force

echo
echo "Xcode 프로젝트 생성 완료: $OUT/LearningX Downloader"
echo "Xcode로 열어 실행(⌘R)한 뒤 Safari 설정 > 확장 프로그램에서 활성화하세요."
