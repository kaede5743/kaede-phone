// KaedeSystem をスマホから操作するページ。本体の状態を映すだけで、操作できるかは本体が決める
import { LineBuffer, createStore, screenFor, buildCommand, textArgOk, REJECT_TEXT, PHASE, GEARS_X10, TIRE_X10_MIN, TIRE_X10_MAX, speedKmh } from './proto.js';
import { esc, num, unitListHtml, unitDetailHtml, measResultHtml, canResend } from './select.js';

const SVC = '5f3a9c10-7d2e-4b8a-9e61-2c4d8f0a1b01';
const RX  = '5f3a9c10-7d2e-4b8a-9e61-2c4d8f0a1b02';   // ページ → 本体
const TX  = '5f3a9c10-7d2e-4b8a-9e61-2c4d8f0a1b03';   // 本体 → ページ
const PRESETS = [2.70, 2.75, 2.80, 2.85, 2.90, 2.95, 3.00];
const REPLY_TIMEOUT_MS = 5000;
const LONG_PRESS_MS = 1000;
const DEMO = new URLSearchParams(location.search).has('demo');

const store = createStore();
const st = store.state;
const $ = (id) => document.getElementById(id);
const view = $('view');

// ===== 送る: 1 件ずつ。返事が来るまで次を送らない。同じ命令が待っていれば値だけ差し替える =====
let nextId = 1;
let pending = null;            // { id, op, timer }
const queue = [];              // { op, arg }
let rxChar = null;

// multi: 同じ命令を値を変えて何度も送る(sel.del)。ふつうは最後の値だけ送る(設定のつまみなど)
// onOk: 本体が ok と返したときに呼ぶ(sel.del の送れた印を覚える)
function send(op, arg, multi = false, onOk = null) {
  if (!st.connected) { if (!multi) toast('つながっていません'); return; }
  if (!multi && pending && pending.op === op && arg === undefined) return;   // 連打
  const q = !multi && queue.find((x) => x.op === op);
  if (q) { q.arg = arg; return; }
  queue.push({ op, arg, onOk, quiet: multi });
  pump();
}

async function pump() {
  if (pending || queue.length === 0) return;
  const { op, arg, onOk, quiet } = queue.shift();
  const id = nextId;
  nextId = nextId >= 65535 ? 1 : nextId + 1;
  const line = buildCommand(id, op, arg);
  pending = { id, op, onOk, quiet, timer: setTimeout(() => { pending = null; if (!quiet) toast('届きませんでした'); pump(); }, REPLY_TIMEOUT_MS) };
  try {
    if (DEMO) demoCommand(id, op, arg);
    else await rxChar.writeValueWithResponse(new TextEncoder().encode(line));
  } catch (e) {
    clearTimeout(pending.timer);
    pending = null;
    toast('送れませんでした');
    pump();
  }
}

store.onReply = (id, res) => {
  if (!pending || pending.id !== id) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  if (res === 'ok') { if (p.onOk) p.onOk(); }
  else if (!p.quiet) toast(REJECT_TEXT[res] || `断られました (${res})`);   // sel.del など続けて送る命令は黙って次へ
  pump();
};

// ===== Bluetooth =====
let device = null;
let retryMs = 0;
let retryTimer = null;
let lineBuf = new LineBuffer();
let decoder = new TextDecoder();

async function connectTap() {
  if (!navigator.bluetooth) return;
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC] }] });
  } catch (e) {
    return;   // 選ばずに閉じた
  }
  device.addEventListener('gattserverdisconnected', onDisconnected);
  retryMs = 0;
  await openLink();
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function openLink() {
  clearTimeout(retryTimer);
  setConn('retry', 'つないでいます…');
  try {
    const server = await withTimeout(device.gatt.connect(), 15000);
    const svc = await server.getPrimaryService(SVC);
    rxChar = await svc.getCharacteristic(RX);
    const tx = await svc.getCharacteristic(TX);
    lineBuf = new LineBuffer();
    decoder = new TextDecoder();
    tx.addEventListener('characteristicvaluechanged', (e) => {
      const text = decoder.decode(e.target.value, { stream: true });
      for (const line of lineBuf.push(text)) store.apply(line);
    });
    await tx.startNotifications();   // ここで初回はペアリング(本体に出た 6 桁を入れる)
    retryMs = 0;
    store.markConnected();
  } catch (e) {
    try { device.gatt.disconnect(); } catch {}
    scheduleRetry();
  }
}

function onDisconnected() {
  rxChar = null;
  if (pending) { clearTimeout(pending.timer); pending = null; }
  queue.length = 0;
  store.markDisconnected();
  scheduleRetry();
}

// 2 秒、4 秒、8 秒、以後 8 秒ごとに試す
function scheduleRetry() {
  if (!device) return;
  clearTimeout(retryTimer);
  retryMs = retryMs ? Math.min(retryMs * 2, 8000) : 2000;
  setConn('retry', `切断中(${retryMs / 1000}秒後につなぎ直す)`);
  retryTimer = setTimeout(openLink, retryMs);
}

function setConn(kind, text) {
  $('conn').className = `conn ${kind}`;
  $('connText').textContent = text;
}

// ===== 表示の部品 =====
let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function ask(text, yes = '進める') {
  const d = $('ask');
  $('askText').textContent = text;
  $('askYes').textContent = yes;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }));
}

function mmss(s) {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function hm(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m ? `${h}時間${m}分` : `${h}時間`) : `${m}分`;
}

