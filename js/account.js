// 港住走 · 帳戶：Apple／Google 登入，將設定、常用地點、常用路線、通勤紀錄同步到雲端（Firebase）
// · 唔登入照用得：所有資料照舊存喺部機
// · 登入之後：每次改設定、加常用地點都會自動上傳；喺另一部手機登入就會攞返晒
// · 衝突：每樣資料記住最後修改時間，新嘅蓋舊嘅
// · 隨時可以登出（部機資料保留）或者刪除帳戶（雲端資料即刻刪除）
import {S, $, esc, store, L, toast, hhmm} from './core.js';
import {emit} from './ui.js';
import {FIREBASE_CONFIG, PROVIDERS} from './account-config.js';

// 會同步嘅資料（唔包括你最後所在位置、進行中嘅行程、快取）
export const SYNC_KEYS = ['settings', 'places', 'favs2', 'habitLog', 'tripBuf', 'recentRoutes', 'planRecent', 'destCount', 'destNo', 'nearMode', 'planSort'];
const META = 'syncMeta';
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';
let be = null, loading = null, user = null, lastSync = store.get('syncAt', 0), upT = null, busy = false;
export const enabled = () => !!FIREBASE_CONFIG || !!be?.fake;
export const currentUser = () => user;

/* ---------- 後端（Firebase，用到先載入，唔登入就唔會下載） ---------- */
async function backend(){
  if (be) return be;
  if (!FIREBASE_CONFIG) throw new Error('not configured');
  return loading || (loading = (async () => {
    const [{initializeApp}, A, F] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    const app = initializeApp(FIREBASE_CONFIG), auth = A.getAuth(app), db = F.getFirestore(app);
    auth.languageCode = S.set.lang === 'en' ? 'en' : 'zh-TW';
    const ref = uid => F.doc(db, 'users', uid);
    be = {
      onUser: cb => A.onAuthStateChanged(auth, cb),
      signIn: async kind => {
        const p = kind === 'apple' ? new A.OAuthProvider('apple.com') : new A.GoogleAuthProvider();
        if (kind === 'apple') { p.addScope('email'); p.addScope('name'); p.setCustomParameters({locale: S.set.lang === 'en' ? 'en_US' : 'zh_HK'}); }
        else p.setCustomParameters({prompt: 'select_account'});
        return (await A.signInWithPopup(auth, p)).user;
      },
      signOut: () => A.signOut(auth),
      read: async uid => { const d = await F.getDoc(ref(uid)); return d.exists() ? d.data() : null; },
      write: (uid, data) => F.setDoc(ref(uid), {...data, updatedAt: F.serverTimestamp()}, {merge: true}),
      remove: async u => {
        await F.deleteDoc(ref(u.uid));
        try { await A.deleteUser(u); }
        catch (e) {
          // 太耐冇登入：Firebase 要求再登入一次先可以刪除帳戶
          if (e?.code !== 'auth/requires-recent-login') throw e;
          const kind = (u.providerData[0]?.providerId || '').includes('apple') ? new A.OAuthProvider('apple.com') : new A.GoogleAuthProvider();
          await A.reauthenticateWithPopup(u, kind); await A.deleteUser(u);
        }
      }
    };
    return be;
  })().catch(e => { loading = null; throw e; }));
}
// 測試用：換一個假後端
export function _useBackend(fake){ be = fake; }

/* ---------- 同步 ---------- */
const meta = () => store.get(META, {});
const snapshot = () => { const data = {}, m = meta(); for (const k of SYNC_KEYS) { const v = localStorage.getItem('hkgo:' + k); if (v != null) data[k] = v; } return {data, meta: m}; };
// 部機改咗資料：記低時間，有登入就（1.5 秒後）上傳
store.onChange = k => {
  if (!SYNC_KEYS.includes(k)) return;
  const m = meta(); m[k] = Date.now(); store.set(META, m, true);
  if (user) { clearTimeout(upT); upT = setTimeout(upload, 1500); }
};
async function upload(){
  if (!user || !be) return;
  try { await be.write(user.uid, snapshot()); lastSync = Date.now(); store.set('syncAt', lastSync, true); emit('account'); }
  catch { clearTimeout(upT); upT = setTimeout(upload, 30000); }   // 冇網：30 秒後再試
}
// 登入／開 app：雲端同部機逐樣比較，新嘅蓋舊嘅；雲端有更新就重新載入 app（所有頁面即刻用返雲端資料）
export async function pullAndMerge(){
  if (!user || !be || busy) return false;
  busy = true;
  try {
    const remote = await be.read(user.uid), rm = remote?.meta || {}, rd = remote?.data || {}, lm = meta();
    let changed = false, needUp = !remote;
    for (const k of SYNC_KEYS) {
      const lt = lm[k] || 0, rt = rm[k] || 0, local = localStorage.getItem('hkgo:' + k);
      if (rd[k] != null && rt > lt) {
        if (rd[k] !== local) { try { localStorage.setItem('hkgo:' + k, rd[k]); changed = true; } catch {} }
        lm[k] = rt;
      } else if (local != null && (lt > rt || rd[k] == null)) { needUp = true; if (!lm[k]) lm[k] = 1; }
    }
    store.set(META, lm, true);
    if (needUp) await be.write(user.uid, snapshot());
    lastSync = Date.now(); store.set('syncAt', lastSync, true);
    emit('account');
    return changed;
  } catch { return false; }
  finally { busy = false; }
}

