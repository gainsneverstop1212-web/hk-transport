// 港住走 · 帳戶（Apple／Google 登入 + 雲端同步）設定
// 跟 docs/ACCOUNT_SETUP.md 建立 Firebase 專案之後，將 Firebase「網頁應用程式」設定貼喺下面（取代 null）。
// 呢啲值係公開嘅識別碼（唔係密碼），可以放喺網頁度；資料安全靠 firestore.rules。
// 保持 null：帳戶功能唔會顯示，所有資料照舊只存喺部機。
export const FIREBASE_CONFIG = null;
/* 例子：
export const FIREBASE_CONFIG = {
  apiKey: 'AIza…',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  appId: '1:123:web:abc'
};
*/