// 長押し(1 秒)。押している間は進み具合を見せる
function bindLongPress(el, onDone) {
  let t0 = 0, raf = 0;
  const reset = () => { t0 = 0; cancelAnimationFrame(raf); el.style.setProperty('--p', 0); };
  const tick = () => {
    if (!t0) return;
    const p = Math.min(1, (performance.now() - t0) / LONG_PRESS_MS);
    el.style.setProperty('--p', p);
    if (p >= 1) { reset(); if (navigator.vibrate) navigator.vibrate(60); onDone(); return; }
    raf = requestAnimationFrame(tick);
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); t0 = performance.now(); tick(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, reset);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

const stopBtn = (label = '長押しで中止') => `<button class="btn stop act" data-long="stop"><span>${label}</span></button>`;

// ===== 画面 =====
// 画面ごとに骨組みを 1 回だけ作り、値は data-k の要素だけ書き換える(押している途中のボタンを作り直さない)
let local = null;              // ページの中だけで開く画面: 'crs' | 'motors' | 'list' | 'd:<番号>'(本体は動かさない)
let localFor = '';             // local を開いた画面。画面が変わったら閉じる
// 計測の所有者の候補(この端末で入れた名前。新しい順に 20 件まで)
const OWNERS_KEY = 'kaede_phone_owners';
function loadOwners() {
  try { const a = JSON.parse(localStorage.getItem(OWNERS_KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}
function rememberOwner(name) {
  if (!name) return;
  const a = [name, ...loadOwners().filter((x) => x !== name)].slice(0, 20);
  try { localStorage.setItem(OWNERS_KEY, JSON.stringify(a)); } catch { /* 保存できなくても送るのはできる */ }
}
// ===== モーターラボへの送信(本体は Wi-Fi を使わず、このページが送る) =====
// 送信キーはモーターラボの「本体の送信キー」(マスターのみ)で発行し、ここに一度入れる。この端末にだけ残る
const LAB_KEY_STORE = 'kaede_phone_motorlab_key';
const LAB_URL = 'https://asia-northeast1-kaede-race-maneger.cloudfunctions.net/addMotorLabMeasurement';
function labKey() { try { return cleanLabKey(localStorage.getItem(LAB_KEY_STORE)); } catch { return ''; } }
// キーは base64url(A-Z a-z 0-9 _ -)だけ。貼り付けで混ざる改行・空白・見えない文字は落とす
const cleanLabKey = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '');

// キーが受け口で通るかを確かめる(計測の値を付けずに送る: キーが合えば値の不備で 400、違えば 403)。
// true = 有効 / false = 違う / null = 確かめられなかった(通信の失敗など)
async function checkLabKey(key) {
  if (DEMO) return true;
  try {
    const res = await fetch(LAB_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    if (res.status === 401 || res.status === 403) return false;
    return res.status === 400 ? true : null;
  } catch { return null; }
}

async function editLabKey() {
  const cur = labKey();
  const v = window.prompt('モーターラボの送信キー(モーターラボの「本体の送信キー」で発行したもの)。空にすると消します。', cur);
  if (v === null) return;
  const key = cleanLabKey(v);
  try {
    if (key) localStorage.setItem(LAB_KEY_STORE, key);
    else localStorage.removeItem(LAB_KEY_STORE);
  } catch { toast('この端末には保存できませんでした'); return; }
  render();
  if (!key) { toast('送信キーを消しました'); return; }
  toast('送信キーを確かめています…');
  const ok = await checkLabKey(key);
  toast(ok === true ? '送信キーは有効です(保存しました)'
    : ok === false ? '送信キーが違います。モーターラボで最後に発行したキーを入れてください'
    : '保存しました(通信できず、キーが合っているかは確かめられませんでした)');
}

// 本体が送信を頼んできた回(状態の mreq)。同じ回を二度送らない
let labSentReq = 0;
async function labUploadIfRequested(s) {
  if (!s || s.phase !== PHASE.SEL_RESULT || !s.mreq || s.mreq === labSentReq || st.stale) return;
  labSentReq = s.mreq;
  const key = labKey();
  if (!key) { send('sel.uploaded', 7); toast('送信キーが入っていません(モーターのメニューで入れられます)'); return; }
  if (DEMO) { setTimeout(() => send('sel.uploaded', 1), 600); return; }
  let code = 5;
  try {
    const res = await fetch(LAB_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key, motor: s.mkey, no: String(s.sel_no).padStart(3, '0'),
        rpm: s.mload ?? 0, rpmNl: s.mnl ?? 0, w: s.mw ?? 0, date: s.mdate || '', owner: s.owner || '',
      }),
    });
    code = res.ok ? 1 : (res.status === 401 || res.status === 403) ? 4 : res.status === 409 ? 6 : 5;
  } catch (e) {
    console.warn('モーターラボへ送れませんでした', e);
    code = 5;
  }
  send('sel.uploaded', code);
}

// ===== モーターラボで消した計測を、本体の記録(順位)からも外す =====
// 本体が状態に載せる機種のキー(mkey)の分だけ、消した計測の印「番号|計測日|負荷時回転数」を受け口から受け取り、
// まだ送っていない印を sel.del で本体へ送る。送った印はこの端末に覚えておく(本体も同じ印は二度当てない)
const LAB_DEL_URL = 'https://asia-northeast1-kaede-race-maneger.cloudfunctions.net/listMotorLabDeleted';
const DEL_SENT_STORE = 'kaede_phone_del_sent';
const DEL_PHASES = [PHASE.MOT_IDLE, PHASE.SEL_INPUT, PHASE.SEL_RESULT];   // 本体が受け付ける画面(回っていない)
const DEL_REFETCH_MS = 3 * 60 * 1000;
let delFetchedFor = '';   // 最後に受け取った機種(つなぎ直したら空に戻す)
let delFetchedAt = 0;
let delBusy = false;
function delSent() { try { const o = JSON.parse(localStorage.getItem(DEL_SENT_STORE) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
function saveDelSent(o) { try { localStorage.setItem(DEL_SENT_STORE, JSON.stringify(o)); } catch { /* 覚えられなくても本体は二度当てない */ } }
async function syncDeleted(s) {
  if (DEMO || delBusy || !s || st.stale || !st.connected || !s.mkey || !DEL_PHASES.includes(s.phase)) return;
  const key = labKey();
  if (!key) return;
  if (delFetchedFor === s.mkey && Date.now() - delFetchedAt < DEL_REFETCH_MS) return;
  delBusy = true;
  const mkey = s.mkey;
  try {
    const res = await fetch(LAB_DEL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, motor: mkey }) });
    if (!res.ok) return;
    const data = await res.json();
    delFetchedFor = mkey;
    delFetchedAt = Date.now();
    const sent = delSent();
    const done = new Set(Array.isArray(sent[mkey]) ? sent[mkey] : []);
    for (const q of queue) if (q.op === 'sel.del') done.add(q.arg);   // 送っている途中の印は重ねない
    const todo = (Array.isArray(data.deleted) ? data.deleted : []).filter((sig) => !done.has(sig) && textArgOk(sig));
    if (!todo.length || st.status?.mkey !== mkey) return;   // 送るあいだに機種が変わったら、次の回に
    // 本体が ok と返した印だけ覚える(古い本体・SD に書けなかったときは、次につないだときに送り直す)
    for (const sig of todo) {
      send('sel.del', sig, true, () => {
        const o = delSent();
        const list = Array.isArray(o[mkey]) ? o[mkey] : [];
        if (!list.includes(sig)) o[mkey] = [...list, sig].slice(-300);
        saveDelSent(o);
      });
    }
  } catch (e) {
    console.warn('消した計測の印を受け取れませんでした', e);
  } finally {
    delBusy = false;
  }
}

const ownerField = () => `<label class="row"><span>所有者</span><input class="act" data-f="owner" list="ownerList" autocomplete="off" aria-label="所有者の名前"></label>
      <datalist id="ownerList">${loadOwners().map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>`;
let shown = '';

const SCREENS = {
  connect() {
    if (!navigator.bluetooth && !DEMO) {
      return `<p class="h">このブラウザでは使えません</p><p class="note">Android の Chrome で開いてください。</p>`;
    }
    return `<p class="h">本体とつなぐ</p>
      <p class="note">KaedeSystem の電源を入れて、近くで「接続する」を押してください。初めてのときは本体に出る 6 桁の番号をスマホに入れます。</p>
      <div class="bottom"><button class="btn go" data-act="connect">接続する</button></div>`;
  },
  selector() {
    return `<span class="state">メニュー</span>
      <button class="btn go appbig act" data-cmd="app" data-arg="1">Battery Manager</button>
      <button class="btn go appbig act" data-cmd="app" data-arg="2">Motor Manager</button>
      <button class="btn go appbig act" data-cmd="app" data-arg="3">Speed Manager</button>`;
  },
  batSetup() {
    const chips = PRESETS.map((v, k) => `<button class="chip act" data-cmd="bat.preset" data-arg="${k}" data-preset="${k}">${v.toFixed(2)}</button>`).join('');
    return `<span class="state" data-k="label"></span>
      <div class="big"><span data-k="v"></span><small>V</small></div>
      <p class="note">電池の電圧(目標は下のボタンで選びます)</p>
      <div class="chips">${chips}</div>
      <div data-k="countdownBox" hidden>
        <p class="say" data-k="countdown"></p>
        <button class="btn sub act" data-cmd="bat.cancel">キャンセル</button>
      </div>
      <button class="row act" data-act="buz"><span>ブザー</span><span data-k="buz"></span></button>
      <button class="row act" data-act="race"><span>レース用(早く完了)</span><span data-k="race"></span></button>
      <div class="bottom pair">
        <button class="btn sub act" data-cmd="app" data-arg="0">メニューへ</button>
        <button class="btn sub act" data-cmd="app" data-arg="2">モーターへ</button>
      </div>`;
  },
  batRun() {
    return `<span class="state run" data-k="label"></span>
      <div class="big"><span data-k="v"></span><small>V</small></div>
      <div class="grid">
        <div class="cell"><b data-k="i"></b><span>電流 A</span></div>
        <div class="cell"><b data-k="mah"></b><span>充電量 mAh</span></div>
        <div class="cell"><b data-k="elapsed"></b><span>経過</span></div>
        <div class="cell"><b data-k="temp"></b><span>温度 ℃</span></div>
      </div>
      <p class="note">目標 <span data-k="preset"></span> V</p>
      <div class="bottom">
        <div class="pair" data-k="bdoneBox" hidden>
          <button class="btn sub act" data-cmd="bat.finish">直前仕上げ</button>
          <button class="btn sub act" data-cmd="bat.recheck">再確認</button>
        </div>
        ${stopBtn('長押しで停止')}
      </div>`;
  },
  batResult() {
    return `<span class="state">結果</span>
      <p class="say">充電が終わりました</p>
      <div class="grid">
        <div class="cell"><b data-k="mah"></b><span>充電量 mAh</span></div>
        <div class="cell"><b data-k="elapsed"></b><span>かかった時間</span></div>
      </div>
      <div class="bottom"><button class="btn go act" data-cmd="close">閉じる</button></div>`;
  },
  batError() {
    return `<span class="state err" data-k="label"></span>
      <p class="say" data-k="error"></p>
      <p class="note">原因を取り除いてから解除してください。</p>
      <div class="bottom"><button class="btn go act" data-cmd="err.clear">解除</button></div>`;
  },
  motMenu() {
    if (local === 'crs') return crsSetupHtml();
    if (local === 'motors') return motorsHtml();
    return `<span class="state">モーター</span>
      <p class="h" data-k="label"></p>
      <button class="row act" data-act="crs"><span>慣らし</span><span data-k="crsSummary"></span></button>
      <button class="row act" data-act="motors"><span>機種</span><span data-k="motorName"></span></button>
      <button class="row act" data-cmd="sel.enter"><span>計測</span><span>›</span></button>
      <button class="row act" data-act="labKey"><span>モーターラボの送信キー</span><span data-k="labKeyState"></span></button>
      <button class="row act" data-cmd="man.enter"><span>手動運転</span><span>›</span></button>
      <div class="bottom pair">
        <button class="btn sub act" data-cmd="app" data-arg="0">メニューへ</button>
        <button class="btn sub act" data-cmd="app" data-arg="1">バッテリーへ</button>
      </div>`;
  },
  motBusy() {
    return `<span class="state" data-k="label"></span>
      <p class="say">本体で操作中です</p>
      <div data-k="liveBox" hidden>
        <div class="big"><span data-k="live"></span><small>rpm</small></div>
        <p class="note">今の回転数(本体の画面と同じ)</p>
      </div>
      <p class="note" data-k="busyNote"></p>
      <div class="bottom" data-k="busyStop">${stopBtn('長押しで停止')}</div>`;
  },
  prompt() {
    return `<span class="state" data-k="label"></span>
      <p class="say" data-k="prompt"></p>
      <div class="bottom">
        <button class="btn go act" data-act="next">次へ(モーターが回ります)</button>
        ${stopBtn()}
      </div>`;
  },
  run() {
    return `<span class="state run" data-k="label"></span>
      <div class="big"><span data-k="live"></span><small>rpm</small></div>
      <p class="note">今の回転数(本体の画面と同じ)。目標とは 3.0V の確認で比べます。</p>
      <div class="grid">
        <div class="cell"><b data-k="rpm"></b><span>1 分平均 rpm</span></div>
        <div class="cell"><b data-k="target"></b><span>目標 rpm(3.0V)</span></div>
        <div class="cell"><b data-k="checks"></b><span>確認</span></div>
        <div class="cell"><b data-k="elapsed"></b><span>経過 / 最大</span></div>
        <div class="cell"><b data-k="mv"></b><span>電圧 V</span></div>
        <div class="cell"><b data-k="i"></b><span>電流 A</span></div>
      </div>
      <div class="chart" data-k="chart"></div>
      ${checksBox()}
      <div class="bottom">
        <button class="btn sub act" data-act="skip" data-k="skipBtn" hidden></button>
        ${stopBtn()}
      </div>`;
  },
  fail() {
    return `<span class="state err" data-k="label"></span>
      <p class="say">回転数を測れませんでした</p>
      <p class="note">本体の画面で理由を確かめてから、やり直してください。</p>
      <div class="bottom">
        <button class="btn go act" data-act="retry">もう一度(モーターが回ります)</button>
        ${stopBtn()}
      </div>`;
  },
  result() {
    return `<span class="state">結果</span>
      <p class="say">慣らしが終わりました</p>
      <div class="grid">
        <div class="cell"><b data-k="rpm"></b><span>仕上がり rpm</span></div>
        <div class="cell"><b data-k="target"></b><span>目標 rpm</span></div>
        <div class="cell"><b data-k="elapsed"></b><span>慣らした時間</span></div>
        <div class="cell"><b data-k="checks"></b><span>確認</span></div>
      </div>
      ${checksBox()}
      <p class="note">詳しい結果は本体の画面を見てください。</p>
      <div class="bottom"><button class="btn go act" data-cmd="close">閉じる</button></div>`;
  },
  // ===== スピードマネージャー =====
  speed() {
    if (local === 'motors') return motorsHtml('spd.motor');
    const chips = GEARS_X10.map((g, k) => `<button class="chip act" data-cmd="spd.gear" data-arg="${k}" data-gear="${k}">${(g / 10).toFixed(1)}</button>`).join('');
    return `<span class="state run" data-k="label"></span>
      <div class="big"><span data-k="kmh"></span><small>km/h</small></div>
      <p class="note">モーター <b data-k="live"></b> rpm(タイヤを空転させた音から)</p>
      <div class="grid">
        <div class="cell"><b class="up" data-k="kmhMax"></b><span>最高 km/h</span></div>
        <div class="cell"><b class="up" data-k="smax"></b><span>最高 rpm</span></div>
      </div>
      <div class="row"><span>タイヤ径</span><span class="tgt">
        <input class="act" inputmode="decimal" data-f="spdTire" aria-label="タイヤ径"> mm
        <button class="chip act" data-act="spdTire">変更</button></span></div>
      <p class="note">ギヤ比(:1)</p>
      <div class="chips five">${chips}</div>
      <button class="row act" data-act="motors"><span>機種</span><span data-k="spdMotor"></span></button>
      <div class="bottom">
        <button class="btn sub act" data-act="spdClr">最高値を消す</button>
        <button class="btn sub act" data-cmd="app" data-arg="0">メニューへ</button>
      </div>`;
  },
  speedBusy() {
    return `<span class="state" data-k="label"></span>
      <p class="say">本体で設定を直しています</p>
      <p class="note" data-k="spdBand"></p>
      <p class="note">本体の「決定」か「やめる」で計測の画面に戻ると、スマホからも操作できます。</p>`;
  },
  // ===== 段階2 =====
  manual() {
    return `<span class="state" data-k="label"></span>
      <div class="big"><span data-k="live"></span><small>rpm</small></div>
      <p class="note" data-k="manNote"></p>
      <div class="grid">
        <div class="cell"><b data-k="mv"></b><span>電圧 V(測った値)</span></div>
        <div class="cell"><b data-k="i"></b><span>電流 A</span></div>
        <div class="cell"><b data-k="elapsed"></b><span>経過</span></div>
        <div class="cell"><b data-k="kv"></b><span>rpm / V</span></div>
      </div>
      <div class="row"><span>電圧</span><span class="tgt">
        <input class="act" inputmode="decimal" data-f="manV" aria-label="手動運転の電圧"> V
        <button class="chip act" data-act="manV">変更</button>
      </span></div>
      <p class="note">0.5〜3.0V。回っている途中でも変えられます</p>
      <div class="bottom" data-k="manBtns"></div>`;
  },
  selInput() {
    return `<span class="state" data-k="label"></span>
      <p class="note">機種は本体の帯をタップして選び直せます</p>
      <label class="row"><span>番号</span><input class="act" inputmode="numeric" data-f="selNo" aria-label="個体の番号"></label>
      <p class="note" data-k="selNoNote"></p>
      ${ownerField()}
      <p class="note">負荷(セレクター付き 2.8V・105mΩ)10 秒 → 無負荷(3.0V)10 秒</p>
      <div class="bottom">
        <button class="btn go act" data-act="selStart">測定開始(モーターが回ります)</button>
        <button class="btn sub act" data-cmd="mot.home">戻る</button>
      </div>`;
  },
  selPrompt() {
    return `<span class="state run" data-k="label"></span>
      <p class="say" data-k="prompt"></p>
      <div class="big"><span data-k="live"></span><small>rpm</small></div>
      <p class="note">今の回転数</p>
      <div class="bottom">
        <button class="btn go act" data-act="next">次へ(モーターが回ります)</button>
        ${stopBtn()}
      </div>`;
  },
  selRun() {
    return `<span class="state run" data-k="label"></span>
      <p class="say">測っています</p>
      <div class="big"><span data-k="live"></span><small>rpm</small></div>
      <p class="note">今の回転数</p>
      <div class="bottom">${stopBtn()}</div>`;
  },
  selFail() {
    return `<span class="state err" data-k="label"></span>
      <p class="say">回転数を測れませんでした</p>
      <p class="note">本体の画面で理由を確かめてから、やり直してください。</p>
      <div class="bottom">
        <button class="btn go act" data-act="retry">もう一度(モーターが回ります)</button>
        <button class="btn sub act" data-cmd="mot.home">中止</button>
      </div>`;
  },
  selResult() {
    return `<span class="state" data-k="label"></span>
      <div data-k="selRes"></div>
      <div data-k="ownerBox">${ownerField()}</div>
      <div class="bottom" data-k="selBtns"></div>`;
  },
  selList() {
    if (local) return unitsLocalHtml();
    return `<span class="state" data-k="label"></span>
      <div data-k="unitList"></div>
      <div class="bottom pair">
        <button class="btn go act" data-cmd="sel.input">番号入力へ</button>
        <button class="btn sub act" data-cmd="mot.home">ホームへ</button>
      </div>`;
  },
};

// 選別の一覧と詳細(ページの中だけで開く。本体は動かさない)
function unitsLocalHtml() {
  if (local === 'list') {
    return `<span class="state">一覧(推定回転数の速い順)</span>
      <div data-k="unitList"></div>
      <div class="bottom"><button class="btn sub" data-act="back">戻る</button></div>`;
  }
  return `<span class="state">個体の詳細</span>
    <div data-k="unitDetail"></div>
    <div class="bottom"><button class="btn sub" data-act="list">一覧へ</button></div>`;
}

const unitRow = (no) => st.units.rows.find((r) => r.no === no) ?? null;

// 作り直すのは中身が変わったときだけ(0.25 秒ごとの回転数で作り直さない)
function setHtml(k, html) {
  const el = view.querySelector(`[data-k="${k}"]`);
  if (el && el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  return el;
}

// 手動運転のボタン(止まっている・回っている・一時停止で変わる)
function manButtons(run) {
  if (run === 2) return `<button class="btn sub act" data-cmd="man.pause">一時停止</button>${stopBtn('長押しで停止')}`;
  if (run === 3) return `<button class="btn go act" data-act="manStart">再開(モーターが回ります)</button>${stopBtn('長押しで停止')}`;
  return `<button class="btn go act" data-act="manStart">開始(モーターが回ります)</button>
    <button class="btn sub act" data-cmd="mot.home">戻る</button>`;
}

// 3.0V の確認の回転数を全部並べる枠(慣らし中と結果の一番下)
function checksBox() {
  return `<div class="checks">
      <p class="checksHead">3.0V の確認の回転数</p>
      <div data-k="chkList"></div>
    </div>`;
}

function checksRows(rpm) {
  if (!rpm.length) return '<p class="note">まだ確認していません</p>';
  return rpm.map((r, k) => {
    const d = k > 0 ? r - rpm[k - 1] : null;
    const diff = d === null ? '' : `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${num(Math.abs(d))}</span>`;
    return `<div class="chkRow"><span>${k + 1} 回目</span><b>${num(r)}</b>${diff}</div>`;
  }).join('');
}

function crsSetupHtml() {
  return `<span class="state">慣らしの設定</span>
    <label class="row"><span>慣らし方</span><select class="act" data-set="crs.mode" data-f="mode"></select></label>
    <div class="row"><span>目標</span><span class="tgt">
      <select class="act" data-f="tgtKind"><option value="auto">自動</option><option value="manual">手入力</option></select>
      <input class="act" inputmode="numeric" data-f="tgtRpm" aria-label="目標 rpm">
    </span></div>
    <label class="row"><span>電圧 V</span><input class="act" inputmode="decimal" data-f="v" aria-label="電圧"></label>
    <div class="row"><span>最大時間</span><span class="hm">
      <input class="act" inputmode="numeric" data-f="maxH" aria-label="時間">時間
      <input class="act" inputmode="numeric" data-f="maxM" aria-label="分">分
    </span></div>
    <label class="row"><span>確認の間隔</span><select class="act" data-set="crs.check" data-f="check">
      <option value="30">30分</option><option value="60">60分</option></select></label>
    <label class="row"><span>定期ゴミ取り</span><select class="act" data-set="crs.periodic" data-f="periodic">
      <option value="0">しない</option><option value="1">する</option></select></label>
    <label class="row"><span>事前チェック</span><select class="act" data-set="crs.pre" data-f="pre">
      <option value="0">しない</option><option value="1">する</option></select></label>
    <label class="row"><span>事後チェック</span><select class="act" data-set="crs.post" data-f="post">
      <option value="0">しない</option><option value="1">する</option></select></label>
    <label class="row"><span>個体の番号</span><input class="act" inputmode="numeric" data-f="unit" aria-label="個体の番号"></label>
    <div class="bottom">
      <button class="btn go act" data-act="start">開始</button>
      <button class="btn sub" data-act="back">戻る</button>
    </div>`;
}

function motorsHtml(cmd = 'mot.type') {
  const list = st.config?.motors ?? [];
  const rows = list.map((name, k) => `<button class="row act" data-cmd="${cmd}" data-arg="${k}" data-motor="${k}"><span>${esc(name)}</span><span></span></button>`).join('');
  return `<span class="state">機種</span>${rows || '<p class="note">機種の一覧を待っています…</p>'}
    <div class="bottom"><button class="btn sub" data-act="back">戻る</button></div>`;
}

// ===== 値の書き換え =====
function setK(k, text) {
  for (const el of view.querySelectorAll(`[data-k="${k}"]`)) el.textContent = text;
}

// 1 分ごとの回転数(慣らし電圧)。目標は 3.0V の確認の値なので同じ軸には描かない
function chartSvg(rpm) {
  const vals = rpm.filter((v) => v > 0);
  if (!vals.length) return '<svg viewBox="0 0 300 100"><text x="150" y="55" fill="#a9aab0" font-size="12" text-anchor="middle">1分ごとの回転数がここに出ます</text></svg>';
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 200) { const mid = (hi + lo) / 2; hi = mid + 100; lo = mid - 100; }
  const n = Math.max(rpm.length - 1, 1);
  const y = (v) => (92 - ((v - lo) / (hi - lo)) * 84).toFixed(1);
  const pts = rpm.map((v, k) => (v > 0 ? `${((k / n) * 296 + 2).toFixed(1)},${y(v)}` : null)).filter(Boolean).join(' ');
  const label = (v, yy) => `<text x="4" y="${yy}" fill="#a9aab0" font-size="10">${Math.round(v).toLocaleString('ja-JP')}</text>`;
  return `<svg viewBox="0 0 300 100" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#7fe3a3" stroke-width="2" vector-effect="non-scaling-stroke"/>${label(hi, 11)}${label(lo, 97)}</svg>`;
}

function crsSummary(c) {
  if (!c) return '';
  const prog = c.mode > 0 ? (c.progs?.find((p) => p.mode === c.mode)?.name ?? 'プログラム') : 'おまかせ';
  const tgt = c.tgt_manual ? `${num(c.tgt_rpm)}rpm` : `自動 ${num(c.auto_rpm)}rpm`;
  return `${prog}・${tgt}`;
}

// 入力中の欄は書き換えない
function setField(f, value) {
  const el = view.querySelector(`[data-f="${f}"]`);
  if (!el || el === document.activeElement) return;
  el.value = String(value);
}

function fillCrsSetup() {
  const c = st.config, s = st.status;
  if (!c) return;
  const modeSel = view.querySelector('[data-f="mode"]');
  if (modeSel && modeSel !== document.activeElement) {
    const opts = [`<option value="0">おまかせ</option>`].concat((c.progs ?? []).map((p) => `<option value="${p.mode}">${esc(p.name)}</option>`));
    const html = opts.join('');
    if (modeSel.dataset.html !== html) { modeSel.innerHTML = html; modeSel.dataset.html = html; }
    modeSel.value = String(c.mode);
  }
  setField('tgtKind', c.tgt_manual ? 'manual' : 'auto');
  const rpmEl = view.querySelector('[data-f="tgtRpm"]');
  if (rpmEl && rpmEl !== document.activeElement) {
    rpmEl.value = String(c.tgt_manual ? c.tgt_rpm : Math.round(c.auto_rpm || 0));
    rpmEl.disabled = !c.tgt_manual;
  }
  setField('v', (c.v10 / 10).toFixed(1));
  setField('maxH', Math.floor(c.max_min / 60));
  setField('maxM', c.max_min % 60);
  setField('check', c.check_min);
  setField('periodic', c.periodic);
  setField('pre', c.pre);
  setField('post', c.post);
  const unitEl = view.querySelector('[data-f="unit"]');
  if (unitEl && !unitEl.value && s?.next_unit) unitEl.value = String(s.next_unit);
}

function render() {
  const scr = screenFor(st);
  if (scr !== localFor) { local = null; localFor = scr; }
  const key = local ? `${scr}:${local}` : scr;
  if (key !== shown) {
    shown = key;
    view.innerHTML = SCREENS[scr]();
    bindLongPresses(view);
  }
  const s = st.status;
  view.classList.toggle('off', !st.connected);

  // 上の帯
  const banner = $('banner');
  if (!st.versionOk) {
    banner.hidden = false; banner.className = 'banner bad';
    banner.textContent = '本体のプログラムとページの版が違います。ページを読み込み直してください。';
  } else if (st.stale) {
    banner.hidden = false; banner.className = 'banner';
    banner.textContent = '切断中: 最後の値を表示しています';
  } else {
    banner.hidden = true;
  }
  if (st.connected) setConn('on', '接続中');
  else if (!device && !DEMO) setConn('', '未接続');

  if (!s) return;
  setK('label', s.label || '');
  setK('v', num(s.v, 3));
  setK('i', num(s.i, 2));
  setK('temp', num(s.temp, 1));
  setK('mah', num(s.mah));
  setK('preset', num(s.preset, 2));
  setK('error', s.error || 'エラー');
  setK('prompt', s.prompt || '本体の案内を見てください');
  setK('rpm', num(s.rpm));
  setK('target', num(s.target));
  setK('checks', s.checks_max ? `${s.checks} / ${s.checks_max}` : String(s.checks ?? 0));
  setK('elapsed', s.max_s ? `${mmss(s.elapsed_s)} / ${hm(Math.round(s.max_s / 60))}` : mmss(s.elapsed_s));

  if (scr === 'batSetup') {
    for (const el of view.querySelectorAll('[data-preset]')) {
      el.classList.toggle('on', Math.abs(PRESETS[+el.dataset.preset] - s.preset) < 0.01);
    }
    const box = view.querySelector('[data-k="countdownBox"]');
    box.hidden = s.phase !== PHASE.BAT_COUNTDOWN;
    setK('countdown', `あと ${s.detect_s} 秒で充電を始めます`);
  }
  setK('live', num(s.live));
  setK('mv', num(s.v, 2));
  if (scr === 'motBusy') {
    view.querySelector('[data-k="liveBox"]').hidden = !(typeof s.live === 'number');
    const running = s.phase === PHASE.MOT_RUN;
    view.querySelector('[data-k="busyStop"]').hidden = !running;
    setK('busyNote', running ? '止めることだけできます。' : '本体の操作が終わるまで、スマホからは操作できません。');
  }
  if (scr === 'run') {
    view.querySelector('[data-k="chart"]').innerHTML = chartSvg(st.history.rpm);
  }
  const chk = view.querySelector('[data-k="chkList"]');
  if (chk) {
    const html = checksRows(st.checks.rpm);
    if (chk.dataset.html !== html) { chk.dataset.html = html; chk.innerHTML = html; }   // 0.25 秒ごとに作り直さない
  }
  renderStage2(scr, s);
  if (scr === 'speed' || scr === 'speedBusy') renderSpeed(scr, s);
  if (scr === 'motMenu') {
    const c = st.config;
    setK('crsSummary', crsSummary(c));
    setK('motorName', c?.motors?.[c.motor] ?? '');
    setK('labKeyState', labKey() ? '入力済み' : '未入力');
    if (local === 'crs') fillCrsSetup();
    if (local === 'motors') {
      for (const el of view.querySelectorAll('[data-motor]')) {
        el.lastElementChild.textContent = +el.dataset.motor === c?.motor ? '使用中' : '';
      }
    }
  }
}
let wasConnected = false;
store.onChange = () => {
  if (st.connected !== wasConnected) { wasConnected = st.connected; delFetchedFor = ''; }   // つなぎ直したら受け取り直す
  render();
  labUploadIfRequested(st.status);
  syncDeleted(st.status);
};

// スピードマネージャーの値。速度はページで計算する(本体の画面と同じ式)
function speedBand(s) {
  const motor = st.config?.motors?.[s.smot] ?? '';
  return `${num(s.tire / 10, 1)}mm ・ ${num(s.gear / 10, 1)}:1 ・ ${motor}`;
}
function renderSpeed(scr, s) {
  setK('spdBand', speedBand(s));
  if (scr !== 'speed') return;
  if (local === 'motors') {
    for (const el of view.querySelectorAll('[data-motor]')) el.lastElementChild.textContent = +el.dataset.motor === s.smot ? '使用中' : '';
    return;
  }
  const kmh = speedKmh(s.live, s.gear, s.tire);
  const kmhMax = speedKmh(s.smax, s.gear, s.tire);
  setK('kmh', kmh === null ? '---' : num(kmh, 1));
  setK('live', typeof s.live === 'number' ? num(s.live) : '---');
  setK('kmhMax', kmhMax === null ? '---' : num(kmhMax, 1));
  setK('smax', typeof s.smax === 'number' ? num(s.smax) : '---');
  setK('spdMotor', st.config?.motors?.[s.smot] ?? '');
  setField('spdTire', (s.tire / 10).toFixed(1));
  for (const el of view.querySelectorAll('[data-gear]')) el.classList.toggle('on', +el.dataset.gear === s.gi);
}

function bindLongPresses(root) {
  for (const el of root.querySelectorAll('[data-long]')) bindLongPress(el, () => send(el.dataset.long));
}

// 段階2 の画面の値
function renderStage2(scr, s) {
  if (scr === 'batSetup') {
    setK('buz', s.buz ? 'ON' : 'OFF');
    setK('race', s.race ? 'ON' : 'OFF');
  }
  if (scr === 'batRun') view.querySelector('[data-k="bdoneBox"]').hidden = !s.bdone;
  if (scr === 'run') {
    const b = view.querySelector('[data-k="skipBtn"]');
    b.hidden = !s.skip;
    b.textContent = s.label === '冷却中' ? '冷却を飛ばす' : '休憩を飛ばす(モーターが回ります)';
  }
  if (scr === 'manual') {
    view.querySelector('.state')?.classList.toggle('run', s.run === 2);
    setK('manNote', s.run === 1 ? 'モーターをつないだのを検出しました(まもなく回ります)'
      : s.run === 0 ? '「開始」を押すと、下の電圧で回ります' : '今の回転数(本体の画面と同じ)');
    setK('kv', typeof s.live === 'number' && s.v > 0.1 ? num(s.live / s.v) : '—');
    setField('manV', (s.mset / 10).toFixed(1));
    const box = view.querySelector('[data-k="manBtns"]');
    if (box.dataset.run !== String(s.run)) { box.dataset.run = String(s.run); box.innerHTML = manButtons(s.run); bindLongPresses(box); }
  }
  const rows = st.units.rows;
  if (local === 'list' || (scr === 'selList' && !local)) setHtml('unitList', unitListHtml(rows, null));
  if (local?.startsWith('d:')) {
    const r = unitRow(+local.slice(2));
    setHtml('unitDetail', r ? unitDetailHtml(r) : '<p class="note">この個体の記録がありません</p>');
  }
  if (scr === 'selResult') {
    setHtml('selRes', measResultHtml(s));
    view.querySelector('[data-k="ownerBox"]').hidden = !!s.msaved;   // 保存したあとは変えられない
    // ボタン: 保存前 = 保存 / 終了。保存後 = (再送) / 次を測る / 終了
    const btns = view.querySelector('[data-k="selBtns"]');
    const sig = `${s.msaved}:${s.mup}:${labKey() ? 1 : 0}`;
    if (btns.dataset.sig !== sig) {
      btns.dataset.sig = sig;
      btns.innerHTML = !s.msaved
        ? `<button class="btn go act" data-act="selSave">保存(モーターラボに登録)</button>
           <button class="btn sub act" data-act="selEnd">終了(保存しない)</button>`
        : `${s.mup === 7 || s.mup === 4 ? '<button class="btn sub act" data-act="labKey">送信キーを入れる</button>' : ''}
           ${canResend(s) ? '<button class="btn go act" data-act="selSave">モーターラボに再送</button>' : ''}
           <div class="pair">
             <button class="btn go act" data-cmd="sel.input">次を測る</button>
             <button class="btn sub act" data-cmd="sel.end">終了</button>
           </div>`;
    }
  }
  if (scr === 'selInput' || scr === 'selResult') {
    // 所有者の欄: 本体が持っている名前を入れておく(打っている途中は書き換えない)
    const o = view.querySelector('[data-f="owner"]');
    if (o && o !== document.activeElement && o.value !== (s.owner || '')) o.value = s.owner || '';
  }
  if (scr === 'selInput') {
    const f = view.querySelector('[data-f="selNo"]');
    if (f && !f.value && s.next_unit) f.value = String(s.next_unit);
    const no = parseInt(f?.value, 10);
    setK('selNoNote', !(no >= 1 && no <= 999) ? '番号は 1〜999' : '');
  }
}

// ===== 押したとき =====
view.addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el || el.disabled) return;
  if (el.dataset.unit) { local = `d:${el.dataset.unit}`; render(); return; }
  if (el.dataset.cmd) {
    send(el.dataset.cmd, el.dataset.arg === undefined ? undefined : Number(el.dataset.arg));
    if (el.dataset.cmd === 'mot.type' || el.dataset.cmd === 'spd.motor') { local = null; render(); }
    return;
  }
  const s = st.status;
  switch (el.dataset.act) {
    case 'connect': connectTap(); break;
    case 'crs': local = 'crs'; render(); break;
    case 'list': local = 'list'; render(); break;
    case 'buz': send('bat.buzzer', s?.buz ? 0 : 1); break;
    case 'race': send('bat.race', s?.race ? 0 : 1); break;
    case 'skip':
      if (s?.label === '冷却中') { if (await ask('冷却を飛ばしますか?\n本体の案内が出たら、それに従ってください。', '飛ばす')) send('skip'); }
      else if (await ask('休憩を飛ばして次のステップへ進みますか?\nモーターが回ることがあります。', '飛ばす')) send('skip');
      break;
    case 'manV': {
      const v = Math.round(parseFloat(view.querySelector('[data-f="manV"]').value) * 10);
      if (!(v >= 5 && v <= 30)) { toast('電圧は 0.5〜3.0V で入れてください'); return; }
      send('man.v', v);
      break;
    }
    case 'spdTire': {
      const v = Math.round(parseFloat(view.querySelector('[data-f="spdTire"]').value) * 10);
      if (!(v >= TIRE_X10_MIN && v <= TIRE_X10_MAX)) { toast('タイヤ径は 22.0〜31.0mm で入れてください'); return; }
      send('spd.tire', v);
      break;
    }
    case 'spdClr':
      if (await ask('最高値を消しますか?', '消す')) send('spd.clr');
      break;
    case 'manStart':
      if (await ask(`${num((s?.mset ?? 0) / 10, 1)}V でモーターを回します。`, '回す')) send('man.start');
      break;
    case 'selStart': {
      const no = parseInt(view.querySelector('[data-f="selNo"]').value, 10);
      if (!(no >= 1 && no <= 999)) { toast('個体の番号は 1〜999 で入れてください'); return; }
      const owner = s?.owner || '';
      if (await ask(`${no} 番(所有者: ${owner || '未入力'})を測ります。\nセレクターを付けて負荷 10 秒 → 外して無負荷 10 秒。本体の案内に従ってください。`, '測る')) {
        send('sel.start', no);
      }
      break;
    }
    case 'selSave':
      if (!s?.owner && !(await ask('所有者が入っていません。このまま保存しますか?\n(モーターラボで後から直せます)', '保存する'))) return;
      send('sel.save');
      break;
    case 'labKey': editLabKey(); break;
    case 'selEnd':
      if (await ask('保存しないで終わりますか?\nこの計測は残りません。', '終了')) send('sel.end');
      break;
    case 'motors': local = 'motors'; render(); break;
    case 'back': local = null; render(); break;
    case 'next':
      if (await ask(`${s?.prompt || '本体の案内'}\n\nできていますか? 進めるとモーターが回ります。`)) send('next');
      break;
    case 'retry':
      if (await ask('もう一度測ります。モーターが回ります。')) send('retry');
      break;
    case 'start': {
      const no = parseInt(view.querySelector('[data-f="unit"]').value, 10);
      if (!(no >= 1 && no <= 999)) { toast('個体の番号は 1〜999 で入れてください'); return; }
      if (await ask(`No.${no} の慣らしを始めますか?\n本体に「セレクターを外してください」と出たら、外してから「次へ」を押します。`, '始める')) {
        send('crs.start', no);
      }
      break;
    }
  }
});

