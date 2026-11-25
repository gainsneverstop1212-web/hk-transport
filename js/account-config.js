// 港住走 · 帳戶（Apple／Google 登入 + 雲端同步）設定
// 呢啲係 Firebase 公開識別碼（唔係密碼），本身就要放喺網頁度；資料安全靠 firestore.rules。
// 設定步驟見 docs/ACCOUNT_SETUP.md。
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCmBptfEc9XgAhoRGMPl6dbQ7NppwH6Ybk',
  authDomain: 'rushing-hk-82c6e.firebaseapp.com',
  projectId: 'rushing-hk-82c6e',
  storageBucket: 'rushing-hk-82c6e.firebasestorage.app',
  messagingSenderId: '768817584298',
  appId: '1:768817584298:web:6e0d0c3b5c303c823e98d3'
};
// 開咗邊啲登入方式（Firebase → Authentication → Sign-in method 開咗先改做 true）
// Apple 登入要 Apple Developer 帳戶（每年 US$99），開通前保持 false，登入掣唔會顯示
export const PROVIDERS = {google: true, apple: false};
