// 엔진을 여러 시나리오로 실행하고 결과를 JSON으로 저장
const fs = require('fs'); const E = require('/home/user/app/engine.js');
function readCSV(p){ const [h,...ls]=fs.readFileSync(p,'utf8').trim().split(/\r?\n/); const H=h.split(',');
  return ls.map(l=>{const v=l.split(',');const o={};H.forEach((k,i)=>o[k]=v[i]);return o;}); }
const rows = readCSV('/home/user/app/sample/sample_scores.csv');
const out = {
  simple: E.mediation(rows,{x:'alex',mediators:['avoid'],y:'distress',covariates:['age','gender'],boot:2000,seed:42}),
  serial: E.mediation(rows,{x:'alex',mediators:['avoid','dysreg'],y:'distress',covariates:[],boot:2000,seed:7}),
  serial3: E.mediation(rows,{x:'alex',mediators:['avoid','dysreg','support'],y:'distress',boot:500,seed:3}),
  mod: E.moderation(rows,{x:'alex',w:'support',y:'distress',covariates:['age']}),
  modc: E.moderation(rows,{x:'alex',w:'support',y:'distress',center:'mean',probe:'meansd'}),
  modbin: E.moderation(rows,{x:'alex',w:'gender',y:'distress'}),
};
const t0=Date.now(); E.mediation(rows,{x:'alex',mediators:['avoid','dysreg'],y:'distress',covariates:['age','gender'],boot:5000,seed:1});
out.timing5000ms = Date.now()-t0;
fs.writeFileSync('/home/user/verify/engine_out.json', JSON.stringify(out));
console.log('ok, 5000회 순차매개 소요(ms):', out.timing5000ms);