/* ---------- 開 app ---------- */
export function initAccount(){
  if (!enabled()) return;
  // 之前登入過先喺背景載入（冇登入過唔使下載任何嘢）
  if (!store.get('acctSeen', false) && !be?.fake) return;
  setTimeout(() => backend().then(watch).catch(() => {}), 1500);
}
let watching = false;
function watch(b){
  if (watching) return; watching = true;
  b.onUser(async u => {
    user = u || null; emit('account');
    if (user && await pullAndMerge()) { toast(L('已攞返你帳戶嘅設定同常用地點', 'Restored your settings and places'), 2500); setTimeout(() => location.reload(), 900); }
  });
}
export async function signIn(kind){
  try {
    const b = await backend(); watch(b);
    const u = await b.signIn(kind);
    user = u; store.set('acctSeen', true, true); emit('account');
    const changed = await pullAndMerge();
    toast(changed ? L('登入咗，已攞返你之前嘅設定', 'Signed in — settings restored') : L('登入咗，你嘅設定會自動同步', 'Signed in — your settings will sync'), 3000);
    if (changed) setTimeout(() => location.reload(), 900);
  } catch (e) {
    const c = e?.code || '';
    if (/popup-closed|cancelled-popup/.test(c)) return;
    toast(/popup-blocked/.test(c) ? L('瀏覽器擋咗登入視窗，請容許彈出視窗再試', 'Pop-up blocked — allow pop-ups and try again')
      : /network/.test(c) ? L('網絡問題，登入唔到', 'Network problem — could not sign in')
      : /not configured/.test(e?.message || '') ? L('帳戶功能未開通', 'Accounts are not set up yet')
      : L('登入唔到，請再試', 'Could not sign in — please try again'), 4000);
  }
}
export async function signOut(){
  try { await upload(); await be?.signOut(); } catch {}
  user = null; emit('account');
  toast(L('已登出；資料仍然保留喺呢部機', 'Signed out — data stays on this device'));
}
export async function deleteAccount(){
  if (!user || !be) return;
  if (!confirm(L('刪除帳戶會永久刪除雲端上嘅設定、常用地點同通勤紀錄（呢部機嘅資料保留）。確定刪除？', 'Delete your account? Cloud settings, places and history are deleted permanently (this device keeps its copy).'))) return;
  try { await be.remove(user); user = null; store.del('acctSeen', true); emit('account'); toast(L('帳戶已刪除', 'Account deleted')); }
  catch { toast(L('刪除唔到，請再試', 'Could not delete — please try again')); }
}

/* ---------- 設定頁卡片 ---------- */
const APPLE = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>';
const GOOGLE = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.4 24 12 24z"/><path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9z"/></svg>';
export function accountHtml(){
  if (!enabled()) return '';
  if (!user) return `<div class="acct">
    <div class="acct-t"><b>${L('登入帳戶', 'Sign in')}</b><small>${L('換手機、用平板都記住你嘅常用地點、樓層、常用路線同設定。唔登入都照用得。', 'Keep your places, floors, pinned routes and settings across devices. Optional.')}</small></div>
    ${PROVIDERS?.apple !== false ? `<button class="acct-b apple" type="button" data-acct="apple">${APPLE}<span>${L('用 Apple 登入', 'Sign in with Apple')}</span></button>` : ''}
    ${PROVIDERS?.google !== false ? `<button class="acct-b google" type="button" data-acct="google">${GOOGLE}<span>${L('用 Google 登入', 'Sign in with Google')}</span></button>` : ''}
    <small class="acct-p">${L('只會儲存你喺 app 入面嘅設定；只有你登入先睇到，隨時可以刪除。', 'Only your in-app settings are stored, visible only to you, deletable any time.')} <a href="privacy.html${S.set.lang === 'en' ? '#en' : ''}">${L('私隱政策', 'Privacy policy')}</a></small></div>`;
  const name = user.displayName || user.email || L('已登入', 'Signed in');
  return `<div class="acct in">
    <span class="acct-av" aria-hidden="true">${esc((name || '?').trim()[0].toUpperCase())}</span>
    <div class="acct-t"><b>${esc(name)}</b><small>${user.email && user.displayName ? esc(user.email) + ' · ' : ''}${lastSync ? L(`已同步 ${hhmm(lastSync)}`, `Synced ${hhmm(lastSync)}`) : L('同步緊…', 'Syncing…')}</small></div>
    <div class="acct-x"><button class="btn-d sm" type="button" data-acct="out">${L('登出', 'Sign out')}</button><button class="btn-d sm danger" type="button" data-acct="del">${L('刪除帳戶', 'Delete account')}</button></div></div>`;
}
export function onAccountClick(e){
  const b = e.target.closest('[data-acct]'); if (!b) return false;
  const a = b.dataset.acct;
  if (a === 'apple' || a === 'google') { b.disabled = true; signIn(a).finally(() => { b.disabled = false; }); }
  else if (a === 'out') signOut();
  else if (a === 'del') deleteAccount();
  return true;
}
