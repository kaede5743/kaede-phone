// 選別の一覧・結果・詳細の HTML(純粋な関数)。行は本体の {"t":"u"} のまま(proto.js の state.units.rows)
// 文字は本体の画面と同じものが届くので、ここでは並べて色を付けるだけ

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

// 本体の色の段(0=灰 1=良い 2=注意 3=悪い)を CSS の class に
export const TONE_CLASS = ['', 'up', 'warn', 'down'];
const tone = (t) => TONE_CLASS[t] ?? '';
const state = (r) => (r.bi ? '慣らし済' : '新品');

// 推定回転数の速い順(本体が並べて送る)。markNo の行に印。行は data-unit に番号を持つ
export function unitListHtml(rows, markNo) {
  if (!rows.length) return '<p class="note">まだ測った個体がありません</p>';
  return rows.map((r, k) => `<button data-unit="${r.no}" class="row unitRow act${r.no === markNo ? ' mark' : ''}">
      <span>${k + 1}. ${r.no} 番 <small>${state(r)}</small></span>
      <span><b>${num(r.nref)}</b> <small class="${tone(r.lt)}">${esc(r.life)}</small></span>
    </button>`).join('');
}

// 1 本の詳細。値が無い欄は —
export function unitDetailHtml(r) {
  const extra = [r.ba, r.flags].filter(Boolean).map((t) => `<p class="note">${esc(t)}</p>`).join('');
  return `<p class="h">${r.no} 番(${state(r)})${r.date ? ` <small>${esc(r.date)}</small>` : ''}</p>
    <div class="grid">
      <div class="cell"><b>${num(r.nref)}</b><span>推定回転数 rpm</span></div>
      <div class="cell"><b>${num(r.nl)}</b><span>無負荷 rpm</span></div>
      <div class="cell"><b class="${tone(r.pt)}">${esc(r.prev) || '—'}</b><span>前回との比較</span></div>
      <div class="cell"><b class="${tone(r.lt)}">${esc(r.life) || '—'}</b><span>寿命の目安</span></div>
    </div>${extra}`;
}

// 選別の結果(画面の案⑥ の 4 つのマス)。行がまだ届いていなければそう出す
export function unitResultHtml(r, note) {
  const n = note ? `<p class="banner bad">${esc(note)}</p>` : '';
  if (!r) return `${n}<p class="note">結果を受け取っています</p>`;
  return `${n}<p class="h">${r.no} 番(${state(r)})</p>
    <div class="grid">
      <div class="cell"><b>${num(r.nref)}</b><span>推定回転数 rpm</span></div>
      <div class="cell"><b class="${tone(r.pt)}">${esc(r.prev) || '—'}</b><span>前回より</span></div>
      <div class="cell"><b>${num(r.nl)}</b><span>無負荷 rpm</span></div>
      <div class="cell"><b class="${tone(r.lt)}">${esc(r.life) || '—'}</b><span>寿命の目安</span></div>
    </div>${r.flags ? `<p class="note">${esc(r.flags)}</p>` : ''}`;
}

// ===== 計測(旧 選別)の結果。値は本体の状態 {"t":"s"} の mload・mnl・mw・mrank・mtotal・msaved・mup =====
// 本体の MeasUpload と同じ番号(0=まだ 1=登録 2=未設定 3=Wi-Fiなし 4=キー違い 5=失敗 6=モーターラボが古い形式)
export const UPLOAD_TEXT = ['', 'モーターラボに登録しました', 'Wi-Fi未設定のため送っていません',
  'Wi-Fiにつながりませんでした', '送信キーが受け付けられませんでした', 'モーターラボに送れませんでした',
  'モーターラボが新しい形式になっていません'];

// 送れなかったので再送できるか(本体の sel_canResend と同じ)
export const canResend = (s) => !!s?.msaved && s.mup !== 1 && s.mup !== 2;

export function measResultHtml(s) {
  if (!s) return '<p class="note">結果を受け取っています</p>';
  const rank = s.mrank > 0 ? `${s.mrank}<small> 位 / ${s.mtotal} 本</small>` : '—';
  const note = s.note ? `<p class="banner bad">${esc(s.note)}</p>` : '';
  let saved = '';
  if (s.msaved) {
    const ok = s.mup === 1;
    saved = `<p class="note ${ok ? 'up' : 'warn'}">${esc(UPLOAD_TEXT[s.mup] || '')}</p>`;
  } else if (s.mup > 0) {
    saved = `<p class="note warn">保存できませんでした(${esc(UPLOAD_TEXT[s.mup] || '')})</p>`;
  }
  return `${note}<p class="h">${s.sel_no} 番</p>
    <div class="grid">
      <div class="cell"><b>${num(s.mload)}</b><span>負荷時回転数 rpm</span></div>
      <div class="cell"><b>${num(s.mnl)}</b><span>無負荷回転数 rpm</span></div>
      <div class="cell"><b>${num(s.mw, 2)}</b><span>消費電力 W</span></div>
      <div class="cell"><b>${rank}</b><span>SD の記録の中で(負荷時)</span></div>
    </div>${saved}`;
}
