#!/usr/bin/env bash
# 港途 · 打包 App Store / Google Play 版本嘅網頁內容（輸出去 www/，俾 Capacitor 用）
# 做法：複製網頁檔案 → 下載 Leaflet、字體、路線資料放入 app → 喺 www/index.html 改用內置檔案
# 喺有網絡嘅電腦（例如你部 Mac）行：bash scripts/build-app.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=www
rm -rf "$OUT" && mkdir -p "$OUT/vendor/leaflet/images" "$OUT/vendor/fonts" "$OUT/data"
cp -R index.html manifest.json sw.js icon-192.png icon-512.png css js "$OUT/"

echo "· 下載 Leaflet 1.9.4"
LF=https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4
curl -fsSL "$LF/leaflet.min.js"  -o "$OUT/vendor/leaflet/leaflet.min.js"
curl -fsSL "$LF/leaflet.min.css" -o "$OUT/vendor/leaflet/leaflet.min.css"
for f in layers.png layers-2x.png marker-icon.png marker-icon-2x.png marker-shadow.png; do
  curl -fsSL "$LF/images/$f" -o "$OUT/vendor/leaflet/images/$f"
done

echo "· 下載字體（woff2）"
FONT_CSS_URL='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700;900&display=swap'
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15'
curl -fsSL -A "$UA" "$FONT_CSS_URL" -o "$OUT/vendor/fonts/fonts.css"
grep -o 'https://fonts.gstatic.com/[^)]*' "$OUT/vendor/fonts/fonts.css" | sort -u | while read -r u; do
  f="$(echo "$u" | md5sum 2>/dev/null | cut -c1-12 || md5 -q -s "$u" | cut -c1-12).woff2"
  curl -fsSL "$u" -o "$OUT/vendor/fonts/$f"
  # macOS 同 Linux 嘅 sed 寫法唔同，用 perl 最穩陣
  perl -pi -e "s#\Q$u\E#$f#g" "$OUT/vendor/fonts/fonts.css"
done

echo "· 下載路線資料（約 8 MB）"
curl -fsSL https://data.hkbus.app/routeFareList.min.json -o "$OUT/data/routeFareList.min.json"

echo "· 改用內置檔案"
perl -0pi -e 's#<link rel="preconnect"[^>]*>\n##g; s#<link href="https://fonts.googleapis.com/[^"]*" rel="stylesheet">#<link href="vendor/fonts/fonts.css" rel="stylesheet">#; s#<link rel="manifest"#<script>window.HKGO_BUNDLED=true</script>\n<link rel="manifest"#' "$OUT/index.html"
# App 入面唔使 service worker（檔案本身已經喺 app 入面）
perl -pi -e "s#if \('serviceWorker' in navigator && location.protocol === 'https:'\)#if (!window.HKGO_BUNDLED \&\& 'serviceWorker' in navigator \&\& location.protocol === 'https:')#" "$OUT/js/app.js"

echo "完成：$OUT/ 已經準備好。下一步：npx cap sync ios"
