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

// ===== 計測(旧 選別)の結果。値は本体の状態 {"t":"s"} の mload(負荷L と負荷H の平均)・ml・mh・mrank・mtotal・
// msaved・mup と、詳細の知らせ {"t":"md"}(段ごとの [回転数, 電流, 電圧])=====
// 本体の MeasUpload と同じ番号(0=まだ 1=登録 2=スマホなし 3=送信中 4=キー違い 5=失敗 6=モーターラボが古い形式
// 7=スマホに送信キーなし)。送るのはこのページ(本体は Wi-Fi を使わない)
export const UPLOAD_TEXT = ['', 'モーターラボに登録しました', 'スマホがつながっていませんでした',
  'モーターラボに送っています…', '送信キーが受け付けられませんでした', 'モーターラボに送れませんでした',
  'モーターラボが新しい形式になっていません', 'このスマホに送信キーが入っていません'];

// 送れなかったので再送できるか(本体の sel_canResend と同じ)
export const canResend = (s) => !!s?.msaved && s.mup !== 1 && s.mup !== 3;

export function measResultHtml(s) {
  if (!s) return '<p class="note">結果を受け取っています</p>';
  const rank = s.mrank > 0 ? `${s.mrank}<small> 位 / ${s.mtotal} 本</small>` : '—';
  const note = s.note ? `<p class="banner bad">${esc(s.note)}</p>` : '';
  let saved = '';
  if (s.msaved) {
    const cls = s.mup === 1 ? 'up' : s.mup === 3 ? '' : 'warn';
    saved = `<p class="note ${cls}">${esc(UPLOAD_TEXT[s.mup] || '')}</p>`;
  }
  const drop = pos(s.ml) && pos(s.mh) ? `${Math.round((s.mh / s.ml) * 100)}%` : '—';
  return `${note}<p class="h">${s.sel_no} 番</p>
    <div class="grid">
      <div class="cell"><b>${num(s.mload)}</b><span>負荷時回転数 rpm(L と H の平均)</span></div>
      <div class="cell"><b>${rank}</b><span>SD の記録の中で(負荷時)</span></div>
      <div class="cell"><b>${num(s.ml)}</b><span>負荷L rpm</span></div>
      <div class="cell"><b>${num(s.mh)}</b><span>負荷H rpm</span></div>
      <div class="cell"><b>${drop}</b><span>落ち率(H ÷ L)</span></div>
    </div>${saved}`;
}

const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const at = (a, k) => (Array.isArray(a) && pos(a[k]) ? a[k] : 0);

// 「？」の理由(本体の measWarnText と同じ言葉)。wf: 1 = 負荷H になっていないかも 2 = L のばらつき× 4 = H のばらつき×
export function measWarnText(wf) {
  if (!wf) return '？ なし';
  if (wf === 1) return '？ 負荷Hになっていないかも';
  return '？ ' + [wf & 1 && 'H未切替かも', wf & 2 && 'Lばらつき×', wf & 4 && 'Hばらつき×'].filter(Boolean).join('・');
}

// 安定性(本体の measGrade と同じ境目: 〇 1% 未満・△ 3% 未満・×)
const grade = (cv) => (!pos(cv) ? '' : cv < 0.01 ? '<span class="up">〇</span>' : cv < 0.03 ? '△' : '<span class="warn">×</span>');

// 詳細: 段ごとの電圧・電流・回転数、伸び(rpm/V)・落ち率、消費電力、「？」の理由
export function measDetailHtml(d) {
  if (!d) return '<p class="note">詳細を受け取っています</p>';
  const rows = [['L 2.3V', d.l23, null], ['L 2.8V', d.l, d.lcv], ['H 2.8V', d.h, d.hcv], ['無負荷', d.nl, null]];
  const v = (x, unit) => (x > 0 ? `${x.toFixed(2)}${unit}` : '—');
  const tr = rows.map(([name, p, cv]) => `<div class="row"><span>${name}</span>
      <span>${v(at(p, 2), 'V')} ${v(at(p, 1), 'A')} <b>${num(at(p, 0) || null)}</b> ${grade(cv)}</span></div>`).join('');
  const dv = at(d.l, 2) - at(d.l23, 2);
  const gain = at(d.l23, 0) && at(d.l, 0) && dv >= 0.1 ? (at(d.l, 0) - at(d.l23, 0)) / dv : 0;
  const drop = at(d.l, 0) && at(d.h, 0) ? `${Math.round((at(d.h, 0) / at(d.l, 0)) * 100)}%` : '—';
  const w = (p) => (at(p, 1) && at(p, 2) ? `${(at(p, 1) * at(p, 2)).toFixed(2)}W` : '—');
  return `<p class="h">詳細</p>${tr}
    <div class="grid">
      <div class="cell"><b>${gain > 0 ? `${num(gain)} rpm/V` : '—'}</b><span>伸び(L 2.3V → 2.8V)</span></div>
      <div class="cell"><b>${drop}</b><span>落ち率(H ÷ L)</span></div>
      <div class="cell"><b>${w(d.l)}</b><span>消費電力 L</span></div>
      <div class="cell"><b>${w(d.h)}</b><span>消費電力 H</span></div>
    </div>
    <p class="note${d.wf ? ' warn' : ''}">${esc(measWarnText(d.wf))}</p>`;
}

// モーターラボへの本文(ver 2)。詳細がまだ無い・別の番号のものなら null(本体に sel.detail で頼む)
export function measLabBody(s, d, key) {
  if (!s || !d || d.no !== s.sel_no) return null;
  const n = (v) => (pos(v) ? v : 0);
  return {
    key, motor: s.mkey, no: String(s.sel_no).padStart(3, '0'), ver: 2,
    rpm: n(s.mload), rpmL: at(d.l, 0), rpmH: at(d.h, 0),
    rpmL23: at(d.l23, 0), iL23: at(d.l23, 1), vL23: at(d.l23, 2), iL: at(d.l, 1), vL: at(d.l, 2), iH: at(d.h, 1), vH: at(d.h, 2),
    rpmNl: at(d.nl, 0), iNl: at(d.nl, 1), vNl: at(d.nl, 2), cvL: n(d.lcv), cvH: n(d.hcv),
    date: s.mdate || '', owner: s.owner || '',
  };
}
