// KaedeSystem をスマホから操作するページ。本体の状態を映すだけで、操作できるかは本体が決める
import { LineBuffer, createStore, screenFor, buildCommand, REJECT_TEXT, PHASE } from './proto.js';

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

function send(op, arg) {
  if (!st.connected) { toast('つながっていません'); return; }
  if (pending && pending.op === op && arg === undefined) return;   // 連打
  const q = queue.find((x) => x.op === op);
  if (q) { q.arg = arg; return; }
  queue.push({ op, arg });
  pump();
}

async function pump() {
  if (pending || queue.length === 0) return;
  const { op, arg } = queue.shift();
  const id = nextId;
  nextId = nextId >= 65535 ? 1 : nextId + 1;
  const line = buildCommand(id, op, arg);
  pending = { id, op, timer: setTimeout(() => { pending = null; toast('届きませんでした'); pump(); }, REPLY_TIMEOUT_MS) };
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
  pending = null;
  if (res !== 'ok') toast(REJECT_TEXT[res] || `断られました (${res})`);
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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
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
let local = null;              // モーターの待機中にページの中だけで開く画面: 'crs' | 'motors'
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
      <button class="btn go appbig act" data-cmd="app" data-arg="1">バッテリー</button>
      <button class="btn go appbig act" data-cmd="app" data-arg="2">モーター</button>`;
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
      <div class="bottom">${stopBtn('長押しで停止')}</div>`;
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
      <div class="row dim"><span>選別・手動運転・プログラム</span><span>本体で操作</span></div>
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
      <div class="bottom">${stopBtn()}</div>`;
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
};

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

function motorsHtml() {
  const list = st.config?.motors ?? [];
  const rows = list.map((name, k) => `<button class="row act" data-cmd="mot.type" data-arg="${k}" data-motor="${k}"><span>${esc(name)}</span><span></span></button>`).join('');
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
  if (scr !== 'motMenu') local = null;
  const key = scr === 'motMenu' && local ? `motMenu:${local}` : scr;
  if (key !== shown) {
    shown = key;
    view.innerHTML = SCREENS[scr]();
    for (const el of view.querySelectorAll('[data-long]')) bindLongPress(el, () => send(el.dataset.long));
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
  if (scr === 'motMenu') {
    const c = st.config;
    setK('crsSummary', crsSummary(c));
    setK('motorName', c?.motors?.[c.motor] ?? '');
    if (local === 'crs') fillCrsSetup();
    if (local === 'motors') {
      for (const el of view.querySelectorAll('[data-motor]')) {
        el.lastElementChild.textContent = +el.dataset.motor === c?.motor ? '使用中' : '';
      }
    }
  }
}
store.onChange = render;

// ===== 押したとき =====
view.addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el || el.disabled) return;
  if (el.dataset.cmd) {
    send(el.dataset.cmd, el.dataset.arg === undefined ? undefined : Number(el.dataset.arg));
    if (el.dataset.cmd === 'mot.type') { local = null; render(); }
    return;
  }
  const s = st.status;
  switch (el.dataset.act) {
    case 'connect': connectTap(); break;
    case 'crs': local = 'crs'; render(); break;
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
  status(phase) {
    const base = { t: 's', phase, label: '', prompt: '', v: 0, i: 0, temp: 28.5, target: 0, elapsed_s: 0, max_s: 0, rpm: null, live: null,
      checks: 0, checks_max: 0, mah: 0, preset: 2.8, detect_s: 0, error: '', next_unit: 12 };
    const set = {
      0: {}, 1: { label: 'READY', v: 2.41 }, 2: { label: 'READY', v: 2.41, detect_s: 3 },
      3: { label: 'CHARGE', v: 2.63, i: 1.24, mah: 312, elapsed_s: 754 }, 4: { label: 'RESULT', mah: 690, elapsed_s: 1830 },
      5: { label: 'ERROR', error: 'OVER TEMP' }, 6: { label: 'ハイパーダッシュ3' }, 7: { label: '選別', live: 30480 },
      8: { label: '手動運転', rpm: 21000, live: 21030 }, 9: { label: 'コース1/3 診断(前)', prompt: 'セレクターを外してください' },
      10: { label: '慣らし', rpm: 15980, live: 16020, target: 36000, elapsed_s: 4321, max_s: 21600, checks: 1, checks_max: 6, v: 1.5, i: 0.63 },
      11: { label: '測れませんでした' }, 12: { label: '結果', rpm: 36210, target: 36000, elapsed_s: 14400, max_s: 21600, checks: 4, checks_max: 6 },
    };
    return JSON.stringify({ ...base, ...set[phase] });
  },
  show(phase) {
    this.phase = phase;
    const chk = phase === 10 ? [34120, 35020] : phase === 12 ? [34120, 35020, 35680, 36210] : [];
    store.apply(JSON.stringify({ t: 'k', course: 1, rpm: chk }));
    store.apply(this.status(phase));
  },
};

function demoCommand(id, op, arg) {
  setTimeout(() => {
    store.apply(JSON.stringify({ t: 'r', id, res: 'ok' }));
    const go = { app: [0, 1, 6][arg], 'bat.cancel': 1, stop: demo.phase >= 9 ? 12 : demo.phase >= 6 ? 6 : 1, 'err.clear': 1,
      close: demo.phase === 4 ? 1 : 6, next: 10, retry: 9, 'crs.start': 9 }[op];
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
  const names = ['選択', '電池待機', '数え中', '充電中', '充電結果', 'エラー', 'モーター', '本体操作', '本体運転', '案内', '慣らし中', '失敗', '結果', '切断'];
  bar.innerHTML = names.map((n, k) => `<button data-demo="${k}">${n}</button>`).join('');
  bar.addEventListener('click', (e) => {
    const k = e.target.dataset.demo;
    if (k === undefined) return;
    if (+k === 13) { store.markDisconnected(); return; }
    if (!st.connected) store.markConnected();
    demo.show(+k);
  });
  setConn('on', '見本');
  demo.show(0);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
if (DEMO) startDemo();
render();
