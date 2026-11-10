// 조절모형 서술·표 출력 확인 (예시 데이터, 원점수/중심화, 신뢰수준별)
const fs = require('fs'); const E = require('../engine.js'), R = require('../report.js');
function readCSV(p){const [h,...ls]=fs.readFileSync(p,'utf8').trim().split(/\r?\n/);const H=h.split(',');return ls.map(l=>{const v=l.split(',');const o={};H.forEach((k,i)=>o[k]=v[i]);return o;});}
const rows = readCSV(__dirname + '/../sample/sample_scores.csv');
const L = { alex: '감정표현불능증', distress: '심리적 고통', support: '사회적 지지' }, o = { labels: L, dec: 2, decInd: 3, toolName: '웹 도구' };
for (const [center, conf] of [['none', .95], ['mean', .95], ['none', .99]]) {
  const r = E.moderation(rows, { x: 'alex', w: 'support', y: 'distress', center, conf });
  console.log(`\n=== center=${center} conf=${conf} status=${r.jn.status}`);
  console.log('[방법]', R.methodText(r, o).split('. ').slice(-2).join('. '));
  R.resultText(r, o).forEach(p => console.log('[서술]', p));
  console.log(R.tableToTSV(R.tables(r, o)[2]));
}
