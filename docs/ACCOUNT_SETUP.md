# 開通帳戶（Apple／Google 登入 + 雲端同步）

港住走嘅帳戶功能用 Google Firebase（免費額度夠用）。開通之前，設定頁唔會顯示登入掣，所有資料照舊只存喺部機。

## 一、建立 Firebase 專案（約 10 分鐘）
1. 去 https://console.firebase.google.com ，用你嘅 Google 帳戶登入，撳「新增專案」，例如叫 `rushing-hk`。
2. 專案入面撳「</>」（網頁應用程式）新增 app，名可以叫「港住走」。完成後會見到一段 `firebaseConfig`。
3. 將 `apiKey`、`authDomain`、`projectId`、`appId` 貼入 `js/account-config.js`（取代 `null`）。呢啲係公開識別碼，唔係密碼。

## 二、開 Google 登入
1. Firebase → Authentication → Sign-in method → Google → 啟用 → 儲存。
2. Authentication → Settings → Authorized domains → 加入 `gainsneverstop1212-web.github.io`。

## 三、開 Apple 登入（要 Apple Developer 帳戶，每年 US$99）
1. https://developer.apple.com/account → Certificates, IDs & Profiles：
   - Identifiers → App IDs：揀（或者新增）你嘅 App ID，勾選「Sign In with Apple」。
   - Identifiers → Services IDs → 新增，例如 `hk.gangtou.web`，勾選「Sign In with Apple」→ Configure：
     - Domains：`你個專案.firebaseapp.com`
     - Return URLs：`https://你個專案.firebaseapp.com/__/auth/handler`
   - Keys → 新增，勾選「Sign In with Apple」，下載 `.p8` 檔，記低 Key ID。
2. Firebase → Authentication → Sign-in method → Apple → 啟用，填：Services ID、Apple Team ID、Key ID，同埋 `.p8` 檔內容。

## 四、資料庫
1. Firebase → Firestore Database → 建立資料庫 → 位置揀 `asia-east2`（香港）→ Production mode。
2. Rules 分頁：貼上 repo 入面 `firestore.rules` 嘅內容 → 發佈。呢個規則令每個用家只可以讀寫自己嗰份。

## 五、試
- push 之後開 app → 常用 → 設定，會見到「用 Apple 登入」「用 Google 登入」。
- 登入 → 加一個常用地點 → 用另一部手機（或者無痕模式）登入同一個帳戶，應該會攞返嗰個地點。

## 會同步乜嘢
設定（語言、字體、步速、落樓設定等）、常用地點（連樓層）、常用路線、自動學識嘅通勤紀錄、最近搜尋。
**唔會**同步：你最後所在嘅位置、進行中嘅出門倒數。

## 要知
- **私隱政策**：儲存用家嘅屋企／公司位置屬個人資料，上架前要有私隱政策頁，講明收集乜、點用、點刪除。
- **刪除帳戶**：設定頁有「刪除帳戶」，會即刻刪除雲端資料同帳戶（App Store 規定要有）。
- **iPhone 加到主畫面嘅版本**：登入用彈出視窗；如果彈唔出，請用 Safari 開網頁版登入一次。最穩陣嘅做法係將網站搬去 Firebase Hosting（同 `authDomain` 同一個網域）。
- **App Store 版（Capacitor）**：網頁彈出視窗登入喺 app 入面未必用得，到時要加 `@capacitor-firebase/authentication` 插件做原生 Apple／Google 登入（App Store 規定：有 Google 登入就一定要有 Apple 登入）。
