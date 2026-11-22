// HC3 선택·분석 진단 화면 점검
const legacy = require('./boot.js');
const { chromium } = require('playwright'); const fs = require('fs');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html');
let pass = 0; const fails = []; const ok = (c, w) => { if (c) pass++; else fails.push(w); };
let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const norm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const L = ['x,m,y,w'];
for (let i = 0; i < 80; i++) { const x = norm(), m = 0.5 * x + norm(), w = norm(); L.push([x, m, 0.3 * x + 0.4 * m + norm(), w].map(v => v.toFixed(3)).join(',')); }
L.push(['9.000', '0.000', '-12.000', '0.000'].join(',')); // 영향력이 매우 큰 사례 (81번째 자료 행)
const CSV = '/tmp/diag_test.csv'; fs.writeFileSync(CSV, L.join('\n'));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(800); await legacy(p);
  const st = () => p.$eval('#results', e => e.dataset.status);
  const run = async () => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running'); await p.waitForTimeout(150); };
  const dl = async sel => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); return fs.readFileSync(await d.path(), 'utf8'); };
  const tabText = re => p.evaluate(src => (Array.from(document.querySelectorAll('.tablewrap')).find(t => new RegExp(src).test(t.querySelector('caption').innerText)) || {}).innerText || '', re);
  // 예시 데이터 조절모형: 일반 → HC3
  await p.click('input[value=moderation]'); await p.selectOption('#vX', 'alex'); await p.selectOption('#vY', 'distress'); await p.selectOption('#vW', 'support'); await run();
  const condOLS = await tabText('조건부 효과');
  ok(!(await p.$eval('#diagBox', e => e.open)), '분석 진단은 기본적으로 접힘');
  ok(/VIF/.test(await p.$eval('#diagBox', e => e.textContent)) && (await p.$$('#diagBox svg')).length === 2, '진단 영역: VIF 표 + 잔차 그림 2개(회귀식 1개)');
  ok(!/진단 참고/.test(await p.$eval('#results', e => e.innerText)), '조절모형 구성항의 높은 VIF로는 경고하지 않음');
  await p.selectOption('#oSE', 'hc3'); ok((await st()) === 'stale', 'SE 방식 변경 → 재분석 필요');
  await run();
  const t = await p.$eval('#results', e => e.innerText);
  const condHC = await tabText('조건부 효과');
  ok(/HC3 이분산 일치 표준오차로 산출하였다/.test(await p.$eval('#methodBox', e => e.innerText)), '분석 방법에 HC3 명시');
  ok(/HC3 기반 F/.test(await tabText('의 조절효과$')) && /SE는 HC3/.test(await tabText('의 조절효과$')), '조절 회귀 표 주석에 HC3 기반 검정 명시');
  await p.selectOption('#oStyle', 'detail'); await p.waitForTimeout(500);
  ok(/HC3 기반 F/.test(await p.$eval('#textBox', e => e.innerText)), '상세 형식 결과 문장에 HC3 기반 검정 명시');
  await p.selectOption('#oStyle', 'paper'); await p.waitForTimeout(500);
  ok(/SE는 HC3/.test(condHC) && condHC !== condOLS, '조건부 효과 표가 HC3로 바뀌고 주석 표기');
  ok(/HC3 강건 표준오차, 신뢰수준/.test(t) && /Hayes, A\. F\., & Cai/.test(t), '설정 기록·참고문헌에 HC3');
  ok(/SE는 HC3/.test(await tabText('Johnson-Neyman')), 'Johnson-Neyman 표에도 HC3 표기');
  const rep = await dl('[data-report]');
  ok(/HC3/.test(rep) && /회귀 진단과 주의사항/.test(rep) && /회귀식별 다중공선성/.test(rep) && (rep.match(/<svg/g) || []).length >= 4, '보고서 ⑥에 진단 문단·표·그림 포함');
  const js = JSON.parse(await dl('[data-settings]'));
  ok(js.설정.se === 'hc3' && js.회귀진단[0].VIF.length === 3, 'JSON에 SE 방식·회귀식별 VIF 기록');
  await p.click('#diagBox summary'); await p.selectOption('#oDec', '3'); await p.waitForTimeout(500);
  ok(await p.$eval('#diagBox', e => e.open), '출력 설정 변경 후에도 진단 영역 열림 유지');
  // 영향력 큰 사례가 있는 자료: 매개모형
  await p.setInputFiles('#file', CSV); await p.waitForTimeout(300);
  await p.selectOption('#oSE', 'ols'); await p.click('input[value=simple]'); await p.selectOption('#vX', 'x'); await p.selectOption('#vM1', 'm'); await p.selectOption('#vY', 'y'); await run();
  const t2 = await p.$eval('#results', e => e.innerText);
  const t2all = await p.$eval('#results', e => e.textContent);
  ok(/진단 참고:.*Cook의 거리가 1을 넘는 사례가 1명.*자료 행 81/.test(t2), '영향력 큰 사례 → 접힌 영역 밖에 짧은 경고(행 번호 포함)');
  ok(/분석에서 제외하지 않았다/.test(t2all) && /N = 81/.test(t2all), '영향력 사례를 자동 삭제하지 않음(N = 81 유지)');
  ok((await p.$$('#diagBox svg')).length === 4, '매개모형: 회귀식 2개 × 그림 2개');
  ok(!/모든 (통계적 )?가정이 충족/.test(t2all) && /자동으로 판정하지 않는다/.test(t2all), '가정 충족 자동 판정 문장 없음');
  ok(errs.length === 0, '페이지 오류 없음 ' + errs.join(' | '));
  if (!(await p.$eval('#diagBox', e => e.open))) await p.click('#diagBox summary');
  await p.waitForTimeout(200);
  await (await p.$('#diagBox')).screenshot({ path: '/home/user/verify/design/diag_box.png' });
  console.log(`HC3·진단 화면 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(f => console.log(' -', f));
  await b.close();
})();
