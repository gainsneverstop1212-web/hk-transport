# 準時度紀錄

定時記低九巴／城巴到站預報，之後推算：

- **遲咗幾多**：實際到站時間減「到站前 10 分鐘」嗰陣嘅預報（例如「呢個站嘅 1A 通常遲 1.5 分鐘」）
- **幽靈巴士**：預報仲有 3 分鐘以上就到，但突然消失、附近冇另一班補上

## 點運作

- `.github/workflows/punctuality.yml`：GitHub Actions 每 10 分鐘觸發一次（香港時間 06:04–23:54，避開整點），每次連續記錄 14 分鐘、每 30 秒一次。記錄長過觸發間隔，排程被跳過一次都唔會斷資料。公開 repo 免費。
- 原始資料：`punctuality-data` 分支 `raw/YYYY-MM-DD.ndjson`；分析結果：同一分支 `summary.json`。
- App 之後可以讀 `https://raw.githubusercontent.com/<用戶>/hk-transport/punctuality-data/summary.json`。

## 改記錄邊啲路線

改 `watch.json`。每行資料用「公司:路線:方向:service_type:車站」做識別，所以加減路線、改次序都唔會令舊資料對錯路線。九巴車站 ID 可以喺 `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/1A/outbound/1` 查。建議放你自己每日搭嘅路線同上車站，數據越早開始儲越有用。

## 自己部機試

```bash
DURATION_SEC=120 node tools/punctuality/collect.mjs tools/punctuality/raw
node tools/punctuality/analyze.mjs tools/punctuality/raw tools/punctuality/summary.json
```

## 要知

- GitHub 嘅排程唔係分秒不差，繁忙時會遲幾分鐘開始，甚至跳過；新加嘅排程可能要幾個鐘先開始觸發。中間有空檔嘅時段分析會跳過。
- Actions 頁見到部分 run「cancelled」係正常：上一次仲記緊，排隊嘅觸發被新嗰個取代。
- 公開 repo 如果 60 日冇任何 commit 去主分支，GitHub 會自動暫停排程，要去 Actions 頁重新開。
- 「實際到站」係由預報推算（冇 GPS），所以係估計；記錄得越多日越準。
