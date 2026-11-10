// 사용법: node jn_cli.js <csv> '<spec json>'  → 조절분석 결과 JSON 출력
const fs = require('fs'); const E = require(__dirname + '/../engine.js');
const [,, file, specJson] = process.argv;
const [h, ...ls] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/); const H = h.split(',');
const rows = ls.map(l => { const v = l.split(','); const o = {}; H.forEach((k, i) => (o[k] = v[i])); return o; });
process.stdout.write(JSON.stringify(E.moderation(rows, JSON.parse(specJson))));
