// 充電の終わりの見分け(notify.js)のテスト。node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChargeWatch, chargeEvent } from '../notify.js';
import { PHASE } from '../proto.js';

const run = (o = {}) => ({ phase: PHASE.BAT_RUN, preset: 3.0, mah: 44, elapsed_s: 269, bdone: 0, ...o });

test('指定電圧: 充電中に bdone が 1 になった最初の 1回だけ「取り外しOK」', () => {
  const w = createChargeWatch();
  assert.equal(chargeEvent(w, { phase: PHASE.BAT_READY }), null);
  assert.equal(chargeEvent(w, { phase: PHASE.BAT_COUNTDOWN }), null);
  assert.equal(chargeEvent(w, run()), null);
  assert.equal(chargeEvent(w, run()), null);
  const ev = chargeEvent(w, run({ bdone: 1 }));
  assert.equal(ev.kind, 'done');
  assert.equal(ev.title, '取り外しOK');
  assert.match(ev.body, /3\.00 V/);
  assert.match(ev.body, /44 mAh/);
  assert.match(ev.body, /4分29秒/);
  // 見守りで確認に戻って、また完了待ちになっても 2回目は鳴らさない
  assert.equal(chargeEvent(w, run({ bdone: 0 })), null);
  assert.equal(chargeEvent(w, run({ bdone: 1 })), null);
  // 外して結果へ: 取り外しOK を知らせたあとなので鳴らさない
  assert.equal(chargeEvent(w, { phase: PHASE.BAT_RESULT, mah: 44 }), null);
  // 次の電池では、また知らせる
  assert.equal(chargeEvent(w, { phase: PHASE.BAT_READY }), null);
  assert.equal(chargeEvent(w, run()), null);
  assert.equal(chargeEvent(w, run({ bdone: 1 })).kind, 'done');
});

test('満充電: 充電中から結果へで「満充電 完了」', () => {
  const w = createChargeWatch();
  chargeEvent(w, { phase: PHASE.BAT_READY });
  chargeEvent(w, run({ full: 1, mah: 95, elapsed_s: 172 }));
  const ev = chargeEvent(w, { phase: PHASE.BAT_RESULT, full: 1, mah: 95, elapsed_s: 172 });
  assert.equal(ev.kind, 'full');
  assert.equal(ev.title, '満充電 完了');
  assert.match(ev.body, /満充電/);
  assert.match(ev.body, /95 mAh/);
  // 1本は番号も出す
  const w2 = createChargeWatch();
  chargeEvent(w2, { phase: PHASE.BAT_CELLNO });
  chargeEvent(w2, run({ cell: 1, cell_no: 7 }));
  assert.match(chargeEvent(w2, { phase: PHASE.BAT_RESULT, cell: 1, cell_no: 7, mah: 58 }).body, /No\.7/);
});

test('充電中からエラーへで「充電が止まりました」(理由つき)', () => {
  const w = createChargeWatch();
  chargeEvent(w, { phase: PHASE.BAT_READY });
  chargeEvent(w, run());
  const ev = chargeEvent(w, { phase: PHASE.BAT_ERROR, error: 'OVER TEMP' });
  assert.equal(ev.kind, 'error');
  assert.equal(ev.body, 'OVER TEMP');
});

test('つないだ直後にもう終わっていたら知らせない', () => {
  for (const s of [run({ bdone: 1 }), { phase: PHASE.BAT_RESULT }, { phase: PHASE.BAT_ERROR }]) {
    const w = createChargeWatch();
    assert.equal(chargeEvent(w, s), null);
    assert.equal(chargeEvent(w, s), null);
  }
  // 途中からつないだ充電中の回も、その回は知らせない(待機に戻れば次の回からは知らせる)
  const w = createChargeWatch();
  chargeEvent(w, run());
  assert.equal(chargeEvent(w, run({ bdone: 1 })), null);
});

test('切れている間に終わった回は、つなぎ直して結果を受け取ったときに知らせる', () => {
  const w = createChargeWatch();
  chargeEvent(w, { phase: PHASE.BAT_READY });
  chargeEvent(w, run({ full: 1 }));
  // ここで切れて、つなぎ直したら結果になっていた(見張りはそのまま)
  assert.equal(chargeEvent(w, { phase: PHASE.BAT_RESULT, full: 1, mah: 120 }).kind, 'full');
});

test('状態がないときやモーターの画面では何もしない', () => {
  const w = createChargeWatch();
  assert.equal(chargeEvent(w, null), null);
  assert.equal(chargeEvent(w, { phase: PHASE.MOT_RUN }), null);
  assert.equal(chargeEvent(w, { phase: PHASE.SEL_RESULT }), null);
});
