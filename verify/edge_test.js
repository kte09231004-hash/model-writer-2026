// 예외 상황 점검: 상수·완전 공선성·이분 종속·다범주·코딩 오류·ID 중복·수정 문장 보호·설정 변경 후 내보내기
const legacy = require('./boot.js');
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html');
let pass = 0; const fails = []; const ok = (c, w) => { if (c) pass++; else fails.push(w); };
// 시험 자료 생성 (결정적 난수)
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const norm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const lines = ['id,x,m,y,w,konst,xcopy,ybin,wcat,gbad,sex'];
for (let i = 1; i <= 120; i++) {
  const x = norm(), m = 0.5 * x + norm(), w = norm(), y = 0.3 * x + 0.4 * m + 0.2 * x * w + norm();
  lines.push([i <= 110 ? i : i - 10, x.toFixed(3), m.toFixed(3), y.toFixed(3), w.toFixed(3), 3, x.toFixed(3), y > 0 ? 1 : 0, 1 + (i % 3), 1 + (i % 3), i % 2].join(','));
}
const csvPath = '/tmp/edge_test.csv'; fs.writeFileSync(csvPath, lines.join('\n'));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(800); await legacy(p);
  await p.setInputFiles('#file', csvPath); await p.waitForTimeout(500);
  const types = await p.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-vtype]')).map(s => [s.dataset.vtype, s.value])));
  ok(types.id === 'id' && types.ybin === 'binary' && types.wcat === 'categorical' && types.sex === 'binary' && types.x === 'continuous', '변수 유형 자동 판단 ' + JSON.stringify(types));
  ok(/같은 값이 10번 반복/.test(await p.$eval('#dataWarn', e => e.innerText)), 'ID 중복 경고');
  ok(!(await p.$$eval('#vX option', os => os.map(o => o.value))).includes('id'), 'ID 변수는 역할 목록에서 제외');
  const st = () => p.evaluate(() => ({ status: document.getElementById('results').dataset.status, err: document.getElementById('runMsg').innerText }));
  const run = async () => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running'); await p.waitForTimeout(150); return st(); };
  const set = async (model, roles) => { await p.click(`input[value=${model}]`); for (const [id, v] of Object.entries(roles)) await p.selectOption(id, v); };

  await set('moderation', { '#vX': 'x', '#vY': 'y', '#vW': 'konst' }); let s = await run();
  ok(s.status === 'failed' && /상수/.test(s.err), '상수 조절변인 → 구체적 오류: ' + s.err);
  await set('simple', { '#vX': 'x', '#vM1': 'xcopy', '#vY': 'y' }); s = await run();
  ok(s.status === 'failed' && /완전한 선형 종속/.test(s.err) && /'x', 'xcopy'/.test(s.err), '완전 공선성 → 회귀식·변수 명시: ' + s.err);
  await set('simple', { '#vX': 'x', '#vM1': 'm', '#vY': 'ybin' }); s = await run();
  ok(s.status === 'failed' && /연속형 종속변인/.test(s.err), '이분 종속변수 차단: ' + s.err);
  await set('moderation', { '#vX': 'x', '#vY': 'y', '#vW': 'wcat' }); s = await run();
  ok(s.status === 'failed' && /3개 이상인 범주형/.test(s.err), '다범주 조절변수 차단: ' + s.err);
  await p.selectOption('[data-vtype="gbad"]', 'binary');
  await set('moderation', { '#vX': 'x', '#vY': 'y', '#vW': 'gbad' }); s = await run();
  ok(s.status === 'failed' && /이분형으로 지정되었지만 값이 3종/.test(s.err), '범주 코딩 오류(이분형 지정, 값 3종): ' + s.err);
  await set('moderation', { '#vX': 'x', '#vY': 'y', '#vW': 'sex' }); s = await run();
  ok(s.status === 'current', '이분 조절변수 정상 실행');
  const tx = await p.$eval('#results', e => e.innerText);
  ok(!/M − 1SD|평균 ±1/.test(await p.$eval('#textBox', e => e.innerText)) && /sex = 0/.test(tx), '이분 조절변수에 평균±SD 미적용(0·1 값 사용)');
  ok(/같은 값이 10번 반복/.test(tx), 'ID 중복 경고가 결과 영역에도 표시');
  await p.selectOption('[data-vtype="wcat"]', 'continuous'); await set('moderation', { '#vX': 'x', '#vY': 'y', '#vW': 'wcat' }); s = await run();
  ok(s.status === 'current', '유형을 연속형으로 바꾸면 실행됨');
  await p.check('#covs input[value="gbad"]'); s = await run();
  ok(s.status === 'failed', '잘못 코딩된 이분 공변인 차단');
  await p.uncheck('#covs input[value="gbad"]'); await p.check('#covs input[value="sex"]'); s = await run();
  ok(s.status === 'current', '이분 공변인 허용');
  const freq = await p.evaluate(() => (Array.from(document.querySelectorAll('.tablewrap')).find(t => /인구통계학적 특성/.test(t.querySelector('caption').innerText)) || {}).innerText || '');
  ok(/sex/.test(freq) && /코드 0/.test(freq) && /코드 의미는 '변수 정리'에서 입력/.test(freq), '이분형 변수는 연구대상 특성 표에 나오고, 코드 의미 입력을 안내');
  const corr = await p.evaluate(() => (Array.from(document.querySelectorAll('.tablewrap')).find(t => /상관/.test(t.querySelector('caption').innerText)) || {}).innerText || '');
  ok(corr && !/sex/.test(corr), '범주형 변수는 상관표에서 제외');

  // 직접 고친 문장 보호
  await p.click('#textBox p'); await p.keyboard.press('End'); await p.keyboard.type(' [연구자 추가 문장]');
  await p.selectOption('#oDec', '3'); await p.waitForTimeout(500);
  const note = await p.evaluate(() => ({ note: !!document.querySelector('#textBox') && /직접 수정한 문장이 있었습니다/.test(document.getElementById('results').innerText), auto: document.getElementById('textBox').innerText }));
  ok(note.note && !/연구자 추가 문장/.test(note.auto), '출력 설정 변경 시 알림 + 자동 문장으로 교체');
  await p.click('.editnote summary'); await p.click('[data-copyprev="textBox"]'); await p.waitForTimeout(200);
  ok(/연구자 추가 문장/.test(await p.evaluate(() => navigator.clipboard.readText())), '이전 수정본 보관·복사 가능');
  // 재분석에서도 같은 방식
  await p.click('#textBox p'); await p.keyboard.press('End'); await p.keyboard.type(' [두 번째 수정]');
  await p.selectOption('#oConf', '0.99'); s = await run();
  ok(/두 번째 수정/.test(await p.$eval('.editnote .prevedit', e => e.textContent)), '재분석 시에도 이전 수정본 보관');

  // 설정 변경 후 내보내기 차단
  await p.selectOption('#oConf', '0.95'); s = await st();
  ok(s.status === 'stale', '설정 변경 → 재분석 필요');
  const disabled = await p.$eval('[data-report]', e => e.disabled);
  let got = false; p.once('download', () => (got = true)); await p.click('[data-report]', { force: true }).catch(() => {}); await p.waitForTimeout(800);
  ok(disabled && !got, '재분석 필요 상태에서 보고서 내보내기 차단');
  s = await run(); const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-report]')]);
  const rep = fs.readFileSync(await d.path(), 'utf8');
  const order = ['1. 자료분석', '2. 분석 대상과 결측치 처리', '3. 기술통계 및 상관관계 분석 결과', '의 조절효과</h2>', '회귀 진단과 주의사항'].map(h => rep.indexOf(h));
  ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), '보고서 ①~⑥ 순서 ' + order);
  ok(/95% 신뢰수준/.test(rep) && !/99% 신뢰수준/.test(rep) && /같은 값이 10번 반복/.test(rep) && /문항 자료가 없어/.test(rep) && /버전 0\.7\.0/.test(rep), '보고서 내용이 현재 분석과 일치(95%, 경고·신뢰도·버전)');
  ok(errs.length === 0, '페이지 오류 없음 ' + errs.join(' | '));
  console.log(`예외 상황 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(f => console.log(' -', f));
  await b.close();
})();
