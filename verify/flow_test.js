// 0.7.0 화면 흐름 점검: 빈 화면에서 시작, 새 단계 순서, 묶음 아래에서 바로 척도 만들기, 결과 바로가기, 글자 크기·화면 밝기, 기본값, 경계선 결과 알림
// 사용법: node flow_test.js <index.html 절대경로> [엑셀 읽기 라이브러리(xlsx.full.min.js) 경로] [시연용 엑셀 파일]
//  - 뒤의 두 인자를 주면 시연용 엑셀 파일로 한 번 더 점검함(테스트 환경에서 CDN이 막혀 있어 라이브러리 파일을 직접 넘겨줌)
const { chromium } = require('playwright'); const fs = require('fs');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html'), LIB = process.argv[3], XLS = process.argv[4];
let pass = 0; const fails = []; const ok = (c, w) => { if (c) pass++; else fails.push(w); };
// 문항 자료(가상): 묶음 3개(a 4문항, b 4문항, c 3문항) + 성별·연령
let seed = 77; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const N = 120, data = [];
for (let i = 1; i <= N; i++) {
  const t = rnd() * 4 + 1, r = () => Math.max(1, Math.min(5, Math.round(t + (rnd() - 0.5) * 2.4)));
  data.push([i, rnd() < 0.45 ? 1 : 2, 19 + Math.floor(rnd() * 8), r(), r(), r(), r(), r(), 6 - r(), r(), r(), r(), r(), r()]);
}
data[7][5] = ''; // a3 한 칸 비움 → 그 사례의 a 점수는 결측
const cols = ['id', 'gender', 'age', 'a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'c1', 'c2', 'c3'];
const CSV = '/tmp/flow_items.csv'; fs.writeFileSync(CSV, [cols.join(',')].concat(data.map(r => r.join(','))).join('\n'));
const meanOf = (row, idx, rev) => { const v = idx.map(j => row[j]); if (v.some(x => x === '')) return null; return v.reduce((a, x, k) => a + (rev.includes(idx[k]) ? 6 - x : x), 0) / v.length; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (LIB) await p.route('**/xlsx.full.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(LIB) }));
  await p.goto(URL); await p.waitForTimeout(800);
  const st = () => p.$eval('#results', e => e.dataset.status);
  const rtext = () => p.$eval('#results', e => e.innerText);
  const current = () => p.waitForFunction(() => document.getElementById('results').dataset.status === 'current', null, { timeout: 90000 });
  const run = async () => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running', null, { timeout: 90000 }); await p.waitForTimeout(150); return st(); };
  const caps = () => p.$$eval('#results .tablewrap caption', cs => cs.map(c => c.innerText.replace(/\n/g, ' ')));

  // ===== 1) 처음 화면: 결과 없이 안내만 =====
  ok((await st()) === 'idle' && (await p.$$('#results .tablewrap')).length === 0 && /이렇게 사용합니다/.test(await rtext()), '처음 열면 예시 결과 없이 사용 안내만 표시');
  ok(await p.$eval('#steps', e => e.classList.contains('nodata')) && /먼저 1에서 데이터를 불러와 주세요/.test(await p.$eval('#runHint', e => e.textContent)), '데이터가 없을 때 다음 단계는 흐리게, 실행 줄에 할 일 안내');
  const whole = await p.evaluate(() => document.body.innerText);
  ok(!/MVP|개발 중|개발중/.test(whole), "화면에 'MVP'·'개발 중' 문구 없음");
  const steps = await p.$$eval('.steps > section.step > h2', hs => hs.map(h => h.childNodes[0].textContent + ' ' + h.childNodes[1].textContent.trim()));
  ok(steps.join(' / ') === '1 데이터 불러오기 / 2 변수 정리 / 3 분석 모형과 변인 지정 / 4 분석 옵션 / 5 연구 정보', '단계 순서: ' + steps.join(' / '));
  const dflt = await p.evaluate(() => ({ seed: document.getElementById('oSeed').value, dec: document.getElementById('oDec').value, di: document.getElementById('oDecInd').value, vif: document.getElementById('xVif').checked, con: document.getElementById('xContrast').checked }));
  ok(dflt.seed === '11111' && dflt.dec === '3' && dflt.di === '3' && dflt.vif && dflt.con, '기본값: 시드 11111, 소수점 3자리, 추가 검정 2개 켬 ' + JSON.stringify(dflt));
  ok(await p.$eval('#run', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), '분석 실행 단추가 스크롤 없이 화면 아래에 보임');

  // ===== 2) 예시 보기 =====
  await p.click('#trySample'); await current(); await p.waitForTimeout(200);
  ok(/예시 데이터\(가상 자료 300명\)의 결과입니다/.test(await rtext()), '예시 결과임을 결과 위에 표시');
  ok(!(await p.$('#meaningNote')) && (await p.$eval('[data-codeval="gender|0"]', e => e.value)) === '남성', '예시 데이터는 값의 뜻이 채워져 있음');
  let cp = await caps();
  ok(cp.some(c => /다중공선성 확인/.test(c)) && cp.some(c => /간접효과 경로 간 차이 검증/.test(c)), '기본 설정에서 추가 검정 표 2개 포함');
  const nav = await p.$$eval('.rnav [data-jump]', bs => bs.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  ok(nav[0] === '분석 방법' && nav.includes('결과 서술') && nav.some(x => /^표 \d+ ?효과$/.test(x)) && nav.includes('그림 1') && nav[nav.length - 1] === '저장', '결과 바로가기 줄: ' + nav.join(' | '));
  const effId = await p.$$eval('.rnav [data-jump]', bs => bs.find(x => /효과$/.test(x.innerText.trim()) && !/조건부/.test(x.innerText)).dataset.jump);
  await p.click(`.rnav [data-jump="${effId}"]`); await p.waitForTimeout(300);
  const pos = await p.evaluate(id => ({ h: document.querySelector('#' + id + ' h3').getBoundingClientRect().top, top: document.querySelector('.rtop').getBoundingClientRect().bottom }), effId);
  ok(pos.h >= pos.top && pos.h < pos.top + 80, `바로가기를 누르면 효과 표 제목이 고정 줄 바로 아래에 옴 (제목 ${Math.round(pos.h)}px, 고정 줄 아래 ${Math.round(pos.top)}px)`);
  // 값의 뜻을 지우면 알림, 다시 적거나 체크를 빼면 사라짐
  await p.fill('[data-codeval="gender|1"]', ''); await p.waitForTimeout(500);
  ok(/값의 뜻이 비어 있는 변수: 성별/.test(await p.$eval('#meaningNote', e => e.innerText)) && await p.$eval('[data-codeval="gender|1"]', e => e.classList.contains('need')) && /코드 1 \d+명/.test(await p.$eval('#sampleBox', e => e.innerText)), "값의 뜻이 비면 결과 위 알림과 입력 칸 강조('코드 1'로 나오는 이유 안내)");
  await p.uncheck('[data-demo="gender"]'); await p.waitForTimeout(500);
  ok(!(await p.$('#meaningNote')) && !/코드 1/.test(await p.$eval('#sampleBox', e => e.innerText)), "'연구대상 특성' 체크를 빼면 알림과 문장에서 사라짐");
  await p.check('[data-demo="gender"]'); await p.fill('[data-codeval="gender|1"]', '여성'); await p.waitForTimeout(500);
  ok(!(await p.$('#meaningNote')) && /여성 \d+명/.test(await p.$eval('#sampleBox', e => e.innerText)) && (await st()) === 'current', '값의 뜻을 적으면 다시 분석하지 않아도 문장에 반영');
  // 추가 검정 끄기
  await p.uncheck('#xVif'); await p.uncheck('#xContrast'); await p.waitForTimeout(500); cp = await caps();
  ok(!cp.some(c => /다중공선성 확인|경로 간 차이/.test(c)) && (await st()) === 'current' && /간접효과 사이의 차이는 별도로 검정하지 않았으므로/.test(await p.$eval('#textBox', e => e.innerText)), '추가 검정을 끄면 표 2개가 빠지고 차이 미검정 안내 문장이 돌아옴(재분석 불필요)');
  await p.check('#xVif'); await p.check('#xContrast'); await p.waitForTimeout(400);
  // 넓게 보기
  await p.click('[data-wide]'); ok(await p.$eval('#steps', e => getComputedStyle(e).display === 'none') && /입력 칸 펼치기/.test(await p.$eval('[data-wide]', e => e.textContent)), '입력 칸 접기 → 결과만 넓게');
  await p.click('[data-wide]'); ok(await p.$eval('#steps', e => getComputedStyle(e).display !== 'none'), '입력 칸 펼치기');

  // ===== 3) 내 파일 올리기: 예시 결과가 남지 않음 =====
  await p.click('[data-wide]');
  await p.setInputFiles('#file', CSV); await p.waitForFunction(() => document.getElementById('dataInfo').innerText.includes('flow_items.csv')); await p.waitForTimeout(300);
  ok((await st()) === 'idle' && (await p.$$('#results .tablewrap')).length === 0 && !/예시 데이터/.test(await rtext()) && /데이터를 불러왔습니다/.test(await rtext()), '파일을 올리면 이전(예시) 결과가 남지 않음');
  ok(await p.$eval('#steps', e => getComputedStyle(e).display !== 'none'), '새 자료를 불러오면 접어 둔 입력 칸이 다시 펼쳐짐');
  ok(/2에서 척도 점수를 만들면 3에서 변인으로 고를 수 있습니다/.test(await p.$eval('#runHint', e => e.textContent)), '문항 자료: 실행 줄이 척도 만들기를 먼저 안내');
  // 예시 단추: 한 번 누르면 경고만, 자료는 그대로
  await p.click('#loadSample'); await p.waitForTimeout(200);
  ok(/한 번 더 눌러 주세요/.test(await p.$eval('#loadSample', e => e.textContent)) && /flow_items\.csv/.test(await p.$eval('#dataInfo', e => e.innerText)), '직접 올린 자료가 있으면 예시 단추를 한 번 눌러서는 지워지지 않음');
  await p.waitForTimeout(6300);
  ok(/예시 데이터로 살펴보기/.test(await p.$eval('#loadSample', e => e.textContent)), '잠시 뒤 단추 글자가 원래대로 돌아옴');

  // ===== 4) 묶음 바로 아래에서 척도 만들기 =====
  await p.click('[data-mkscale="a"]'); await p.waitForTimeout(150);
  let f = await p.evaluate(() => { const g = document.querySelector('.gform'), bt = document.querySelector('[data-mkscale="a"]'); return { g: g.dataset.gform, below: Math.round(g.getBoundingClientRect().top - bt.getBoundingClientRect().bottom), focus: document.activeElement.hasAttribute('data-glabel'), chips: Array.from(g.querySelectorAll('[data-grev] .chip')).map(c => c.innerText.trim()).join(), min: g.querySelector('[data-gmin]').value, max: g.querySelector('[data-gmax]').value }; });
  ok(f.g === 'a' && f.below >= 0 && f.below < 40 && f.focus && f.chips === '1,2,3,4' && f.min === '1' && f.max === '5', '입력 칸이 묶음 바로 아래에 열리고 이름 칸에 커서, 역문항은 번호로 선택 ' + JSON.stringify(f));
  await p.keyboard.type('척도가'); await p.click('[data-gmake="a"]'); await p.waitForTimeout(250);
  f = await p.evaluate(() => { const g = document.querySelector('.gform'); return g ? { g: g.dataset.gform, focus: document.activeElement.hasAttribute('data-glabel'), inView: (r => r.top >= 0 && r.bottom <= innerHeight)(g.querySelector('[data-gmake]').getBoundingClientRect()) } : null; });
  ok(f && f.g === 'b' && f.focus && f.inView, '만들면 다음 묶음의 입력 칸이 이어서 열림(스크롤 없이 계속 입력) ' + JSON.stringify(f));
  await p.keyboard.type('척도나'); await p.check('.gform [data-grev] input[value="b2"]'); await p.click('[data-gmake="b"]'); await p.waitForTimeout(250);
  await p.keyboard.type('척도다'); await p.click('[data-gmake="c"]'); await p.waitForTimeout(250);
  ok(!(await p.$('.gform')) && /척도 3개/.test(await p.$eval('#varSum', e => e.textContent)), '묶음 3개를 모두 만들면 입력 칸이 닫힘: ' + await p.$eval('#varSum', e => e.textContent));
  const og = await p.$$eval('#vX optgroup', gs => gs.map(g => g.label + ':' + Array.from(g.children).map(o => o.textContent).join(',')));
  ok(og.length === 2 && og[0] === '척도 점수:척도가 (a),척도나 (b),척도다 (c)' && /^그 밖의 변수:/.test(og[1]), '변인 목록을 척도 점수와 그 밖의 변수로 나눠 표시: ' + og.join(' / '));
  // 만든 점수가 따로 계산한 값과 같은지(역문항 b2 포함, 빈칸이 있는 사례는 결측)
  await p.click('input[value=simple]'); await p.selectOption('#vX', 'a'); await p.selectOption('#vM1', 'b'); await p.selectOption('#vY', 'c');
  ok(/단순매개 · 척도가 → 척도나 → 척도다/.test(await p.$eval('#runHint', e => e.textContent)), '실행 줄에 지정한 모형과 변인 순서 표시');
  ok((await run()) === 'current', '만든 척도로 단순매개 실행');
  const refA = data.map(r => meanOf(r, [3, 4, 5, 6], [])), refB = data.map(r => meanOf(r, [7, 8, 9, 10], [8]));
  const validA = refA.filter(v => v !== null), mA = validA.reduce((x, y) => x + y, 0) / validA.length;
  const rowsOK = data.filter((r, i) => refA[i] !== null), mB = rowsOK.map(r => meanOf(r, [7, 8, 9, 10], [8])).reduce((x, y) => x + y, 0) / rowsOK.length;
  const desc = await p.evaluate(() => { const w = Array.from(document.querySelectorAll('#results .tablewrap')).find(x => /기술통계 및 상관/.test(x.querySelector('caption').innerText)); return Array.from(w.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.innerText)); });
  const mRow = desc.find(r => /^M$|평균/.test(r[0])) || [];
  ok(new RegExp(`${N}명 중`).test(await p.$eval('#sampleBox', e => e.innerText)) && /1명/.test(await p.$eval('#sampleBox', e => e.innerText)) && mRow[1] === mA.toFixed(3) && mRow[2] === mB.toFixed(3), `척도 점수 평균이 따로 계산한 값과 같음(역문항·결측 처리 포함): 화면 ${mRow[1]}, ${mRow[2]} / 기준 ${mA.toFixed(3)}, ${mB.toFixed(3)}`);
  ok((await caps()).some(c => /다중공선성 확인/.test(c)) && !(await caps()).some(c => /경로 간 차이/.test(c)) && await p.$eval('#xContrast', e => e.disabled), '단순매개: 경로 간 차이 검증은 해당 없음으로 꺼짐');

  // ===== 5) 글자 크기 · 화면 밝기 =====
  await p.click('[data-zoom="1.3"]');
  ok((await p.$eval('#wrap', e => e.style.zoom)) === '1.3' && await p.$eval('[data-zoom="1.3"]', e => e.classList.contains('on')), '글자 크기: 더 크게');
  const before = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('#themeBtn');
  const after = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, t: document.documentElement.dataset.theme, label: document.getElementById('themeBtn').textContent }));
  ok(after.t === 'dark' && after.bg !== before && after.label === '밝은 화면', '화면 밝기 단추로 어두운 화면 전환 ' + JSON.stringify(after));
  await p.reload(); await p.waitForTimeout(600);
  ok((await p.$eval('#wrap', e => e.style.zoom)) === '1.3' && (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark', '글자 크기와 화면 밝기는 다시 열어도 유지');
  await p.click('#themeBtn'); await p.click('[data-zoom="1"]');
  ok((await p.evaluate(() => document.documentElement.dataset.theme)) === 'light' && (await p.$eval('#wrap', e => e.style.zoom)) === '', '밝은 화면·보통 크기로 되돌림');
  ok(errs.length === 0, '페이지 오류 없음 ' + errs.join(' | '));

  // ===== 6) 시연용 엑셀 파일 =====
  if (LIB && XLS) {
    await p.setInputFiles('#file', XLS); await p.waitForFunction(() => /사례 250명/.test(document.getElementById('dataInfo').innerText)); await p.waitForTimeout(300);
    ok((await p.$$eval('[data-codeval].need', els => els.length)) === 0 && (await p.$eval('[data-codeval="성별|1"]', e => e.value)) === '남자', '시연 파일: 코드북에서 값의 뜻이 채워져 비어 있는 칸 없음');
    await p.click('[data-cbmake]'); await p.waitForTimeout(600);
    const shown = await p.$$eval('#varList > .vrow [data-delscale]', bs => bs.length), sub = await p.$eval('#subsBox summary', e => e.innerText);
    ok(shown === 4 && /하위요인 점수 12개/.test(sub) && !(await p.$eval('#subsBox', e => e.open)), `코드북대로 만든 뒤 전체 점수 4개만 펼쳐 보이고 하위요인 12개는 접어 둠 (${shown}개 / ${sub.trim()})`);
    await p.click('input[value=serial]');
    const pick = async (id, name) => p.selectOption('#' + id, name);
    await pick('vX', '완벽주의적자기제시'); await pick('vM1', '사회불안관련자기신념'); await pick('vM2', '정서조절곤란'); await pick('vY', '사회불안');
    ok((await run()) === 'current', '시연 파일: 기본 설정 그대로 순차매개 실행');
    cp = await caps();
    ok(/^표 7 .*간접효과 부트스트래핑 결과/.test(cp[6]) && /^표 8 간접효과 경로 간 차이 검증/.test(cp[7]), '기본 설정에서 간접효과 표가 표 7, 경로 간 차이가 표 8: ' + cp.slice(6, 8).join(' | '));
    const sample = await p.$eval('#sampleBox', e => e.innerText);
    ok(/성별은 남자 117명\(46\.8%\), 여자 133명\(53\.2%\)/.test(sample) && !/코드 \d/.test(sample), '연구대상 문장에 값의 뜻이 그대로 쓰임(코드 숫자 없음)');
    const all = await rtext(), todo = (all.match(/\[작성 필요/g) || []).length;
    await p.fill('#rSample', '2026년 3~4월 대학생을 대상으로 온라인 설문을 실시하였다.'); await p.selectOption('#rDesign', 'cross'); await p.fill('#rHyp', '사회불안 관련 자기신념과 정서조절곤란은 완벽주의적 자기제시와 사회불안의 관계를 순차적으로 매개할 것이다'); await p.waitForTimeout(600);
    const todo2 = ((await rtext()).match(/\[작성 필요/g) || []).length;
    ok(todo === 3 && todo2 === 1 && (await st()) === 'current', `연구 정보를 적으면 [작성 필요]가 3곳 → 1곳으로 줄어듦(재분석 불필요): ${todo} → ${todo2}`);
    // 경계선 결과 알림: 시드 11111에서 C1의 하한이 0에 매우 가까움
    const con = await p.evaluate(() => { const w = Array.from(document.querySelectorAll('#results .tablewrap')).find(x => /간접효과 경로 간 차이 검증/.test(x.querySelector('caption').innerText)); return { rows: Array.from(w.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.innerText)), note: w.querySelector('.tnote').innerText }; });
    const text = await p.$eval('#textBox', e => e.innerText);
    ok(/^C1/.test(con.rows[0][0]) && Number(con.rows[0][3]) > 0 && Number(con.rows[0][3]) < 0.004, 'C1 신뢰구간 하한이 0에 매우 가까운 양수: ' + con.rows[0].join(' '));
    ok(/C1의 신뢰구간은 한쪽 한계값이 0에 매우 가까워, 부트스트랩 난수 시드나 반복 횟수에 따라 유의 판정이 달라질 수 있으므로 해석에 주의가 필요하다/.test(text) && /C1의 신뢰구간은 한쪽 한계값이 0에 매우 가까워/.test(con.note), '경계선 결과(C1)에 주의 문장과 표 주석이 붙음');
    ok(!/C[23](, C\d)*의 신뢰구간은 한쪽 한계값/.test(text) && !/경로 간접효과의 신뢰구간은 한쪽 한계값|총간접효과의 신뢰구간은 한쪽/.test(text), '경계선이 아닌 결과에는 주의 문장이 붙지 않음');
    await p.fill('#oSeed', '5000'); await run();
    const con2 = await p.evaluate(() => { const w = Array.from(document.querySelectorAll('#results .tablewrap')).find(x => /간접효과 경로 간 차이 검증/.test(x.querySelector('caption').innerText)); return Array.from(w.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.innerText))[0]; });
    ok(Number(con2[3].replace('−', '-')) < 0 && /C1의 신뢰구간은 한쪽 한계값이 0에 매우 가까워/.test(await p.$eval('#textBox', e => e.innerText)), '시드를 5000으로 바꾸면 C1 하한이 음수로 바뀌고(판정이 뒤집힘) 주의 문장은 그대로 붙음: ' + con2.join(' '));
    ok(errs.length === 0, '시연 파일 점검 중 페이지 오류 없음 ' + errs.join(' | '));
  }
  console.log(`화면 흐름 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(x => console.log(' -', x));
  // 모바일
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(URL); await m.waitForTimeout(600); await m.click('#trySample');
  await m.waitForFunction(() => document.getElementById('results').dataset.status === 'current'); await m.waitForTimeout(300);
  console.log('모바일 가로폭', await m.evaluate(() => document.documentElement.scrollWidth), '잘린 입력/버튼', await m.evaluate(() => Array.from(document.querySelectorAll('input,select,button,textarea')).filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.dataset.var || e.textContent.trim())));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
