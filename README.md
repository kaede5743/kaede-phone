# kaede-phone

KaedeSystem(M5Stack Core2)を Android の Chrome から Bluetooth で操作するページです。

- 開く: https://kaede5743.github.io/kaede-phone/
- 見本(本体なし): https://kaede5743.github.io/kaede-phone/?demo=1

本体のソースは別のリポジトリ(KaedeSystem)にあります。**ページはこのリポジトリだけ**で直します(本体のリポジトリにはもう置いていません)。

## 直すとき

- ページを直したら `sw.js` の `CACHE` の番号を上げる(古いページが残らないように)
- テスト: `npm test`(Node.js 20 以上。`test/*.test.mjs` を全部流す)
- 本体との取り決め(状態の名前・命令)は、本体の `phone_proto.h` と `proto.js` の両方を直す
