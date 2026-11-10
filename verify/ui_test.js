// 브라우저 상태 관리·출력 일관성 점검 (playwright)
const { chromium } = require('playwright'); const fs = require('fs');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html');
let pass = 0; const fails = [];
const ok = (c, what) => { if (c) pass++; else fails.push(what); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(2500);
  const st = () => p.evaluate(() => ({ status: document.getElementById('results').dataset.status,
    banner: (document.getElementById('statusBanner') || {}).hidden === false ? document.getElementById('statusBanner').innerText : '',
    enabled: Array.from(document.querySelectorAll('#results button')).filter(x => !x.disabled).length,
    total: document.querySelectorAll('#results button').length, err: document.getElementById('runMsg').innerText }));
  const run = async () => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running'); await p.waitForTimeout(200); };
  const dl = async sel => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); return fs.readFileSync(await d.path()); };
  let s = await st();
  ok(s.status === 'current' && s.enabled === s.total && s.total > 0, '첫 화면(예시 순차매개) 정상 상태 ' + JSON.stringify(s));

  // ===== 피드백 1 재현: 조절 성공 → X=Y → 실행 =====
  await p.click('input[value=moderation]'); s = await st();
  ok(s.status === 'stale' && s.enabled === 0 && /입력이 변경/.test(s.banner), '모형만 변경(미실행) → 재분석 필요 ' + JSON.stringify(s));
  await p.selectOption('#vX', 'alex'); await p.selectOption('#vY', 'distress'); await p.selectOption('#vW', 'support');
  await run(); s = await st();
  ok(s.status === 'current' && s.enabled === s.total && !s.banner, '조절 분석 성공 ' + JSON.stringify(s));
  const jnDom = await p.evaluate(() => ({ tables: document.querySelectorAll('table.apa').length, jnTable: /Johnson-Neyman 분석 결과/.test(document.getElementById('results').innerText),
    method: document.getElementById('methodBox').innerText, text: document.getElementById('textBox').innerText, n: (document.getElementById('results').innerText.match(/N = (\d+)/) || [])[1],
    interP: (document.getElementById('tab0').innerText.match(/×[^\n]*?\t?(−?\d\.\d+)\s+(\d\.\d+)\s+(−?\d\.\d+)\s+(\.\d+)/) || [])[4] }));
  ok(jnDom.tables === 3 && jnDom.jnTable, 'JN 전용 표 표시 ' + jnDom.tables);
  ok(/Johnson-Neyman/.test(jnDom.text), 'JN 결과 서술 포함 (상호작용 비유의여도)');
  ok(/Johnson-Neyman 방법으로 95% 신뢰수준/.test(jnDom.method), 'JN 분석 방법 문장(95%)');
  ok(jnDom.n === '299', '예시 조절 N=299 ' + jnDom.n);
  console.log('예시 조절 JN 서술:', jnDom.text.split('\n').filter(x => /Johnson/.test(x))[0].replace(/.*(Johnson-Neyman 분석 결과)/, '$1'));
  const rawJN = await p.$eval('#tab2', e => e.innerText);
  const json1 = JSON.parse((await dl('[data-settings]')).toString());
  ok(json1.설정.x === 'alex' && json1.설정.y === 'distress' && json1.설정.w === 'support', '성공 직후 JSON 설정');

  await p.selectOption('#vX', 'distress'); s = await st();
  ok(s.status === 'stale' && s.enabled === 0, 'X 변경(미실행) → 재분석 필요');
  await run(); s = await st();
  ok(s.status === 'failed' && /분석에 실패/.test(s.banner) && /두 가지 역할/.test(s.err) && s.enabled === 0, 'X=Y 실행 → 실패 표시·버튼 차단 ' + JSON.stringify(s));
  const dim = await p.evaluate(() => getComputedStyle(document.querySelector('#results .rcard')).opacity);
  ok(Number(dim) < 1, '이전 결과 흐리게 표시');
  const editable = await p.evaluate(() => document.getElementById('textBox').getAttribute('contenteditable'));
  ok(editable === 'false', '실패 상태에서 문단 편집 차단');

  // 원래 값으로 되돌리면 마지막 성공 분석과 같은 입력 → 정상 복구
  await p.selectOption('#vX', 'alex'); s = await st();
  ok(s.status === 'current' && !s.err && s.enabled === s.total, '입력을 되돌리면 정상 복구 ' + JSON.stringify(s));

  // ===== 옵션만 변경: 신뢰수준 / 중심화 / 지점 =====
  for (const [sel, val] of [['#oConf', '0.99'], ['#oCenter', 'mean'], ['#oProbe', 'meansd']]) {
    const before = await p.$eval(sel, e => e.value);
    await p.selectOption(sel, val); s = await st(); ok(s.status === 'stale' && s.enabled === 0, `${sel} 변경 → 재분석 필요`);
    await p.selectOption(sel, before); s = await st(); ok(s.status === 'current', `${sel} 되돌림 → 정상`);
  }
  await p.selectOption('#oConf', '0.99'); await run();
  const j99 = await p.evaluate(() => ({ m: document.getElementById('methodBox').innerText, t: document.getElementById('tab2').innerText }));
  ok(/99% 신뢰수준/.test(j99.m) && /99% 신뢰수준/.test(j99.t) && /p < \.01/.test(j99.t), '99% 반영 (방법·JN 표)');
  await p.selectOption('#oConf', '0.90'); await run();
  ok(/90% 신뢰수준/.test(await p.$eval('#tab2', e => e.innerText)), '90% 반영');
  await p.selectOption('#oConf', '0.95'); await p.selectOption('#oCenter', 'mean'); await run();
  const cen = await p.$eval('#tab2', e => e.innerText);
  const bnd = t => (t.match(/경계값\s+(−?\d+\.\d+)/g) || []).map(x => x.replace(/경계값\s+/, ''));
  ok(/중심화 값/.test(cen) && JSON.stringify(bnd(cen)) === JSON.stringify(bnd(rawJN)) && bnd(rawJN).length > 0, '평균중심화: 원점수 경계값이 원점수 분석과 같음 ' + bnd(rawJN) + ' / ' + bnd(cen));
  await p.selectOption('#oCenter', 'none'); await run();

  // ===== 출력 설정: 즉시 반영, 재분석 불필요 =====
  await p.selectOption('#oDec', '3'); await p.waitForTimeout(400); s = await st();
  ok(s.status === 'current', '소수점 변경은 재분석 불필요');
  ok(/0\.6\d\d/.test(await p.$eval('#tab0', e => e.innerText)), '소수점 3자리 즉시 반영');
  await p.fill('input[data-var="support"]', '지각된 사회적 지지'); await p.click('[data-copy="text"]'); await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok(/지각된 사회적 지지/.test(clip), '이름 변경 직후 복사에 반영(대기 중 출력 먼저 반영)');
  const rep = (await dl('[data-report]')).toString();
  ok(/지각된 사회적 지지/.test(rep) && /Johnson-Neyman 분석 결과/.test(rep), 'HTML 보고서에 새 이름·JN 표');
  const csv = (await dl('[data-csv="2"]')).toString();
  ok(/지각된 사회적 지지/.test(csv) && /경계값/.test(csv), 'JN 표 CSV 저장');
  const svg = (await dl('[data-svg="0"]')).toString(); ok(/지각된 사회적 지지/.test(svg), '그림 SVG에 새 이름');
  const png = await dl('[data-png="1"]'); ok(png.slice(1, 4).toString() === 'PNG', 'PNG 저장');
  const json2 = JSON.parse((await dl('[data-settings]')).toString());
  ok(json2.출력설정.변인이름.support === '지각된 사회적 지지' && json2.출력설정.계수소수점 === 3 && json2['Johnson-Neyman'].status === 'changes', 'JSON 출력설정·JN 일치');

  // 결측치 코드 변경 후 저장 시도: 섞이지 않아야 함
  await p.fill('#missing', '999'); await p.dispatchEvent('#missing', 'change'); s = await st();
  ok(s.status === 'stale' && s.enabled === 0, '결측치 코드 변경 → 재분석 필요');
  await p.fill('#missing', ''); await p.dispatchEvent('#missing', 'change'); s = await st(); ok(s.status === 'current', '결측치 코드 되돌림 → 정상');

  // 공변인
  await p.check('#covs input[value="age"]'); s = await st(); ok(s.status === 'stale', '공변인 추가 → 재분석 필요');
  await p.uncheck('#covs input[value="age"]');

  // 문항 점수 계산(데이터 변경)
  await p.click('#scoring summary'); await p.fill('#scName', 'tmp_score');
  await p.check('#scItems input[value="alex"]'); s = await st(); ok(s.status === 'current', '문항 선택만으로는 데이터 미변경');
  await p.click('#scAdd'); s = await st(); ok(s.status === 'stale', '점수 변수 생성(데이터 변경) → 재분석 필요');
  await run(); s = await st(); ok(s.status === 'current', '재실행 → 정상');

  // ===== 매개모형: 부트스트랩 횟수·시드 =====
  await p.click('input[value=serial]'); await p.selectOption('#vM1', 'avoid'); await p.selectOption('#vM2', 'dysreg'); await run();
  const ci1 = await p.$eval('#tab1', e => e.innerText);
  await p.fill('#oSeed', '7'); await p.dispatchEvent('#oSeed', 'input'); s = await st(); ok(s.status === 'stale', '시드 변경 → 재분석 필요');
  await p.fill('#oSeed', '20261126'); await p.dispatchEvent('#oSeed', 'input'); s = await st(); ok(s.status === 'current', '시드 되돌림 → 정상');
  await p.selectOption('#oBoot', '1000'); s = await st(); ok(s.status === 'stale', '부트스트랩 횟수 변경 → 재분석 필요');
  await p.selectOption('#oBoot', '5000'); await run();
  ok((await p.$eval('#tab1', e => e.innerText)) === ci1, '같은 시드·횟수 재실행 → 같은 부트스트랩 결과');
  await p.click('input[value=simple]'); await run(); s = await st(); ok(s.status === 'current', '단순매개 실행');

  // 데이터 교체
  await p.click('#loadSample'); s = await st(); ok(s.status === 'stale', '데이터 다시 불러오기 → 재분석 필요');
  await run(); s = await st(); ok(s.status === 'current', '재실행 → 정상');
  ok(errs.length === 0, '페이지 오류 없음 ' + errs.join(' | '));
  console.log(`UI 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(f => console.log(' -', f));
  // 모바일
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(URL); await m.waitForTimeout(2000);
  await m.click('input[value=moderation]'); await m.click('#run'); await m.waitForTimeout(800);
  console.log('모바일 가로폭', await m.evaluate(() => document.documentElement.scrollWidth), '잘린 입력/버튼', await m.evaluate(() => Array.from(document.querySelectorAll('input,select,button')).filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.textContent.trim())));
  await m.screenshot({ path: '/home/user/verify/design/mobile_after_fix.png', fullPage: true });
  await p.selectOption('#vX', 'distress'); await p.click('input[value=moderation]');
  await p.waitForTimeout(300);
  console.log('카드 상태', await p.evaluate(() => Array.from(document.querySelectorAll('.mcard')).map(c => (c.classList.contains('on') ? 'ON' : '-') + (c.querySelector('input').checked ? '(checked)' : '')).join(' ')), '오류', errs);
  await p.screenshot({ path: '/home/user/verify/design/stale_state.png' });
  await b.close();
})();
