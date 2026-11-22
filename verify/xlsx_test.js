// 엑셀 파일 읽기 점검: 한글 열 이름 그대로 쓰기, 코드북 시트 반영, 코드북대로 척도 만들기
// 사용법: node xlsx_test.js <index.html 절대경로> <엑셀 읽기 라이브러리(xlsx.full.min.js) 경로> [참고 엑셀 파일]
//  - 테스트 환경에서 CDN이 막혀 있어 라이브러리 파일을 직접 넘겨줌(브라우저 요청을 이 파일로 대신 응답)
const legacy = require('./boot.js');
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html'), LIB = process.argv[3], REFX = process.argv[4];
const TMP = fs.mkdtempSync('/tmp/xlsxcase-');
execFileSync('python3', ['-I', path.join(__dirname, 'xlsx_cases.py'), TMP].concat(REFX ? [REFX] : []));
let pass = 0; const fails = []; const ok = (c, w) => { if (c) pass++; else fails.push(w); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const open = async () => { const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(LIB) }));
    await p.goto(URL); await p.waitForTimeout(800); await legacy(p, { sample: false }); return p; };
  const load = async (p, f) => { await p.setInputFiles('#file', f); await p.waitForFunction(n => document.getElementById('dataInfo').innerText.includes(n), path.basename(f)); await p.waitForTimeout(300); };
  const notes = p => p.$eval('#dataWarn', e => e.innerText);
  const codes = (p, v) => p.$$eval(`[data-codeval^="${v}|"]`, els => els.map(e => e.dataset.codeval.split('|')[1] + '=' + e.value).join(','));
  const st = p => p.$eval('#results', e => e.dataset.status);
  const run = async p => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running'); await p.waitForTimeout(200); return st(p); };
  const table = (p, re) => p.evaluate(src => { const w = Array.from(document.querySelectorAll('#results .tablewrap')).find(x => new RegExp(src).test(x.querySelector('caption').innerText)); return w ? Array.from(w.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.innerText)) : null; }, re);
  const dl = async (p, sel) => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); return fs.readFileSync(await d.path(), 'utf8'); };

  // ===== 1) 코드북이 첫 시트에 있어도 자료 시트를 찾아 읽음 =====
  let p = await open(); await load(p, TMP + '/cb_first.xlsx');
  let nt = await notes(p);
  ok(/시트 2개 중 '자료' 시트를 자료로 읽었습니다/.test(nt) && /'코드북' 시트를 코드북으로 읽어/.test(nt), '코드북이 첫 시트: 자료 시트를 찾아 읽음 — ' + nt.replace(/\n/g, ' '));
  ok((await codes(p, '성별')) === '1=남,2=여' && (await codes(p, '지역')) === '1=수도권,2=충청,3=영남', "값의 뜻 자동 채움('1: 남; 2: 여' 형식 포함): " + await codes(p, '성별') + ' / ' + await codes(p, '지역'));
  ok((await p.$eval('input[data-var="성별"]', e => e.value)) === '성별' && (await p.$eval('input[data-var="점수"]', e => e.value)) === '점수', '한글 열 이름이 논문에 쓸 이름 칸에 그대로 채워짐');
  ok((await p.$eval('input[data-var="ID"]', e => e.value)) === '', '영문 열 이름은 비워 두고 입력을 기다림');
  ok(/4문항 · 코드북 응답 1~5 · 역문항 1개/.test(await p.$eval('#varList', e => e.innerText)), '문항 묶음에 코드북의 응답 범위·역문항 수 표시');
  await p.click('[data-mkscale="q"]');
  const pre = await p.evaluate(() => { const f = document.querySelector('.gform'); return { rev: Array.from(f.querySelectorAll('[data-grev] input:checked')).map(i => i.value).join(), min: f.querySelector('[data-gmin]').value, max: f.querySelector('[data-gmax]').value, msg: f.querySelector('.hint').innerText }; });
  ok(pre.rev === 'q2' && pre.min === '1' && pre.max === '5' && /코드북 시트의 응답 범위 1~5와 역문항 1개를 채웠습니다/.test(pre.msg), '척도 만들기: 코드북의 역문항·응답 범위가 채워짐 ' + JSON.stringify(pre).slice(0, 110));
  await p.click('[data-cbmake]'); await p.waitForTimeout(300);
  ok(/만든 척도 점수/.test(await p.$eval('#varList', e => e.innerText)) && /4문항 평균 · 역채점 q2 \(1\+5−응답\)/.test(await p.$eval('#varList', e => e.innerText)) && !(await p.$('[data-cbmake]')), '코드북대로 모두 만들기 → 척도 생성, 버튼 사라짐');
  ok(!(await p.$$eval('#vX option', os => os.map(o => o.value))).includes('r1'), '문항 묶음 안의 문항은 역할 목록에 나오지 않음');
  await p.click('input[value=simple]'); await p.selectOption('#vX', '지역'); await p.selectOption('#vM1', 'q'); await p.selectOption('#vY', '점수');
  let s = await run(p);
  ok(s === 'failed' && /3개 이상인 범주형/.test(await p.$eval('#runMsg', e => e.innerText)), '코드북으로 범주형이 된 지역(3범주)을 독립변인으로 쓰면 차단');
  await p.selectOption('#vX', 'q'); await p.selectOption('#vM1', '점수'); await p.selectOption('#vY', '점수');
  await p.selectOption('#vM1', ''); 
  await p.close();

  // ===== 2) 변수 이름이 맞지 않는 코드북은 쓰지 않음 / 3) 코드북 없는 여러 시트 =====
  p = await open(); await load(p, TMP + '/cb_nomatch.xlsx'); nt = await notes(p);
  ok(!/코드북으로 읽어/.test(nt) && (await codes(p, '성별')) === '1=,2=', '변수 이름이 맞지 않는 코드북은 반영하지 않음');
  await load(p, TMP + '/no_cb.xlsx'); nt = await notes(p);
  ok(/시트 2개 중 '자료' 시트를 자료로 읽었습니다/.test(nt) && !/코드북/.test(nt) && !(await p.$('[data-cbmake]')), '코드북이 없으면 시트 안내만 표시');
  // ===== 4) 응답 범위가 문항마다 다른 척도는 건너뛰고 알림 =====
  await load(p, TMP + '/cb_range.xlsx');
  ok(/4문항 · 관찰된 응답/.test(await p.$eval('#varList', e => e.innerText)), '범위가 일치하지 않는 척도는 코드북 범위를 쓰지 않고 관찰값으로 표시');
  await p.click('[data-cbmake]'); await p.waitForTimeout(300);
  const m4 = await p.$eval('#cbMsg', e => e.innerText), v4 = await p.$eval('#varList', e => e.innerText);
  ok(/만들지 못한 척도: q\(응답 범위가 문항마다 다르거나 없음\)/.test(m4) && /3문항 평균 · 역채점 없음/.test(v4) && await p.$eval('#cbMsg', e => e.offsetParent !== null), '범위가 다른 척도는 건너뛰고 이유를 화면에 보이게 알림, 나머지는 생성: ' + m4);
  ok(p.errs.length === 0, '페이지 오류 없음 ' + p.errs.join(' | '));
  await p.close();

  // ===== 5) 실제 참고 파일(문항 88개, 코드북, 재현검증 시트) =====
  if (REFX) {
    const ref = JSON.parse(fs.readFileSync(TMP + '/ref.json', 'utf8'));
    p = await open(); await load(p, REFX); nt = await notes(p);
    ok(/시트 5개 중 '가상원자료' 시트를 자료로 읽었습니다/.test(nt) && /변수 3개의 값의 뜻과 척도 4개\(문항 88개\)의 응답 범위·역문항을 가져왔습니다/.test(nt), '참고 파일 안내: ' + nt.replace(/\n/g, ' '));
    ok((await codes(p, '성별')) === '1=남자,2=여자' && (await codes(p, '학년')) === '1=1학년,2=2학년,3=3학년,4=4학년', "값의 뜻: '1 = 1학년 … 4 = 4학년'의 가운데도 채움 — " + await codes(p, '학년'));
    ok((await codes(p, '전공계열')) === '1=인문사회,2=경상,3=사범,4=자연공학,5=의학보건,6=예체능,7=기타' && (await p.$eval('[data-vtype="전공계열"]', e => e.value)) === 'categorical', '전공계열(값 7개)이 코드북 덕분에 범주형으로 잡힘');
    await p.click('[data-cbmake]'); await p.waitForTimeout(800); await p.click('#subsBox summary');
    const vl = await p.$eval('#varList', e => e.innerText);
    ok((vl.match(/Cronbach α = /g) || []).length === 16, '코드북대로 척도 16개 생성(전체 4 + 하위요인 12): ' + (vl.match(/Cronbach α = /g) || []).length);
    // 신뢰도: 화면의 α(소수 둘째 자리)가 참고 시트 값과 같은지
    const ours = await p.$$eval('#varList .vrow', rows => rows.filter(r => /Cronbach α/.test(r.innerText)).map(r => [r.querySelector('code').textContent, (r.innerText.match(/Cronbach α = (\.\d\d)/) || [])[1]]));
    const map = { PSPS: '완벽주의적자기제시', SBSA: '사회불안관련자기신념', DERS: '정서조절곤란', SIAS: '사회불안' };
    const bad = Object.keys(ref.alpha).filter(k => { const [code, ...rest] = k.split(' '); const sub = rest.join(' '); const name = sub === '전체' ? map[code] : map[code] + '_' + sub; const o = ours.find(x => x[0] === name); return !o || o[1] !== Number(ref.alpha[k]).toFixed(2).replace(/^0/, ''); });
    ok(bad.length === 0, '신뢰도 16개가 참고 시트 값과 일치(소수 둘째 자리)' + (bad.length ? ' — 불일치: ' + bad.join(', ') : ''));
    await p.click('input[value=serial]');
    await p.selectOption('#vX', '완벽주의적자기제시'); await p.selectOption('#vM1', '사회불안관련자기신념'); await p.selectOption('#vM2', '정서조절곤란'); await p.selectOption('#vY', '사회불안');
    await p.selectOption('#oDec', '3'); await p.selectOption('#oDecInd', '4');
    ok((await run(p)) === 'current', '순차매개 실행');
    const reg = await table(p, '순차매개효과$'), eff = await table(p, '간접효과 부트스트래핑 결과$'), cd = await table(p, '기술통계 및 상관계수'), dm = await table(p, '인구통계학적 특성'), rel = await table(p, '신뢰도');
    const f3 = v => Number(v).toFixed(3).replace(/^(-?)0\./, '$1.');
    ok(reg[0][3] === f3(ref.b_x_m1) && reg[5][3] === f3(ref.b_m2_y), `경로계수 B가 참고 시트와 일치: ${reg[0][3]} = ${f3(ref.b_x_m1)}, ${reg[5][3]} = ${f3(ref.b_m2_y)}`);
    const serialRow = eff.find(r => /사회불안관련자기신념 → 정서조절곤란 → 사회불안$/.test(r[0]));
    ok(serialRow && serialRow[2] === Number(ref.ind_serial).toFixed(4).replace(/^0\./, '.'), `순차 간접효과가 참고 시트와 일치: ${serialRow && serialRow[2]} = ${Number(ref.ind_serial).toFixed(4)}`);
    const mRow = cd.find(r => r[0] === 'M'), sRow = cd.find(r => r[0] === 'SD');
    ok(mRow.slice(1).join() === ref.mean.map(v => Number(v).toFixed(3)).join() && sRow.slice(1).join() === ref.sd.map(v => Number(v).toFixed(3).replace(/^0\./, '.')).join(), '척도 평균·표준편차가 참고 시트와 일치: ' + mRow.slice(1).join());
    ok(dm.some(r => r[1] === '남자' && r[2] === '117') && dm.some(r => r[1] === '2학년' && r[2] === '98') && dm.some(r => r[1] === '인문사회' && r[2] === '75'), '연구대상 특성 표에 코드북의 값 이름과 빈도(남자 117, 2학년 98, 인문사회 75)');
    ok(rel.length === 16 && rel.filter(r => /하위요인·기타/.test(r[0])).length === 12, '신뢰도 표: 모형 변인 4개 + 하위요인 12개');
    const tx = await p.$eval('#textBox', e => e.innerText);
    ok(/완벽주의적자기제시는 사회불안관련자기신념을 유의하게 정적으로 예측하였다/.test(tx), '결과 문장에 엑셀의 이름이 그대로 쓰임');
    const js = JSON.parse(await dl(p, '[data-settings]'));
    ok(js.자료시트 === '가상원자료' && js.코드북시트 === '코드북' && js.문항점수.length === 16 && js.자료지문.행수 === 250, '분석 기록에 자료 시트·코드북 시트·척도 16개 기록');
    const rep = await dl(p, '[data-report]');
    ok(/정서조절곤란_정서에 대한 주의\/자각 부족|정서에 대한 주의\/자각 부족/.test(rep) && /<td>남자<\/td>/.test(rep), "HTML 보고서: '/'와 띄어쓰기가 있는 이름도 정상 출력");
    ok(p.errs.length === 0, '페이지 오류 없음 ' + p.errs.join(' | '));
    await p.evaluate(() => window.scrollTo(0, 0));
    await (await p.$('.steps')).screenshot({ path: '/home/user/verify/design/xlsx_steps.png' });
  }
  console.log(`엑셀·코드북 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(f => console.log(' -', f));
  await b.close();
})();
