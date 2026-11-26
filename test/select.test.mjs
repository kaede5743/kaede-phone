// phone/select.js(選別の一覧・結果・詳細の HTML)のテスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { unitListHtml, unitDetailHtml, unitResultHtml } from '../select.js';

const rows = [
  { no: 7, bi: 1, nref: 36110, nl: 37200, prev: '前回なし', pt: 0, life: '寿命 80%', lt: 1, date: '11/08' },
  { no: 13, bi: 0, nref: 35420, nl: 36980, prev: '前回 11/02 より +1.8%', pt: 1, life: '寿命 60%', lt: 1, date: '11/09' },
];

test('一覧は届いた順(本体が速い順に送る)で、印と番号を持つ', () => {
  const h = unitListHtml(rows, 13);
  assert.ok(h.indexOf('data-unit="7"') < h.indexOf('data-unit="13"'));
  assert.match(h, /data-unit="13"[^>]*class="[^"]*mark/);
  assert.match(unitListHtml([], null), /まだ測った個体がありません/);
});

test('文字は逃がす', () => {
  const h = unitDetailHtml({ ...rows[0], prev: '<b>"x"</b>' });
  assert.ok(!h.includes('<b>"x"</b>') && h.includes('&lt;b&gt;'));
});

test('結果: 行がまだ無いときと、保存できなかったとき', () => {
  assert.match(unitResultHtml(null, ''), /結果を受け取っています/);
  const h = unitResultHtml(rows[1], 'SDがないため保存しません');
  assert.match(h, /35,420/);
  assert.match(h, /SDがないため保存しません/);
});
