// 사용법: node xlsx_cli.js <설정.json>
// 설정: {csv, scales:[{name, items, rev, min, max, method}], vars, scaleVars, model:{x, mediators, y, boot, seed}}
// 척도 점수를 만들고 기초통계·매개분석을 실행해 JSON으로 출력 (엑셀 참고 파일과 대조하는 검증에 사용)
const fs = require('fs'); const E = require(__dirname + '/../engine.js');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const [h, ...ls] = fs.readFileSync(cfg.csv, 'utf8').trim().split(/\r?\n/); const H = h.split(',');
const rows = ls.map(l => { const v = l.split(','); const o = {}; H.forEach((k, i) => (o[k] = v[i] == null ? '' : v[i])); return o; });
const scores = {}, alphaAll = {};
cfg.scales.forEach(d => {
  const sc = E.scoreScale(rows, Object.assign({ reverse: d.rev }, d), []);
  rows.forEach((r, i) => (r[d.name] = String(sc.scores[i])));
  scores[d.name] = sc.scores; alphaAll[d.name] = sc.alpha;
});
const basic = E.basic(rows, { vars: cfg.vars, types: {}, missingCodes: [], scales: cfg.scales, scaleVars: cfg.scaleVars });
const res = E.mediation(rows, Object.assign({ covariates: [] }, cfg.model));
process.stdout.write(JSON.stringify({ scores, alphaAll, basic, res }));
