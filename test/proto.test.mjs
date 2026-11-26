// phone/proto.js のテスト: node --test phone/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { LineBuffer, createStore, screenFor, buildCommand, REJECT_TEXT, PHASE, GEARS_X10, speedKmh } from '../proto.js';

test('分割された行を戻す', () => {
  const b = new LineBuffer();
  assert.deepEqual(b.push('{"t":"s"'), []);
  assert.deepEqual(b.push(',"rpm":1}\n{"t"'), ['{"t":"s","rpm":1}']);
  assert.deepEqual(b.push(':"r"}\n\n'), ['{"t":"r"}']);   // 空の行は捨てる
});

test('改行が来ないまま長くなったら捨てる', () => {
  const b = new LineBuffer(16);
  assert.deepEqual(b.push('x'.repeat(40)), []);
  assert.deepEqual(b.push('yy\nok\n'), ['ok']);   // 捨てた行の続きも次の改行まで捨てる
});

test('壊れた行では状態を変えない', () => {
  const s = createStore();
  s.apply('{"t":"s","phase":10,"rpm":5}');
  s.apply('{"t":"s","ph');
  s.apply('[1,2]');
  s.apply('null');
  assert.equal(s.state.status.rpm, 5);
});

test('切れたら値は残して stale にする。つながって状態が届いたら消す', () => {
  const s = createStore();
  s.markConnected();
  s.apply('{"t":"s","phase":10,"rpm":5}');
  assert.equal(s.state.stale, false);
  s.markDisconnected();
  assert.equal(s.state.connected, false);
  assert.equal(s.state.stale, true);
  assert.equal(s.state.status.rpm, 5);
  s.markConnected();
  assert.equal(s.state.stale, true);
  s.apply('{"t":"s","phase":10,"rpm":6}');
  assert.equal(s.state.stale, false);
});

test('履歴は from の位置に入れる(つなぎ直しで重ならず欠けない)', () => {
  const s = createStore();
  s.apply('{"t":"h","course":5,"from":0,"rpm":[1,2],"i":[0.1,0.2]}');
  s.apply('{"t":"h","course":5,"from":1,"rpm":[9,3],"i":[0.9,0.3]}');
  assert.deepEqual(s.state.history.rpm, [1, 9, 3]);
  assert.deepEqual(s.state.history.i, [0.1, 0.9, 0.3]);
});

test('別のコースの履歴が来たら入れ替える', () => {
  const s = createStore();
  s.apply('{"t":"h","course":5,"from":0,"rpm":[1,2,3],"i":[1,1,1]}');
  s.apply('{"t":"h","course":6,"from":0,"rpm":[7],"i":[0.5]}');
  assert.deepEqual(s.state.history.rpm, [7]);
  assert.equal(s.state.history.course, 6);
});

test('飛んだ位置の履歴は入れない(欠けを作らない)', () => {
  const s = createStore();
  s.apply('{"t":"h","course":5,"from":0,"rpm":[1],"i":[1]}');
  s.apply('{"t":"h","course":5,"from":3,"rpm":[4],"i":[4]}');
  assert.deepEqual(s.state.history.rpm, [1]);
});

test('版が違えば versionOk が false', () => {
  const s = createStore();
  assert.equal(s.state.versionOk, true);
  s.apply('{"t":"hello","v":99}');
  assert.equal(s.state.versionOk, false);
  s.apply('{"t":"hello","v":1}');
  assert.equal(s.state.versionOk, true);
});

test('設定を受け取る', () => {
  const s = createStore();
  s.apply('{"t":"c","mode":0,"v10":15,"motors":["A","B"],"progs":[{"mode":2,"name":"x"}]}');
  assert.equal(s.state.config.v10, 15);
  assert.deepEqual(s.state.config.motors, ['A', 'B']);
});

test('返事は id ごとに渡す', () => {
  const s = createStore();
  const got = [];
  s.onReply = (id, res) => got.push([id, res]);
  s.apply('{"t":"r","id":12,"res":"busy"}');
  assert.deepEqual(got, [[12, 'busy']]);
});

test('画面は本体の段階に従う', () => {
  assert.equal(screenFor({ connected: false, status: null }), 'connect');
  assert.equal(screenFor({ connected: true, status: null }), 'connect');
  const at = (phase) => screenFor({ connected: true, status: { phase } });
  assert.equal(at(0), 'selector');
  assert.equal(at(1), 'batSetup');
  assert.equal(at(2), 'batSetup');
  assert.equal(at(3), 'batRun');
  assert.equal(at(4), 'batResult');
  assert.equal(at(5), 'batError');
  assert.equal(at(6), 'motMenu');
  assert.equal(at(7), 'motBusy');
  assert.equal(at(8), 'motBusy');
  assert.equal(at(9), 'prompt');
  assert.equal(at(10), 'run');
  assert.equal(at(11), 'fail');
  assert.equal(at(12), 'result');
  assert.equal(at(99), 'motBusy');   // 知らない段階は操作させない
  // 切れていても最後の状態の画面を出す(stale の印は app.js が出す)
  assert.equal(screenFor({ connected: false, status: { phase: 10 } }), 'run');
});

