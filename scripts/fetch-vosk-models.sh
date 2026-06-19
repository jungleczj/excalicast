#!/usr/bin/env bash
# 下载并打包提词器智能跟读用的 vosk 离线模型到 public/models/vosk/。
# vosk-browser 需要 gzipped-tar（解压出 `model/` 目录）。模型文件较大（各 ~40MB），
# 已 .gitignore，不入库；部署/本地首次需运行本脚本（或换 CDN 改 NEXT_PUBLIC_VOSK_MODEL_*_URL）。
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="public/models/vosk"
TMP="$DIR/.tmp"
mkdir -p "$DIR" "$TMP"

fetch() { # url  workname  outfile
  local url="$1" name="$2" out="$3"
  echo "↓ $url"
  curl -fL --retry 3 -o "$TMP/$name.zip" "$url"
  rm -rf "$TMP/$name"; mkdir -p "$TMP/$name"
  unzip -q "$TMP/$name.zip" -d "$TMP/$name"
  local top; top="$(ls "$TMP/$name" | head -1)"
  rm -rf "$TMP/$name/model"; mv "$TMP/$name/$top" "$TMP/$name/model"
  ( cd "$TMP/$name" && tar czf "$OLDPWD/$DIR/$out" model )
  echo "✓ $DIR/$out"
}

fetch "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip"    cn vosk-model-small-cn.tar.gz
fetch "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip" en vosk-model-small-en-us.tar.gz

rm -rf "$TMP"
echo "done."
