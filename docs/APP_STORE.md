# 港住走 · 上架 App Store 步驟

網頁版（GitHub Pages）照舊運作。App 版用 Capacitor 將同一套網頁包成 iOS／Android app。

## 一次性準備（要用 Mac）

1. 安裝 Xcode 26 或以上同 Node.js。
2. 喺 repo 入面行：`npm install`，然後 `npx cap add ios`。
3. 打開 `ios/App/App/Info.plist`，加：
   - `NSLocationWhenInUseUsageDescription`：「用嚟搵你附近嘅車站同計步行時間」
4. 喺 Xcode 揀你嘅 Apple Developer Team，Bundle ID 用 `hk.gangtou.app`（`capacitor.config.json` 可以改）。

## 每次出新版

```
npm run ios
```

呢個指令會：

1. 行 `scripts/build-app.sh`：複製網頁檔案去 `www/`，下載 Leaflet、字體同路線資料放入 app（冇網都開到、第一次開唔使等 8 MB）。
2. `npx cap sync ios`，再打開 Xcode。
3. 喺 Xcode：Product → Archive → Distribute App → App Store Connect。

## 已經做好嘅原生功能

- **出門同落車通知**：App 版會用系統通知預約（`@capacitor/local-notifications`），鎖機或者轉咗去其他 app 都會準時響。網頁版就只喺 app 開住先響。

## 仲要喺 Xcode 加嘅功能（過 App Store 審核 4.2 好有幫助）

呢幾樣要寫 Swift，喺呢個 repo 冇辦法直接 build：

- **主畫面／鎖屏 Widget**：新增 Widget Extension，用 App Group 讀 app 存低嘅常用路線，定時 call 運輸署到站 API。
- **出門倒數 Live Activity／動態島**：新增 ActivityKit target，喺開始出門倒數時啟動。
- **Siri 捷徑**：App Intents，例如「下一班 91M 幾時到」。

## 提交前清單

- App icon：1024×1024 PNG，冇透明背景（已經準備好：`resources/icon-1024.png`，方角、冇圓角，系統會自己切圓角）
- 私隱政策網址：https://gainsneverstop1212-web.github.io/hk-transport/privacy.html（上架前要填好頁入面紅色【待填】嘅營運者名稱、聯絡電郵、Firestore 區域）
- App Privacy 標籤：即時定位只喺手機用、唔上傳；但登入咗會同步屋企／公司位置、通勤紀錄、電郵同名，要申報為「連結身份、只作 app 功能」
- 截圖：iPhone 6.9 吋
- 數據來源頁：DATA.GOV.HK、hkbus/hk-bus-crawling、地政總署
