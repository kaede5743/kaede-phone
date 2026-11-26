// 充電の終わりを見分ける(画面の部品には触らない。test/notify.test.mjs でテスト)
// - 指定電圧: 充電中(BAT_RUN)に bdone が 1 になった最初の 1回 = 取り外しOK
// - 満充電(1本・2本): 充電中から結果(BAT_RESULT)へ = 満充電 完了
// - 充電中からエラー(BAT_ERROR)へ = 止まった(時間切れ・高温など)
// つないだ直後にもう終わっていた回は知らせない(つないだだけで鳴らさない)。
// 切れている間に終わった回は、つなぎ直して結果を受け取ったときに知らせる(見張りは切れても残す)
import { PHASE } from './proto.js';

export function createChargeWatch() {
  return { phase: null, told: false };
}

function mmss(s) {
  const n = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(n / 60)}分${String(n % 60).padStart(2, '0')}秒`;
}

function amount(s) {
  const parts = [];
  if (typeof s.mah === 'number') parts.push(`${Math.round(s.mah)} mAh`);
  if (typeof s.elapsed_s === 'number') parts.push(mmss(s.elapsed_s));
  return parts.join('・');
}

function what(s) {
  if (s.cell) return s.cell_no ? `満充電(1本) No.${s.cell_no}` : '満充電(1本)';
  if (s.full) return '満充電';
  return typeof s.preset === 'number' ? `${s.preset.toFixed(2)} V` : '充電';
}

// 状態を受け取るたびに呼ぶ。知らせることがあれば { kind, title, body } を返す
export function chargeEvent(w, s) {
  if (!s || typeof s.phase !== 'number') return null;
  const prev = w.phase;
  w.phase = s.phase;
  const charging = s.phase === PHASE.BAT_RUN;
  const ended = s.phase === PHASE.BAT_RESULT || s.phase === PHASE.BAT_ERROR;
  if (!charging && !ended) { w.told = false; return null; }   // 待機・番号入力・ほかのアプリ: 次の回に備える
  if (prev === null) { w.told = true; return null; }          // つないだ直後: 途中から知らせない
  if (w.told) return null;

  if (charging) {
    if (prev !== PHASE.BAT_RUN) return null;   // 始まったところ
    if (!s.bdone) return null;
    w.told = true;
    return { kind: 'done', title: '取り外しOK', body: `${what(s)}  ${amount(s)}` };
  }
  if (prev !== PHASE.BAT_RUN) { w.told = true; return null; }   // 充電を見ていないまま結果・エラーになった
  w.told = true;
  if (s.phase === PHASE.BAT_ERROR) {
    return { kind: 'error', title: '充電が止まりました', body: s.error || s.label || 'エラー' };
  }
  return { kind: 'full', title: (s.full || s.cell) ? '満充電 完了' : '充電 完了', body: `${what(s)}  ${amount(s)}` };
}