// 設定の欄: 決めたとき(change)に送る。値の範囲は本体が見る
view.addEventListener('change', (e) => {
  const el = e.target;
  const f = el.dataset.f;
  if (!f) return;
  if (f === 'selNo' || f === 'manV' || f === 'spdTire') { render(); return; }   // 送るのはボタンを押したとき
  if (f === 'owner') {
    const name = el.value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!textArgOk(name)) { toast('所有者の名前が長すぎます(日本語でおよそ 15 文字まで)'); return; }
    rememberOwner(name);
    send('sel.owner', name);
    return;
  }
  const int = (v) => parseInt(v, 10);
  switch (f) {
    case 'mode': case 'check': case 'periodic': case 'pre': case 'post':
      send(el.dataset.set, int(el.value));
      break;
    case 'tgtKind': {
      const rpmEl = view.querySelector('[data-f="tgtRpm"]');
      if (el.value === 'auto') send('crs.target', 0);
      else { rpmEl.disabled = false; rpmEl.focus(); }
      break;
    }
    case 'tgtRpm': {
      const v = int(el.value);
      if (Number.isInteger(v)) send('crs.target', v);
      break;
    }
    case 'v': {
      const v = Math.round(parseFloat(el.value) * 10);
      if (Number.isInteger(v)) send('crs.v10', v);
      break;
    }
    case 'maxH': case 'maxM': {
      const h = int(view.querySelector('[data-f="maxH"]').value) || 0;
      const m = int(view.querySelector('[data-f="maxM"]').value) || 0;
      send('crs.max', h * 60 + m);
      break;
    }
  }
});

