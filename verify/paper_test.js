// 학술지 논문 형식(키논문 형식)·연구 정보 입력·데이터 지문 점검
const legacy = require('./boot.js');
const { chromium } = require('playwright'); const fs = require('fs');
const URL = 'file://' + (process.argv[2] || '/home/user/app/index.html');
let pass = 0; const fails = []; const ok = (c, w) => { if (c) pass++; else fails.push(w); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(800); await legacy(p);
  const st = () => p.$eval('#results', e => e.dataset.status);
  const run = async () => { await p.click('#run'); await p.waitForFunction(() => document.getElementById('results').dataset.status !== 'running'); await p.waitForTimeout(150); };
  const dl = async sel => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); return fs.readFileSync(await d.path(), 'utf8'); };
  // 표를 제목으로 찾아 {headers, rows} 로 읽음
  const table = re => p.evaluate(src => {
    const w = Array.from(document.querySelectorAll('.tablewrap')).find(x => new RegExp(src).test(x.querySelector('caption').innerText));
    if (!w) return null;
    return { no: w.querySelector('caption b').innerText, headers: Array.from(w.querySelectorAll('thead th')).map(t => t.innerText), rows: Array.from(w.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.innerText)), note: Array.from(w.querySelectorAll('.tnote')).map(n => n.innerText).join(' ') };
  }, re);
  const text = id => p.$eval(id, e => e.innerText);

  // ===== 순차매개(예시 데이터, 기본 = 학술지 논문 형식) =====
  ok((await p.$eval('#oStyle', e => e.value)) === 'paper', '기본 보고 형식 = 학술지 논문 형식');
  const reg = await table('순차매개효과$'), eff = await table('간접효과 부트스트래핑 결과$'), corr = await table('기술통계 및 상관계수');
  ok(JSON.stringify(reg.headers) === JSON.stringify(['종속변인', '예측변인', 'β', 'B', 'SE', 't', 'R²', '95% CI LL', '95% CI UL']), '회귀 표 열 구성(DV·IV·β·B·SE·t·R²·LL·UL): ' + reg.headers);
  ok(!reg.rows.some(r => r.includes('상수')) && reg.rows.length === 6, '상수 행 없음, 경로 6개');
  ok(/^\d+\.\d+\*{3}$/.test(reg.rows[0][5]) && /^\.\d\d$/.test(reg.rows[0][3]) && /^\.\d\d$/.test(reg.rows[0][6]), 't에 유의 표시, 앞자리 0 생략: ' + reg.rows[0]);
  ok(/B = 비표준화 계수.*β = 표준화 계수.*SE = 표준오차.*t = 검정통계량.*R² = 결정계수.*LL = 하한.*UL = 상한/.test(reg.note) && /\*p < \.05, \*\*p < \.01, \*\*\*p < \.001/.test(reg.note), '통계 기호·약어 주석과 유의 표시 주석');
  ok(JSON.stringify(eff.headers) === JSON.stringify(['경로', 'β', 'B', 'SE', '95% CI LL', '95% CI UL']), '효과 표 열 구성: ' + eff.headers);
  const labels = eff.rows.map(r => r[0]);
  ok(labels[0] === '총효과' && labels[1] === '직접효과' && labels[2] === '총간접효과' && /^간접효과1: 감정표현불능증 → 경험회피 → 심리적 고통$/.test(labels[3]) && /^간접효과2: 감정표현불능증 → 정서조절곤란 → 심리적 고통$/.test(labels[4]) && /^간접효과3: 감정표현불능증 → 경험회피 → 정서조절곤란 → 심리적 고통$/.test(labels[5]), '효과 표 행 순서와 변수 이름: ' + labels.join(' | '));
  ok(corr.rows.map(r => r[0]).slice(-6).join() === 'M,SD,최솟값,최댓값,왜도,첨도' && corr.rows[0][1] === '—', '표: 상관 + M·SD·최솟값·최댓값·왜도·첨도');
  // 본문
  const tx = await text('#textBox');
  ok(new RegExp(`표 ${reg.no.replace('표 ', '')}에 제시하였다`).test(tx) && new RegExp(`\\(표 ${eff.no.replace('표 ', '')}\\)`).test(tx) && /그림 1에 제시/.test(tx), '본문이 표·그림 번호를 참조');
  ok(!/SE = |t = /.test(tx) && /\(B = \.\d\d, p (< \.001|= \.\d+)\)/.test(tx) && /B = \.\d\d, 95% CI \[−?\.\d\d, \.\d\d\]/.test(tx), '본문 통계는 (B, p)·(B, CI)만');
  // 본문 수치 = 표 수치
  const b1 = (tx.match(/경험회피를 유의하게 정적으로 예측하였다\(B = (\.\d\d)/) || [])[1];
  ok(b1 && b1 === reg.rows[0][3], `본문 B(${b1}) = 표 B(${reg.rows[0][3]})`);
  const ind3 = (tx.match(/순차적으로 거쳐 심리적 고통으로 가는 간접효과는[^(]*\(B = (\.\d\d), 95% CI \[(−?\.\d\d), (\.\d\d)\]/) || []).slice(1);
  ok(ind3.length === 3 && ind3[0] === eff.rows[5][2] && ind3[1] === eff.rows[5][4] && ind3[2] === eff.rows[5][5], `순차 간접효과 본문(${ind3}) = 표(${[eff.rows[5][2], eff.rows[5][4], eff.rows[5][5]]})`);
  const all = await p.$eval('#results', e => e.textContent);
  ok(!/부분매개|완전매개/.test(all), '완전·부분매개 자동 판정 없음');
  ok(!/SPSS|PROCESS Macro/.test(await text('#methodBox')) && /모형분석 결과작성기/.test(await text('#methodBox')), '분석 방법에 실제 도구 표기(SPSS로 표기하지 않음)');
  ok(!/정규성 가정/.test(all) && /작성 필요: 왜도·첨도에 대한 판단 기준과 근거 문헌/.test(await text('#sampleBox')), '왜도·첨도로 정규성 자동 판정하지 않음');
  // 그림: 표준화 계수 + 비유의 경로 점선
  const svg = await p.$eval('.figbox svg', e => e.outerHTML);
  ok(/표준화 계수\(β\)/.test(svg) && /stroke-dasharray/.test(svg) && !/\(\.30\*\*\*\)/.test(svg), '그림: β 표기, 비유의 경로 점선, 괄호 총효과 없음');
  ok(/그림 1/.test(await p.$eval('.figcap', e => e.innerText)) && /순차매개효과/.test(await p.$eval('.figcap', e => e.innerText)), '그림 번호와 제목');

  // ===== 형식 전환: 재분석 없이 즉시 =====
  await p.selectOption('#oStyle', 'detail'); await p.waitForTimeout(500);
  ok((await st()) === 'current', '형식 변경은 재분석 불필요');
  const regD = await table('경로별 회귀계수');
  ok(regD && regD.headers.includes('p') && regD.rows.some(r => r.includes('상수')) && /SE = /.test(await text('#textBox')) && /B = 0\.\d\d/.test(await text('#textBox')), '상세 형식: p 열·상수·본문 SE, 앞자리 0 유지');
  await p.selectOption('#oStyle', 'paper'); await p.waitForTimeout(500);
  ok((await table('순차매개효과$')).rows[0][3] === reg.rows[0][3], '논문 형식으로 되돌리면 같은 값');

  // ===== 연구 정보 입력 =====
  let sm = await text('#sampleBox');
  ok(/작성 필요: 연구 대상, 표집 방법/.test(sm) && /작성 필요: 연구설계/.test(sm), '미입력 시 작성 필요 표시');
  await p.fill('#rSample', '2026년 3월 서울 소재 대학생 300명을 대상으로 온라인 설문을 실시하였다'); await p.selectOption('#rDesign', 'cross');
  await p.fill('#rHyp', '경험회피와 정서조절곤란은 감정표현불능증과 심리적 고통의 관계를 순차적으로 매개할 것이다'); await p.waitForTimeout(500);
  sm = await text('#sampleBox');
  ok((await st()) === 'current' && /2026년 3월 서울 소재 대학생 300명을 대상으로 온라인 설문을 실시하였다\./.test(sm) && /횡단 설문 설계/.test(sm) && !/작성 필요: 연구 대상/.test(sm) && !/작성 필요: 연구설계/.test(sm), '연구 대상·설계 입력이 문단에 반영(재분석 불필요)');
  ok(/연구가설\(경험회피와 정서조절곤란은/.test(await text('#textBox')), '연구가설이 결과 문단에 반영');
  // 공변인 + 근거 + 범주 코드
  await p.check('#covs input[value="gender"]'); await run();
  ok(/작성 필요: 공변인 선정 근거/.test(await text('#methodBox')), '공변인 근거 미입력 → 작성 필요');
  await p.fill('#rCov', '선행연구에서 성별 차이가 보고됨'); await p.fill('[data-codeval="gender|0"]', '남성'); await p.fill('[data-codeval="gender|1"]', '여성'); await p.waitForTimeout(500);
  ok(/선정 근거: 선행연구에서 성별 차이가 보고됨/.test(await text('#methodBox')), '공변인 근거 반영');
  const fq = await table('인구통계학적 특성');
  const gi = fq.rows.findIndex(r => r[0] === '성별');
  ok(gi >= 0 && fq.rows[gi][1] === '남성' && fq.rows[gi + 1][1] === '여성' && !/성별의 코드 의미/.test(fq.note) && !(await table('범주형 변인의 빈도')), '범주 값의 뜻이 연구대상 특성 표에 반영(빈도표 중복 없음): ' + fq.rows.map(r => r[1]).join(','));
  ok(/성별은 남성 \d+명\(\d+\.\d%\), 여성 \d+명/.test(await text('#sampleBox')) && /연령의 평균은 \d+\.\d\d\(SD = /.test(await text('#sampleBox')), '연구대상 특성 문장(성별 빈도, 연령 평균)');
  const rep = await dl('[data-report]');
  ok(/<h2>1\. 자료분석<\/h2>/.test(rep) && /<td>남성<\/td>/.test(rep) && /횡단 설문 설계/.test(rep) && /지문 [0-9a-f]{14}/.test(rep) && /<b>그림 1<\/b>/.test(rep), 'HTML 보고서에 형식·연구 정보·데이터 지문 반영');
  const csv = await dl(`[data-csv="${Number((await table('순차매개효과$')).no.replace('표 ', '')) - 1}"]`);
  ok(/종속변인,예측변인,β,B,SE,t,R²/.test(csv), 'CSV도 같은 열 구성');
  await p.click('[data-copytab="' + (Number((await table('간접효과 부트스트래핑 결과$')).no.replace('표 ', '')) - 1) + '"]'); await p.waitForTimeout(200);
  ok(/간접효과3: /.test(await p.evaluate(() => navigator.clipboard.readText())), '표 복사도 같은 내용');

  // ===== 이분 조절변인 코드 의미 =====
  await p.uncheck('#covs input[value="gender"]'); await p.click('input[value=moderation]');
  await p.selectOption('#vX', 'alex'); await p.selectOption('#vY', 'distress'); await p.selectOption('#vW', 'gender'); await run();
  ok(/성별 = 0\(남성\)일 때/.test(await text('#textBox')) && (await table('조건부 효과$')).rows[0][0] === '성별 = 0(남성)', '이분 조절변인 수준에 코드 의미 표시');
  const modReg = await table('의 조절효과$');
  ok(JSON.stringify(modReg.headers) === JSON.stringify(['종속변인', '예측변인', 'B', 'SE', 't', 'R²', '95% CI LL', '95% CI UL']) && /ΔR² = \.\d{3}/.test(modReg.note), '조절 회귀 표 열 구성과 ΔR² 주석');

  // ===== 데이터 지문 =====
  const j1 = JSON.parse(await dl('[data-settings]'));
  ok(j1.자료지문 && j1.자료지문.행수 === 300 && /^[0-9a-f]{14}$/.test(j1.자료지문.지문) && j1.출력설정.보고형식 === '학술지 논문 형식' && j1.출력설정.연구정보.design === 'cross', 'JSON에 데이터 지문·보고 형식·연구 정보 기록');
  await p.click('#loadSample'); await p.waitForFunction(() => document.getElementById('results').dataset.status === 'current'); await p.click('input[value=moderation]'); await p.selectOption('#vX', 'alex'); await p.selectOption('#vY', 'distress'); await p.selectOption('#vW', 'support'); await run();
  const j2 = JSON.parse(await dl('[data-settings]'));
  ok(j2.자료지문.지문 === j1.자료지문.지문, '같은 자료 → 같은 지문');
  fs.writeFileSync('/tmp/fp_test.csv', 'x,m,y\n' + Array.from({ length: 40 }, (_, i) => [i % 7, (i * 3) % 5 + i / 10, (i * 5) % 9 + i / 7].map(v => v.toFixed(2)).join(',')).join('\n'));
  await p.setInputFiles('#file', '/tmp/fp_test.csv'); await p.waitForTimeout(300);
  await p.click('input[value=simple]'); await p.selectOption('#vX', 'x'); await p.selectOption('#vM1', 'm'); await p.selectOption('#vY', 'y'); await run();
  const j3 = JSON.parse(await dl('[data-settings]'));
  ok(j3.자료지문.지문 !== j1.자료지문.지문 && j3.자료지문.행수 === 40, '다른 자료 → 다른 지문');
  ok(errs.length === 0, '페이지 오류 없음 ' + errs.join(' | '));
  console.log(`논문 형식·연구 정보 점검 ${pass + fails.length}개 중 통과 ${pass}, 실패 ${fails.length}`); fails.forEach(f => console.log(' -', f));
  // 모바일
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(URL); await m.waitForTimeout(800); await legacy(m);
  console.log('모바일 가로폭', await m.evaluate(() => document.documentElement.scrollWidth), '잘린 입력/버튼', await m.evaluate(() => Array.from(document.querySelectorAll('input,select,button,textarea')).filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.textContent.trim())));
  await b.close();
})();
