// ===== 電池ラボへの送信(満充電(1本)の記録。本体から bat.cells → bat.cellrecs N で集めて、まとめて送る) =====
// 受け口 race_manager addBatteryLabRecords。送信キーはモーターラボと同じもの
export const BATLAB_URL = 'https://asia-northeast1-kaede-race-maneger.cloudfunctions.net/addBatteryLabRecords';
export const BATLAB_POST_MAX = 200;   // 受け口が 1 回に受け取る数

const DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// 本体の記録の 1行({"t":"ce"} の中身)を受け口に送る形にする。日時の無い行(時計を合わせる前)は送らない
export function batLabRec(r) {
  if (!r || !Number.isInteger(r.no) || typeof r.dt !== 'string') return null;
  const dt = r.dt.slice(0, 19);
  if (!DT_RE.test(dt)) return null;
  const out = { no: r.no, dt, mah: Number.isInteger(r.mah) ? r.mah : Math.round(Number(r.mah) || 0) };
  if (typeof r.ir === 'number' && Number.isFinite(r.ir) && r.ir > 0) out.ir = r.ir;
  if (typeof r.tc === 'number' && Number.isFinite(r.tc)) out.tc = r.tc;
  if (typeof r.why === 'string') out.why = r.why;
  return out;
}

// 集めた行から本文を作る(受け口の上限ごとに分ける)。送るものが無ければ []
export function batLabBodies(key, rows) {
  const recs = (Array.isArray(rows) ? rows : []).map(batLabRec).filter(Boolean);
  const out = [];
  for (let i = 0; i < recs.length; i += BATLAB_POST_MAX) out.push({ key, recs: recs.slice(i, i + BATLAB_POST_MAX) });
  return out;
}

// 送ったあとのトースト。増えも番号の付け替えも無ければ出さない
export function batLabToast(added, moved) {
  if (added > 0 && moved > 0) return `電池ラボに ${added} 件送りました(番号の付け替え ${moved} 件)`;
  if (added > 0) return `電池ラボに ${added} 件送りました`;
  if (moved > 0) return `電池ラボの番号を ${moved} 件付け替えました`;
  return '';
}