test('段階の番号は本体の PhPhase と同じ順番', () => {
  assert.equal(PHASE.SELECTOR, 0);
  assert.equal(PHASE.BAT_COUNTDOWN, 2);
  assert.equal(PHASE.MOT_IDLE, 6);
  assert.equal(PHASE.CRS_RESULT, 12);
  assert.equal(PHASE.MAN_IDLE, 13);
  assert.equal(PHASE.MAN_RUN, 14);
  assert.equal(PHASE.SEL_INPUT, 15);
  assert.equal(PHASE.SEL_PROMPT, 16);
  assert.equal(PHASE.SEL_RUN, 17);
  assert.equal(PHASE.SEL_FAIL, 18);
  assert.equal(PHASE.SEL_RESULT, 19);
  assert.equal(PHASE.SEL_LIST, 20);
});

test('命令の形', () => {
  assert.equal(buildCommand(12, 'bat.preset', 2), '12 bat.preset 2\n');
  assert.equal(buildCommand(3, 'stop'), '3 stop\n');
  assert.equal(buildCommand(4, 'crs.target', 0), '4 crs.target 0\n');
  assert.throws(() => buildCommand(70000, 'stop'));
  assert.throws(() => buildCommand(1, 'Bad op'));
  assert.throws(() => buildCommand(1, 'app', 1.5));
});

test('断られたときの文', () => {
  for (const k of ['bad', 'range', 'state', 'busy']) assert.equal(typeof REJECT_TEXT[k], 'string');
});

test('今の回転数(l)は状態の live だけを書き換える', () => {
  const st = createStore();
  assert.equal(st.apply('{"t":"l","live":15000}'), false);   // 状態が届く前は捨てる
  st.apply('{"t":"s","phase":10,"rpm":14000,"live":14900}');
  assert.equal(st.apply('{"t":"l","live":15010}'), true);
  assert.equal(st.state.status.live, 15010);
  assert.equal(st.state.status.rpm, 14000);
  st.apply('{"t":"l","live":null}');
  assert.equal(st.state.status.live, null);
});

test('確認の一覧(k)はそのまま入れ替える', () => {
  const st = createStore();
  assert.deepEqual(st.state.checks, { course: null, rpm: [] });
  assert.equal(st.apply('{"t":"k","course":3,"rpm":[35210,35988]}'), true);
  assert.deepEqual(st.state.checks, { course: 3, rpm: [35210, 35988] });
  st.apply('{"t":"k","course":4,"rpm":[]}');
  assert.deepEqual(st.state.checks, { course: 4, rpm: [] });
  assert.equal(st.apply('{"t":"k","course":4,"rpm":"x"}'), false);   // 形が違えば捨てる
  assert.deepEqual(st.state.checks, { course: 4, rpm: [] });
});

test('段階2 の画面', () => {
  const cases = [[13, 'manual'], [14, 'manual'], [15, 'selInput'], [16, 'selPrompt'], [17, 'selRun'],
    [18, 'selFail'], [19, 'selResult'], [20, 'selList']];
  for (const [phase, scr] of cases) assert.equal(screenFor({ status: { phase } }), scr);
});

test('個体の一覧は i=0 から作り直し、全部そろったら complete', () => {
  const st = createStore();
  st.apply('{"t":"u","i":0,"n":2,"no":7,"nref":36110}');
  assert.equal(st.state.units.complete, false);
  st.apply('{"t":"u","i":1,"n":2,"no":13,"nref":35420}');
  assert.deepEqual(st.state.units.rows.map((r) => r.no), [7, 13]);
  assert.equal(st.state.units.complete, true);
  st.apply('{"t":"u","i":3,"n":5,"no":1}');          // 飛んだ行は入れない
  assert.equal(st.state.units.rows.length, 2);
  st.apply('{"t":"u","i":0,"n":0}');                 // 0 本
  assert.deepEqual(st.state.units, { n: 0, rows: [], complete: true });
});

test('スピードマネージャーの画面と速度の計算(speed_math.h の spSpeedKmh と同じ)', () => {
  const s = createStore();
  s.apply('{"t":"hello","v":1}');
  s.apply(JSON.stringify({ t: 's', phase: PHASE.SPD }));
  assert.equal(screenFor(s.state), 'speed');
  s.apply(JSON.stringify({ t: 's', phase: PHASE.SPD_BUSY }));
  assert.equal(screenFor(s.state), 'speedBusy');
  assert.deepEqual(GEARS_X10, [35, 37, 40, 42, 50]);
  // 36000 rpm ÷ 3.5 × 23.5mm × π × 60 ÷ 1,000,000 = 45.56 km/h
  assert.ok(Math.abs(speedKmh(36000, 35, 235) - 45.5619) < 0.001);
  assert.equal(speedKmh(null, 35, 235), null);
  assert.equal(speedKmh(0, 35, 235), null);
  assert.equal(speedKmh(36000, 0, 235), null);
});
