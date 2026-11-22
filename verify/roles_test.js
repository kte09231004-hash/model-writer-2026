// 단계 순서(모형 선택이 변수 입력보다 먼저)와 변수 역할 칸의 순서 점검
const legacy = require('./boot.js');
const { chromium } = require('playwright');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html');
let pass = 0; const fails = []; const ok = (c, w) => { if (c) pass++; else fails.push(w); };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(800); await legacy(p);
  const steps = await p.$$eval('.steps > section.step > h2', hs => hs.map(h => h.childNodes[0].textContent + ' ' + h.childNodes[1].textContent.trim()));
  ok(steps.join(' / ') === '1 데이터 불러오기 / 2 변수 정리 / 3 분석 모형과 변인 지정 / 4 분석 옵션 / 5 연구 정보', '단계 순서: ' + steps.join(' / '));
  ok((await p.$$eval('.steps section.step section.step', x => x.length)) === 0, '단계 안에 단계가 겹쳐 들어가 있지 않음');
  // 화면에 보이는 역할 칸을 위에서부터 읽음
  const fields = () => p.evaluate(() => Array.from(document.querySelectorAll('#rolePath select')).filter(e => e.offsetParent).sort((a, c) => a.getBoundingClientRect().top - c.getBoundingClientRect().top).map(e => e.id + ':' + e.closest('label').querySelector('.rb').textContent));
  const hint = () => p.$eval('#roleHint', e => e.textContent);
  const covs = () => p.$$eval('#covs input', is => is.map(i => i.value));
  const st = () => p.$eval('#results', e => e.dataset.status);
  const run = async () => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running'); await p.waitForTimeout(150); return st(); };

  await p.click('input[value=simple]');
  ok((await fields()).join() === 'vX:X,vM1:M,vY:Y', '단순매개 칸 순서 X → M → Y: ' + (await fields()).join());
  ok(/변인 3개/.test(await hint()) && /X → M → Y/.test(await hint()), '단순매개 안내: ' + await hint());
  await p.click('input[value=serial]');
  ok((await fields()).join() === 'vX:X,vM1:M1,vM2:M2,vM3:M3,vY:Y', '순차매개 칸 순서 X → M1 → M2 → M3 → Y (M3도 숨기지 않음): ' + (await fields()).join());
  ok(/변인 4개/.test(await hint()) && /X → M1 → M2 → Y/.test(await hint()), '순차매개 안내: ' + await hint());
  ok(/선택/.test(await p.$eval('#fM3', e => e.innerText)), 'M3 칸에 선택 항목임을 표시');
  await p.click('input[value=moderation]');
  ok((await fields()).join() === 'vX:X,vW:W,vY:Y', '조절 칸 순서 X, W, Y: ' + (await fields()).join());
  ok(/변인 3개/.test(await hint()), '조절 안내: ' + await hint());

  // 공변인 후보에서 역할로 고른 변인 제외
  await p.click('input[value=serial]'); await p.selectOption('#vX', 'alex'); await p.selectOption('#vM1', 'avoid'); await p.selectOption('#vM2', 'dysreg'); await p.selectOption('#vM3', ''); await p.selectOption('#vY', 'distress');
  let c = await covs();
  ok(c.join() === 'age,gender,support', '순차매개: 공변인 후보에서 역할 변인 4개 제외 → ' + c.join());
  await p.check('#covs input[value="support"]');
  await p.selectOption('#vM3', 'support'); c = await covs();
  ok(!c.includes('support'), 'M3로 고른 변인은 공변인 후보에서 빠지고 선택도 해제됨');
  await p.selectOption('#vM3', ''); c = await covs();
  ok(c.includes('support'), '역할에서 빼면 다시 공변인 후보로 돌아옴');
  await p.check('#covs input[value="age"]'); await p.selectOption('#vX', 'alex');
  ok((await p.$eval('#covs input[value="age"]', e => e.checked)), '역할을 바꿔도 이미 고른 공변인은 유지');
  await p.uncheck('#covs input[value="age"]');
  // 실행: 각 모형이 정상 동작
  ok((await run()) === 'current', '순차매개 실행');
  await p.selectOption('#vM3', 'support'); ok((await run()) === 'current', '매개변인 3개 순차매개 실행');
  ok(/간접효과7/.test(await p.$eval('#results', e => e.innerText)), '매개변인 3개: 간접 경로 7개');
  await p.click('input[value=simple]'); ok((await run()) === 'current', '단순매개 실행');
  await p.click('input[value=moderation]'); await p.selectOption('#vW', 'support'); ok((await run()) === 'current', '조절 실행');
  ok(errs.length === 0, '페이지 오류 없음 ' + errs.join(' | '));
  console.log(`단계·역할 칸 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(f => console.log(' -', f));
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(URL); await m.waitForTimeout(800); await legacy(m);
  console.log('모바일 가로폭', await m.evaluate(() => document.documentElement.scrollWidth), '잘린 입력/버튼', await m.evaluate(() => Array.from(document.querySelectorAll('input,select,button,textarea')).filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.textContent.trim())));
  await b.close();
})();
