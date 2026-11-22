// 변수 정리(문항 묶음·척도 만들기·값의 뜻·연구대상 특성)와 통합 보고서 점검
// 참고 논문과 같은 구조의 가상 자료(321명, 문항 응답 + 성별·연령·학력) 사용
const legacy = require('./boot.js');
const { chromium } = require('playwright'); const fs = require('fs');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html');
let pass = 0; const fails = []; const ok = (c, w) => { if (c) pass++; else fails.push(w); };
let seed = 321; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const norm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const items = (n, pre) => Array.from({ length: n }, (_, i) => pre + (i + 1));
const DIF = items(7, 'dif'), DDF = items(5, 'ddf'), AAQ = items(10, 'aaq'), DERS = items(8, 'ders'), DASS = items(21, 'dass');
const cols = ['id', 'gender', 'age', 'edu'].concat(DIF, DDF, AAQ, DERS, DASS);
const data = [];
for (let i = 1; i <= 321; i++) {
  const x = norm(), m1 = 0.68 * x + 0.73 * norm(), m2 = 0.36 * x + 0.58 * m1 + 0.5 * norm(), y = 0.14 * x + 0.35 * m1 + 0.39 * m2 + 0.57 * norm();
  const row = [i, rnd() < 0.37 ? 1 : 2, 19 + Math.floor(rnd() * 11), 1 + Math.floor(rnd() * 4)];
  DIF.forEach(() => row.push(clip(3 + 0.9 * x + 0.8 * norm(), 1, 5)));
  DDF.forEach((_, j) => { const v = 3 + 0.8 * x + 0.9 * norm(); row.push(clip(j === 3 ? 6 - v : v, 1, 5)); });
  AAQ.forEach(() => row.push(clip(4 + 1.2 * m1 + 1.1 * norm(), 1, 7)));
  DERS.forEach((_, j) => { const v = 3 + 0.9 * m2 + 0.8 * norm(); row.push(clip(j === 1 || j === 5 ? 6 - v : v, 1, 5)); });
  DASS.forEach(() => row.push(clip(1.2 + 0.7 * y + 0.7 * norm(), 0, 3)));
  data.push(row);
}
const CSV = '/tmp/ux_shape.csv'; fs.writeFileSync(CSV, [cols.join(',')].concat(data.map(r => r.join(','))).join('\n'));
// 기준값(이 스크립트에서 따로 계산): 성별 빈도, 연령 평균
const nMale = data.filter(r => r[1] === 1).length, ages = data.map(r => r[2]), ageMean = ages.reduce((a, b) => a + b, 0) / ages.length;
const ageSD = Math.sqrt(ages.reduce((a, b) => a + (b - ageMean) ** 2, 0) / (ages.length - 1));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(800); await legacy(p);
  await p.setInputFiles('#file', CSV); await p.waitForTimeout(500);
  const st = () => p.$eval('#results', e => e.dataset.status);
  const run = async () => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running'); await p.waitForTimeout(150); return st(); };
  const table = re => p.evaluate(src => {
    const w = Array.from(document.querySelectorAll('#results > .rcard .tablewrap, #diagBox .tablewrap')).find(x => new RegExp(src).test(x.querySelector('caption').innerText));
    if (!w) return null;
    return { no: w.querySelector('caption b').innerText, rows: Array.from(w.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.innerText)), note: Array.from(w.parentElement.querySelectorAll('.tnote')).map(n => n.innerText).join(' ') };
  }, re);
  const dl = async sel => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); return fs.readFileSync(await d.path(), 'utf8'); };

  // ===== 변수 정리: 자동 묶기 =====
  const vl = await p.$eval('#varList', e => e.innerText);
  ok(/dif1 ~ dif7/.test(vl) && /ddf1 ~ ddf5/.test(vl) && /aaq1 ~ aaq10/.test(vl) && /ders1 ~ ders8/.test(vl) && /dass1 ~ dass21/.test(vl), '문항 묶음 5개 자동 인식');
  ok(/변수 4개 · 문항 묶음 5개/.test(await p.$eval('#varSum', e => e.textContent)), '요약: ' + await p.$eval('#varSum', e => e.textContent));
  const plain = await p.$$eval('#varList [data-vtype]', els => els.map(e => e.dataset.vtype + ':' + e.value));
  ok(plain.join() === 'id:id,gender:binary,age:continuous,edu:categorical', '일반 변수 4개와 유형: ' + plain.join());
  ok(!(await p.$$eval('#vX option', os => os.map(o => o.value))).includes('dif1'), '문항은 역할 목록에 나오지 않음');
  const demoDefault = await p.$$eval('#varList [data-demo]', els => els.map(e => e.dataset.demo + ':' + e.checked));
  ok(demoDefault.join() === 'gender:true,age:true,edu:true', '연구대상 특성 기본 선택: ' + demoDefault.join());

  // ===== 척도 만들기: 한 번 눌러 채우기 =====
  await p.click('[data-mkscale="dif"]');
  const pre = await p.evaluate(() => { const f = document.querySelector('.gform'); return f ? { g: f.dataset.gform, chips: f.querySelectorAll('[data-grev] input').length, min: f.querySelector('[data-gmin]').value, max: f.querySelector('[data-gmax]').value, hint: f.querySelector('.hint').innerText, below: Math.round(f.getBoundingClientRect().top - document.querySelector('[data-mkscale="dif"]').getBoundingClientRect().bottom) } : null; });
  ok(pre && pre.g === 'dif' && pre.chips === 7 && pre.min === '1' && pre.max === '5' && /관찰된 범위\(1~5\)/.test(pre.hint) && pre.below >= 0 && pre.below < 40, '척도 만들기: 묶음 바로 아래에 입력 칸이 열리고 응답 범위를 채움 ' + JSON.stringify(pre).slice(0, 160));
  await p.click('[data-gclose]');
  // 여러 묶음을 합치거나 하위요인을 만들 때는 아래 '문항을 직접 골라 만들기'를 씀
  const ITEMS = { dif: DIF, ddf: DDF, aaq: AAQ, ders: DERS, dass: DASS };
  async function make(prefixes, name, label, rev, min, max, method) {
    if (!(await p.$eval('#scoring', e => e.open))) await p.click('#scoring summary');
    for (const pf of prefixes) for (const it of ITEMS[pf]) await p.check(`#scItems input[value="${it}"]`);
    await p.fill('#scName', name); await p.fill('#scLabel', label);
    for (const it of rev) await p.check(`#scRev input[value="${it}"]`);
    await p.fill('#scMin', String(min)); await p.fill('#scMax', String(max)); await p.selectOption('#scMethod', method);
    await p.click('#scAdd'); await p.waitForTimeout(200);
  }
  await make(['dif', 'ddf'], 'alex', '감정표현불능증', ['ddf4'], 1, 5, 'sum');
  await make(['aaq'], 'avoid', '경험회피', [], 1, 7, 'sum');
  await make(['ders'], 'dysreg', '정서조절곤란', ['ders2', 'ders6'], 1, 5, 'sum');
  await make(['dass'], 'distress', '심리적 고통', [], 0, 3, 'sum');
  await make(['dif'], 'alex_dif', '감정 인식의 어려움', [], 1, 5, 'sum');
  await make(['ddf'], 'alex_ddf', '감정 표현의 어려움', ['ddf4'], 1, 5, 'sum');
  const vl2 = await p.$eval('#varList', e => e.innerText);
  ok(/만든 척도 점수/.test(vl2) && /12문항 합계 · 역채점 ddf4 \(1\+5−응답\) · 유효 321명 · Cronbach α = \.\d\d/.test(vl2), '만든 척도가 목록에 표시(문항 수·역채점·α)');
  ok((await p.$$eval('#vX option', os => os.map(o => o.textContent))).includes('감정표현불능증 (alex)'), '역할 목록에 논문 이름으로 표시');
  ok(!(await p.$eval('#scoring', e => e.open)) || (await p.$eval('#scName', e => e.value)) === '', '만든 뒤 입력 칸 비움');

  // ===== 값의 뜻 입력 =====
  await p.fill('[data-codeval="gender|1"]', '남성'); await p.fill('[data-codeval="gender|2"]', '여성');
  for (const [k, v] of [[1, '고등학교 졸업'], [2, '대학교 졸업'], [3, '대학원 졸업'], [4, '중학교 졸업 이하']]) await p.fill(`[data-codeval="edu|${k}"]`, v);
  await p.fill('input[data-var="age"]', '연령'); await p.fill('input[data-var="gender"]', '성별'); await p.fill('input[data-var="edu"]', '최종학력');

  // ===== 분석 1: 단순매개 =====
  await p.click('input[value=simple]'); await p.selectOption('#vX', 'alex'); await p.selectOption('#vM1', 'avoid'); await p.selectOption('#vY', 'distress');
  ok((await run()) === 'current', '단순매개 1 실행');
  const dm = await table('인구통계학적 특성');
  const gRow = dm.rows.find(r => r[1] === '남성'), aRow = dm.rows.find(r => r[0] === '연령');
  ok(gRow && Number(gRow[2]) === nMale && gRow[3] === (100 * nMale / 321).toFixed(1) + '%', `성별 빈도·비율 = 기준값(남성 ${nMale}명, ${(100 * nMale / 321).toFixed(1)}%): ${gRow}`);
  ok(aRow && aRow[1].includes(`M = ${ageMean.toFixed(2)}`) && aRow[1].includes(`SD = ${ageSD.toFixed(2)}`), `연령 평균·표준편차 = 기준값(${ageMean.toFixed(2)}, ${ageSD.toFixed(2)}): ${aRow && aRow[1]}`);
  ok(dm.rows.filter(r => /졸업/.test(r[1])).length === 4, '모형에 넣지 않은 학력(4범주)도 특성 표에 나옴');
  const sm = await p.$eval('#sampleBox', e => e.innerText);
  ok(new RegExp(`성별은 남성 ${nMale}명\\(`).test(sm) && /최종학력은 고등학교 졸업 \d+명/.test(sm) && /연령의 평균은/.test(sm) && new RegExp(`${dm.no}에 제시`).test(sm), '연구대상 특성 문장과 표 번호 참조');
  const rel = await table('신뢰도');
  ok(rel.rows.length === 6 && rel.rows.filter(r => /하위요인·기타/.test(r[0])).length === 3 && rel.rows.every(r => /^\.\d\d$/.test(r[5])), '신뢰도 표: 모형 변인 3개 + 그 밖의 척도 3개(하위요인 포함) 모두 α 보고');
  ok(/하위요인 등 모형에 직접 투입하지 않은 척도의 신뢰도는/.test(sm) && /감정 인식의 어려움 7문항 α = \.\d\d/.test(sm), '하위요인 신뢰도 문장');
  // 연구대상 특성 해제: 재분석 없이 즉시
  await p.uncheck('[data-demo="edu"]'); await p.waitForTimeout(500);
  ok((await st()) === 'current' && !(await table('인구통계학적 특성')).rows.some(r => /졸업/.test(r[1])), '특성 체크 해제 → 재분석 없이 표에서 빠짐');
  await p.check('[data-demo="edu"]'); await p.waitForTimeout(500);

  // ===== 통합 보고서: 세 분석 담기 =====
  ok(await p.$eval('[data-savecombined]', e => e.disabled), '담은 분석이 없으면 통합 저장 비활성');
  await p.click('[data-addreport]'); await p.waitForTimeout(150);
  await p.selectOption('#vM1', 'dysreg'); ok((await run()) === 'current', '단순매개 2 실행'); await p.click('[data-addreport]'); await p.waitForTimeout(150);
  await p.click('input[value=serial]'); await p.selectOption('#vM1', 'avoid'); await p.selectOption('#vM2', 'dysreg'); ok((await run()) === 'current', '순차매개 실행'); await p.click('[data-addreport]'); await p.waitForTimeout(150);
  const list = await p.$$eval('.repitem .t', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  ok(list.length === 3 && /^1\. 단순매개: 감정표현불능증 → 경험회피 → 심리적 고통/.test(list[0]) && /^3\. 순차매개: 감정표현불능증 → 경험회피 → 정서조절곤란 → 심리적 고통/.test(list[2]), '담은 분석 3개: ' + list.join(' | '));
  await p.click('[data-addreport]'); await p.waitForTimeout(150);
  ok((await p.$$('.repitem')).length === 3, '같은 분석을 다시 담으면 추가되지 않고 교체');
  const html = await dl('[data-savecombined]');
  const nos = (html.match(/<b>표 (\d+)<\/b>/g) || []).map(x => Number(x.match(/\d+/)[0]));
  ok(nos.length >= 13 && nos.every((n, i) => n === i + 1), '통합 보고서: 표 번호가 1부터 끊김 없이 이어짐 (' + nos.join(',') + ')');
  const figs = (html.match(/<b>그림 (\d+)<\/b>/g) || []).map(x => Number(x.match(/\d+/)[0]));
  ok(figs.join() === '1,2,3', '그림 번호 1~3: ' + figs.join());
  ok((html.match(/주요 변인의 기술통계 및 상관계수/g) || []).length === 1 && (html.match(/인구통계학적 특성 \(n/g) || []).length === 1 && (html.match(/척도 점수 산출과 신뢰도/g) || []).length === 1, '연구대상·기술통계·신뢰도는 한 번만');
  const h2 = (html.match(/<h2>[^<]*<\/h2>/g) || []).map(x => x.replace(/<\/?h2>/g, ''));
  ok(h2.some(x => /경험회피의 단순매개효과/.test(x)) && h2.some(x => /정서조절곤란의 단순매개효과/.test(x)) && h2.some(x => /경험회피와 정서조절곤란의 순차매개효과/.test(x)) && /^1\. 자료분석/.test(h2[0]), '절 제목: ' + h2.join(' / '));
  // 각 분석 문단의 표 참조가 그 분석의 표 번호와 맞는지
  const secs = html.split(/<h2>/).slice(1);
  const chk = secs.filter(x => /매개효과<\/h2>/.test(x)).map(x => { const ref = Number((x.match(/검증한 결과는 표 (\d+)에 제시/) || [])[1]); const first = Number((x.match(/<b>표 (\d+)<\/b>/) || [])[1]); const eff = Number((x.match(/부트스트래핑을 실시하였다\(표 (\d+)\)/) || [])[1]); return ref === first && eff === first + 1; });
  ok(chk.length === 3 && chk.every(Boolean), '분석별 본문의 표 참조 번호 = 그 분석의 표 번호: ' + chk.join());
  ok(/모형 4에 해당하는 구조[\s\S]*모형 4에 해당하는 구조[\s\S]*모형 6에 해당하는 구조/.test(secs[0]) && (secs[0].match(/자료 분석에는/g) || []).length === 1 && (secs[0].match(/부트스트랩 재표집/g) || []).length === 1, '자료분석 문단: 공통 부분 한 번, 모형 3개, 부트스트랩 설명 한 번');
  ok(/4\. 정서조절곤란|정서조절곤란/.test(secs[2]) && (secs[2].match(/<td>4\. /g) || []).length === 1, '상관표에 네 변인 모두 포함');
  // 미리보기
  await p.click('#combinedBox summary'); await p.waitForTimeout(300);
  ok(/표 1/.test(await p.$eval('#combinedPreview', e => e.innerText)) && /순차매개효과/.test(await p.$eval('#combinedPreview', e => e.innerText)), '통합 보고서 미리보기');

  // ===== 자료 설정이 바뀌면: 저장 차단 → 모두 다시 실행 =====
  await p.fill('#missing', '99'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  ok(await p.$eval('[data-savecombined]', e => e.disabled) && /다시 실행해야 합니다/.test(await p.$eval('#reportCard', e => e.innerText)), '결측치 코드 변경 → 담아 둔 분석이 맞지 않음을 표시, 통합 저장 차단');
  await p.click('[data-rerunreport]'); await p.waitForTimeout(1500);
  ok(!(await p.$eval('[data-savecombined]', e => e.disabled)) && !/다시 실행해야 합니다/.test(await p.$eval('#reportCard', e => e.innerText)), '모두 다시 실행 → 통합 저장 가능');
  await p.click('[data-delreport="1"]'); await p.waitForTimeout(150);
  ok((await p.$$('.repitem')).length === 2, '담은 분석 빼기');
  // 척도 삭제·묶음 풀기
  await p.click('#subsBox summary'); await p.click('[data-delscale="alex_ddf"]'); await p.waitForTimeout(200);
  ok(!/alex_ddf/.test(await p.$eval('#varList', e => e.innerText)) && !(await p.$$eval('#vX option', os => os.map(o => o.value))).includes('alex_ddf'), '척도 삭제');
  await p.click('[data-ungroup="ders"]'); await p.waitForTimeout(200);
  ok((await p.$$eval('#varList [data-vtype]', els => els.map(e => e.dataset.vtype))).includes('ders1'), '묶음 풀기 → 문항이 변수로 하나씩 표시');
  ok(errs.length === 0, '페이지 오류 없음 ' + errs.join(' | '));
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: '/home/user/verify/design/ux_items.png', fullPage: false });
  console.log(`변수 정리·통합 보고서 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(f => console.log(' -', f));
  fs.writeFileSync('/home/user/verify/design/combined_sample.html', html);
  // 모바일
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(URL); await m.waitForTimeout(800); await legacy(m);
  await m.setInputFiles('#file', CSV); await m.waitForTimeout(500);
  console.log('모바일 가로폭', await m.evaluate(() => document.documentElement.scrollWidth), '잘린 입력/버튼', await m.evaluate(() => Array.from(document.querySelectorAll('input,select,button,textarea')).filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.dataset.var || e.textContent.trim())));
  await m.screenshot({ path: '/home/user/verify/design/ux_mobile.png' });
  await b.close();
})();