// ===== 見本(?demo=1): Bluetooth を使わずに全部の画面を出す =====
const demo = {
  phase: 0,
  spd: { tire: 235, gi: 0, smot: 2, smax: 36210 },
  meas: { owner: 'かえで', saved: 0, up: 0, req: 0 },
  status(phase) {
    const base = { t: 's', phase, label: '', prompt: '', v: 0, i: 0, temp: 28.5, target: 0, elapsed_s: 0, max_s: 0, rpm: null, live: null,
      checks: 0, checks_max: 0, mah: 0, preset: 2.8, detect_s: 0, error: '', next_unit: 12,
      run: 0, mset: 30, skip: 0, sel_no: 0, note: '', buz: 1, race: 0, bdone: 0,
      tire: demo.spd.tire, gear: GEARS_X10[demo.spd.gi], gi: demo.spd.gi, smot: demo.spd.smot, smax: demo.spd.smax,
      mload: null, mnl: null, mw: null, mrank: 0, mtotal: 0, msaved: 0, mup: 0, owner: demo.meas.owner };
    const set = {
      0: {}, 1: { label: 'READY', v: 2.41 }, 2: { label: 'READY', v: 2.41, detect_s: 3 },
      3: { label: 'CHARGE', v: 2.63, i: 1.24, mah: 312, elapsed_s: 754 }, 4: { label: 'RESULT', mah: 690, elapsed_s: 1830 },
      5: { label: 'ERROR', error: 'OVER TEMP' }, 6: { label: 'ハイパーダッシュ3' }, 7: { label: '計測', live: 30480 },
      8: { label: '手動運転', rpm: 21000, live: 21030 }, 9: { label: 'コース1/3 診断(前)', prompt: 'セレクターを外してください' },
      10: { label: '慣らし', rpm: 15980, live: 16020, target: 36000, elapsed_s: 4321, max_s: 21600, checks: 1, checks_max: 6, v: 1.5, i: 0.63 },
      11: { label: '測れませんでした' }, 12: { label: '結果', rpm: 36210, target: 36000, elapsed_s: 14400, max_s: 21600, checks: 4, checks_max: 6 },
      13: { label: '手動運転', run: 0, v: 0.02 }, 14: { label: '手動運転 回転中', run: 2, live: 32480, v: 2.98, i: 1.12, elapsed_s: 222 },
      15: { label: '計測　番号入力', next_unit: 13 }, 16: { label: '計測 No.13', prompt: 'セレクターを付けてください(負荷 10秒)', live: 28910, sel_no: 13 },
      17: { label: '計測 No.13', live: 28880, sel_no: 13 }, 18: { label: '計測 No.13 測れませんでした', sel_no: 13 },
      19: { label: '計測　結果', sel_no: 13, mload: 15234, mnl: 17610, mw: 6.12, mrank: 3, mtotal: 12, msaved: demo.meas.saved, mup: demo.meas.up,
        mreq: demo.meas.up === 3 ? demo.meas.req : 0, mkey: 'single__ハイパーダッシュ', mdate: '2026-11-10' },
      20: { label: '計測　一覧' },
      21: { phase: 14, label: '手動運転 一時停止', run: 3, live: 32100, v: 0, elapsed_s: 240 },
      22: { phase: 10, label: '冷却中', skip: 1, target: 36000 },
      23: { phase: 3, label: 'DONE', v: 2.80, i: 0.01, mah: 690, elapsed_s: 1830, bdone: 1 },
      24: { phase: 21, label: 'スピード', live: 34870 }, 25: { phase: 22, label: '本体で設定中' },
      26: { phase: 21, label: 'スピード', live: null },
    };
    return JSON.stringify({ ...base, ...set[phase] });
  },
  show(phase) {
    this.phase = phase;
    const chk = phase === 10 ? [34120, 35020] : phase === 12 ? [34120, 35020, 35680, 36210] : [];
    store.apply(JSON.stringify({ t: 'k', course: 1, rpm: chk }));
    store.apply(this.status(phase));
    if (phase === 15 || phase === 19 || phase === 20) this.units();
  },
  units() {
    const rows = [
      { no: 7, bi: 1, date: '11/08', nref: 36110, nl: 37200, prev: '前回 11/01 より +1.2%', pt: 1, life: '寿命 80%', lt: 1, ba: '慣らし前 → 後 +2.4%', flags: '' },
      { no: 13, bi: 0, date: '11/09', nref: 35420, nl: 36980, prev: '前回なし', pt: 0, life: '寿命 64%', lt: 1, ba: '', flags: '？ 測り直しをすすめます(熱だれ)' },
      { no: 2, bi: 1, date: '11/05', nref: 34870, nl: 36010, prev: '前回 10/30 より -0.8%', pt: 2, life: '寿命 22%', lt: 2, ba: '', flags: '' },
    ];
    rows.forEach((r, i) => store.apply(JSON.stringify({ t: 'u', i, n: rows.length, ...r })));
  },
};

