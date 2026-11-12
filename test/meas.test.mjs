// 計測(負荷L・H の2点)の結果・詳細・モーターラボへの本文のテスト。node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { measResultHtml, measDetailHtml, measLabBody, measWarnText } from '../select.js';
import { createStore } from '../proto.js';

const s = { sel_no: 12, mload: 15820, ml: 16340, mh: 15300, mrank: 3, mtotal: 18, msaved: 0, mup: 0,
  mkey: 'single__ハイパーダッシュ', mdate: '2026-11-12', owner: 'かえで' };
const d = { t: 'md', no: 12, l23: [13420, 1.85, 2.30], l: [16340, 2.30, 2.56], h: [15300, 2.95, 2.49], nl: [41200, 0.42, 3.00],
  lcv: 0.008, hcv: 0.011, wf: 0 };

test('結果: 負荷時回転数(平均)・負荷L・負荷H・落ち率・順位', () => {
  const h = measResultHtml(s);
  assert.match(h, /15,820/);
  assert.match(h, /16,340/);
  assert.match(h, /15,300/);
  assert.match(h, /94%/);
  assert.match(h, /3<small> 位 \/ 18 本/);
  assert.doesNotMatch(h, /無負荷回転数|消費電力/);
  // 片方が無ければ落ち率は —
  assert.doesNotMatch(measResultHtml({ ...s, mh: null }), /\d+%/);
});

test('詳細: 段ごとの値・伸び・電力・安定性・「？」', () => {
  const h = measDetailHtml(d);
  assert.match(h, /L 2\.3V/);
  assert.match(h, /2\.56V/);
  assert.match(h, /41,200/);
  assert.match(h, /11,231 rpm\/V/);   // (16340-13420)/(2.56-2.30)
  assert.match(h, /5\.89W/);          // 2.56 × 2.30
  assert.match(h, /7\.35W/);          // 2.49 × 2.95
  assert.match(h, /〇/);
  assert.match(h, /？ なし/);
  assert.match(measDetailHtml({ ...d, wf: 7 }), /？ H未切替かも・Lばらつき×・Hばらつき×/);
  assert.match(measDetailHtml(null), /詳細を受け取っています/);
});

test('「？」の理由は本体と同じ言葉', () => {
  assert.equal(measWarnText(0), '？ なし');
  assert.equal(measWarnText(1), '？ 負荷Hになっていないかも');
  assert.equal(measWarnText(6), '？ Lばらつき×・Hばらつき×');
});

test('モーターラボへの本文: ver 2、平均と段ごとの値。詳細が無い・番号違いなら作らない', () => {
  assert.deepEqual(measLabBody(s, d, 'KEY'), {
    key: 'KEY', motor: 'single__ハイパーダッシュ', no: '012', ver: 2,
    rpm: 15820, rpmL: 16340, rpmH: 15300,
    rpmL23: 13420, iL23: 1.85, vL23: 2.30, iL: 2.30, vL: 2.56, iH: 2.95, vH: 2.49,
    rpmNl: 41200, iNl: 0.42, vNl: 3.00, cvL: 0.008, cvH: 0.011,
    date: '2026-11-12', owner: 'かえで',
  });
  assert.equal(measLabBody(s, null, 'KEY'), null);
  assert.equal(measLabBody(s, { ...d, no: 13 }, 'KEY'), null);
  // 測れていない値(null)は 0
  const b = measLabBody(s, { ...d, nl: [null, null, null], lcv: null }, 'KEY');
  assert.equal(b.rpmNl, 0);
  assert.equal(b.cvL, 0);
});

test('{"t":"md"} を受け取って持つ。番号が数でなければ捨てる', () => {
  const st = createStore();
  assert.equal(st.apply(JSON.stringify(d)), true);
  assert.equal(st.state.measDetail.no, 12);
  assert.equal(st.apply(JSON.stringify({ t: 'md', no: 'x' })), false);
  assert.equal(st.state.measDetail.no, 12);
});
