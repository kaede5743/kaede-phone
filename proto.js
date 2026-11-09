// KaedeSystem とのやりとり(行の組み立て・状態の保持・画面の振り分け)。画面の部品には触らない
// 取り決めは docs/superpowers/plans/2026-11-07-phone-ble-stage0-1.md の「通信の取り決め」と phone_proto.h

export const PROTO_VERSION = 1;

// 本体の PhPhase と同じ順番
export const PHASE = Object.freeze({
  SELECTOR: 0, BAT_READY: 1, BAT_COUNTDOWN: 2, BAT_RUN: 3, BAT_RESULT: 4, BAT_ERROR: 5,
  MOT_IDLE: 6, MOT_BUSY: 7, MOT_RUN: 8, CRS_PROMPT: 9, CRS_RUN: 10, CRS_FAIL: 11, CRS_RESULT: 12,
  MAN_IDLE: 13, MAN_RUN: 14, SEL_INPUT: 15, SEL_PROMPT: 16, SEL_RUN: 17, SEL_FAIL: 18, SEL_RESULT: 19, SEL_LIST: 20,
});

const SCREEN_OF_PHASE = [
  'selector', 'batSetup', 'batSetup', 'batRun', 'batResult', 'batError',
  'motMenu', 'motBusy', 'motBusy', 'prompt', 'run', 'fail', 'result',
  'manual', 'manual', 'selInput', 'selPrompt', 'selRun', 'selFail', 'selResult', 'selList',
];

export const REJECT_TEXT = Object.freeze({
  bad: '命令が読めませんでした',
  range: 'その値は使えません',
  state: '今は受け付けられません(状態が変わりました)',
  busy: '本体で操作中です',
});

// notify で分けて届いた文字を、改行ごとの行に戻す。改行が来ないまま max を超えたら次の改行まで捨てる
export class LineBuffer {
  constructor(max = 4096) {
    this.max = max;
    this.buf = '';
    this.dropping = false;
  }
  push(text) {
    const out = [];
    for (const ch of text) {
      if (ch === '\n') {
        if (!this.dropping && this.buf.length > 0) out.push(this.buf);
        this.buf = '';
        this.dropping = false;
      } else if (ch === '\r') {
        // 捨てる
      } else if (!this.dropping) {
        this.buf += ch;
        if (this.buf.length > this.max) { this.buf = ''; this.dropping = true; }
      }
    }
    return out;
  }
}

export function createStore() {
  const state = {
    connected: false,
    stale: false,          // 切れたあと、新しい状態がまだ届いていない
    status: null,
    config: null,
    history: { course: null, rpm: [], i: [] },
    checks: { course: null, rpm: [] },   // 3.0V の確認の回転数(測れた回だけ)
    units: { n: 0, rows: [], complete: false },   // 選別の個体の一覧(本体が推定回転数の速い順に送る)
    versionOk: true,
  };
  const store = {
    state,
    onReply: null,         // (id, res) => void
    onChange: null,        // () => void
    apply(line) {
      let m;
      try { m = JSON.parse(line); } catch { return false; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
      switch (m.t) {
        case 's':
          state.status = m;
          state.stale = !state.connected;
          break;
        case 'l':   // 今の回転数だけ。状態が届く前は捨てる
          if (!state.status) return false;
          state.status.live = m.live;
          break;
        case 'c':
          state.config = m;
          break;
        case 'h':
          applyHistory(state.history, m);
          break;
        case 'u':
          if (!applyUnit(state.units, m)) return false;
          break;
        case 'k':   // 本体は変わるたびに一覧を全部送る
          if (!Array.isArray(m.rpm) || !m.rpm.every((v) => typeof v === 'number')) return false;
          state.checks = { course: m.course, rpm: m.rpm };
          break;
        case 'r':
          if (store.onReply) store.onReply(m.id, m.res);
          break;
        case 'hello':
          state.versionOk = m.v === PROTO_VERSION;
          break;
        default:
          return false;
      }
      if (store.onChange) store.onChange();
      return true;
    },
    markConnected() {
      state.connected = true;
      if (state.status) state.stale = true;   // 新しい状態が届くまでは古い値
      if (store.onChange) store.onChange();
    },
    markDisconnected() {
      state.connected = false;
      if (state.status) state.stale = true;
      if (store.onChange) store.onChange();
    },
  };
  return store;
}

// 個体の一覧の 1 行。i=0 で作り直し、飛んだ行は入れない(本体は印が変わると先頭から送り直す)
function applyUnit(u, m) {
  if (!Number.isInteger(m.i) || !Number.isInteger(m.n) || m.i < 0 || m.n < 0) return false;
  if (m.i === 0) { u.n = m.n; u.rows = []; u.complete = m.n === 0; }
  if (m.n === 0) return true;
  if (m.i !== u.rows.length || m.n !== u.n) return true;   // 飛んだ・別の一覧の行は捨てる
  const { t, i, n, ...row } = m;
  u.rows.push(row);
  u.complete = u.rows.length === u.n;
  return true;
}

function applyHistory(h, m) {
  if (!Array.isArray(m.rpm) || !Array.isArray(m.i) || !Number.isInteger(m.from) || m.from < 0) return;
  if (h.course !== m.course) { h.course = m.course; h.rpm = []; h.i = []; }
  if (m.from > h.rpm.length) return;   // 間が抜ける。本体は先頭から送り直すので待つ
  h.rpm.length = m.from;
  h.i.length = m.from;
  h.rpm.push(...m.rpm);
  h.i.push(...m.i.slice(0, m.rpm.length));
}

// 画面の名前。状態が届くまでは接続画面。切れていても最後の状態の画面を出す
export function screenFor(state) {
  if (!state.status) return 'connect';
  return SCREEN_OF_PHASE[state.status.phase] ?? 'motBusy';
}

export function buildCommand(id, op, arg) {
  if (!Number.isInteger(id) || id < 0 || id > 65535) throw new Error('bad id');
  if (!/^[a-z.]+$/.test(op)) throw new Error('bad op');
  if (arg === undefined) return `${id} ${op}\n`;
  if (!Number.isInteger(arg)) throw new Error('bad arg');
  return `${id} ${op} ${arg}\n`;
}
