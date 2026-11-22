// 사용법: node model_cli.js <csv> '<{"model":"mediation"|"moderation", ...spec}>'
const fs = require('fs'); const E = require(__dirname + '/../engine.js');
const [,, file, cfg] = process.argv; const spec = JSON.parse(cfg);
const [h, ...ls] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/); const H = h.split(',');
const rows = ls.map(l => { const v = l.split(','); const o = {}; H.forEach((k, i) => (o[k] = v[i] == null ? '' : v[i])); return o; });
process.stdout.write(JSON.stringify(spec.model === 'moderation' ? E.moderation(rows, spec) : E.mediation(rows, spec)));