function demoCommand(id, op, arg) {
  setTimeout(() => {
    store.apply(JSON.stringify({ t: 'r', id, res: 'ok' }));
    const p = demo.phase;
    if (op === 'spd.tire') demo.spd.tire = arg;
    if (op === 'spd.gear') demo.spd.gi = arg;
    if (op === 'spd.motor') { demo.spd.smot = arg; demo.spd.smax = null; }
    if (op === 'spd.clr') demo.spd.smax = null;
    if (op === 'sel.owner') demo.meas.owner = arg || '';
    if (op === 'sel.save') { demo.meas.saved = 1; demo.meas.up = 3; demo.meas.req++; }   // 送信中 → ページが送って sel.uploaded
    if (op === 'sel.uploaded') demo.meas.up = arg;
    if (op === 'sel.start' || op === 'sel.input') { demo.meas.saved = 0; demo.meas.up = 0; }
    const go = { app: [0, 1, 6, 24][arg], 'bat.cancel': 1, stop: p >= 13 ? 6 : p >= 9 ? 12 : p >= 6 ? 6 : 1, 'err.clear': 1,
      close: p === 4 ? 1 : 6, next: p === 16 ? 17 : 10, retry: p === 18 ? 16 : 9, 'crs.start': 9,
      'man.enter': 13, 'man.start': 14, 'man.pause': 21, 'mot.home': 6, 'sel.enter': 15, 'sel.start': 16, 'sel.startbi': 16,
      'sel.redo': 16, 'sel.input': 15, 'sel.save': 19, 'sel.uploaded': 19, 'sel.end': 6, 'sel.owner': p, skip: 10, 'bat.finish': 3, 'bat.recheck': 3,
      'spd.tire': p, 'spd.gear': p, 'spd.motor': p, 'spd.clr': p }[op];
    if (go !== undefined) demo.show(go);
    if (op === 'bat.preset') store.apply(demo.status(demo.phase).replace('"preset":2.8', `"preset":${PRESETS[arg]}`));
  }, 150);
}

