import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batLabRec, batLabBodies, batLabToast, BATLAB_POST_MAX } from '../batlab.js';

const row = (o = {}) => ({ k: 3, dt: '2026-11-28 10:20:30', no: 1, ir: 117.6, why: 'PEAK', mah: 54, tc: 29.9, ir25: 120.1, ...o });

test('batLabRec: 受け口に送る値だけにする(ir25・k は送らない)', () => {
  assert.deepEqual(batLabRec(row()), { no: 1, dt: '2026-11-28 10:20:30', mah: 54, ir: 117.6, tc: 29.9, why: 'PEAK' });
});

test('batLabRec: 測れなかった内部抵抗・温度なしは付けない', () => {
  assert.deepEqual(batLabRec(row({ ir: null, tc: undefined })), { no: 1, dt: '2026-11-28 10:20:30', mah: 54, why: 'PEAK' });
});

test('batLabRec: 日時の無い行・番号の無い行は送らない', () => {
  assert.equal(batLabRec(row({ dt: '----' })), null);
  assert.equal(batLabRec(row({ dt: '' })), null);
  assert.equal(batLabRec(row({ no: undefined })), null);
  assert.equal(batLabRec(null), null);
});

test('batLabBodies: 上限ごとに分ける。送るものが無ければ空', () => {
  assert.deepEqual(batLabBodies('K', []), []);
  assert.deepEqual(batLabBodies('K', [row({ dt: '----' })]), []);
  const many = Array.from({ length: BATLAB_POST_MAX + 1 }, (_, i) => row({ k: i }));
  const b = batLabBodies('K', many);
  assert.equal(b.length, 2);
  assert.equal(b[0].recs.length, BATLAB_POST_MAX);
  assert.equal(b[1].recs.length, 1);
  assert.equal(b[0].key, 'K');
});

test('batLabToast: 増えた・付け替えたときだけ出す', () => {
  assert.equal(batLabToast(0, 0), '');
  assert.equal(batLabToast(3, 0), 'バッテリーラボに 3 件送りました');
  assert.equal(batLabToast(0, 2), 'バッテリーラボの番号を 2 件付け替えました');
  assert.equal(batLabToast(1, 1), 'バッテリーラボに 1 件送りました(番号の付け替え 1 件)');
});
