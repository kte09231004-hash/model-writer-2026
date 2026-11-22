// 사용법: node basic_cli.js <csv> '<json: {def, spec}>'  → 척도 점수 계산 후 기초통계(basic) 결과 JSON
const fs = require('fs'); const E = require(__dirname + '/../engine.js');
const [,, file, cfg] = process.argv; const { def, spec } = JSON.parse(cfg);
const [h, ...ls] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/); const H = h.split(',');
const rows = ls.map(l => { const v = l.split(','); const o = {}; H.forEach((k, i) => (o[k] = v[i] == null ? '' : v[i])); return o; });
if (def) { const sc = E.scoreScale(rows, Object.assign({ reverse: def.rev }, def), spec.missingCodes); rows.forEach((r, i) => (r[def.name] = String(sc.scores[i]))); }
process.stdout.write(JSON.stringify({ basic: E.basic(rows, spec), scores: rows.map(r => def ? r[def.name] : null) }));