function startDemo() {
  store.markConnected();
  store.apply('{"t":"hello","v":1}');
  store.apply(JSON.stringify({ t: 'c', mode: 0, v10: 15, max_min: 360, check_min: 60, periodic: 0, pre: 1, post: 1,
    tgt_manual: 0, tgt_rpm: 35000, auto_rpm: 35004, motor: 2,
    motors: ['トルクチューン2', 'アトミックチューン2', 'ハイパーダッシュ3', 'マッハダッシュPRO', 'ライトダッシュ'],
    progs: [{ mode: 2, name: 'じっくり' }] }));
  const rpm = Array.from({ length: 72 }, (_, k) => 15500 + 600 * (1 - Math.exp(-k / 25)) + (k % 7) * 15);
  store.apply(JSON.stringify({ t: 'h', course: 24, from: 0, rpm, i: rpm.map(() => 0.63) }));
  const bar = $('demo');
  bar.hidden = false;
  const names = ['選択', '電池待機', '数え中', '充電中', '充電結果', 'エラー', 'モーター', '本体操作', '本体運転', '案内', '慣らし中', '失敗', '結果',
    '手動', '手動回転', '計測番号', '計測案内', '計測中', '計測失敗', '計測結果', '(旧)一覧', '手動一時停止', '冷却中', '充電完了待ち',
    'スピード', 'スピード設定中', 'スピード測れず'];
  bar.innerHTML = names.map((n, k) => `<button data-demo="${k}">${n}</button>`).join('') + '<button data-demo="cut">切断</button>';
  bar.addEventListener('click', (e) => {
    const k = e.target.dataset.demo;
    if (k === undefined) return;
    if (k === 'cut') { store.markDisconnected(); return; }
    if (!st.connected) store.markConnected();
    demo.show(+k);
  });
  setConn('on', '見本');
  demo.show(0);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
if (DEMO) startDemo();
render();
