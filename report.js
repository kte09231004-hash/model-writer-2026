/*
 * 결과 보고 모듈: 계산 결과(engine.js 출력) → 논문용 표, 모형 그림(SVG), 한국어 결과 서술 초안
 * 숫자는 모두 계산 결과에서 그대로 가져오며, 문장은 미리 정한 문장 틀에 값만 채움.
 */
(function (root) {
  'use strict';

  // ---------- 숫자 형식 (APA 양식) ----------
  // 보고 형식: 'paper' = 학술지 논문 형식(1 미만 값의 앞자리 0 생략, 본문은 B·p 중심, 표에 상세), 'detail' = 상세 형식
  const ST = { paper: false };
  function setStyle(style) { ST.paper = style === 'paper'; }
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    let s = Number(v).toFixed(d);
    if (/^-0\.?0*$/.test(s)) s = s.slice(1); // -0.00 → 0.00
    s = s.replace('-', '−');
    return ST.paper ? s.replace(/^(−?)0\./, '$1.') : s;
  }
  // 백분율은 형식과 무관하게 앞자리 0을 유지
  function pc(v) { return Number(v).toFixed(1) + '%'; }
  const SYM = 'B = 비표준화 계수, β = 표준화 계수, SE = 표준오차, t = 검정통계량, R² = 결정계수, CI = 신뢰구간(Confidence interval), LL = 하한(Lower limit), UL = 상한(Upper limit).';
  const STAR = '*p < .05, **p < .01, ***p < .001.';
  // 1을 넘을 수 없는 값(p, R² 등)은 앞자리 0 생략
  function noLead(v, d) { return num(v, d).replace(/^(−?)0\./, '$1.'); }
  function pDigits(p) {
    const r3 = Number(p.toFixed(3));
    return [0.10, 0.05, 0.01].some(c => (p < c) !== (r3 < c)) ? 4 : 3;
  }
  function pStr(p) { return p < 0.001 ? '< .001' : '= ' + noLead(p, pDigits(p)); }
  function pCell(p) { return p < 0.001 ? '< .001' : noLead(p, pDigits(p)); }
  // 숫자 뒤 서술격 조사: 마지막 숫자 읽기의 받침 여부(0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔)
  function numCop(str) { return str + ('013678'.includes(String(str).replace(/[^0-9]/g, '').slice(-1)) ? '이었다' : '였다'); }
  function stars(p) { return p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : ''; }
  function ci(lo, hi, d) { return '[' + num(lo, d) + ', ' + num(hi, d) + ']'; }

  const isHC3 = res => res.spec.se === 'hc3';
  const seNote = res => isHC3(res) ? ' SE는 HC3 이분산 일치(강건) 표준오차이며, t·p·신뢰구간도 이를 기준으로 산출함.' : ' SE는 일반 OLS 표준오차임.';
  const HC_REF = 'Hayes, A. F., & Cai, L. (2007). Using heteroskedasticity-consistent standard error estimators in OLS regression: An introduction and software implementation. Behavior Research Methods, 39(4), 709–722.';

  // ---------- 한국어 조사 ----------
  function hasBatchim(word) {
    const ch = String(word).replace(/\s*\([^()]*\)\s*$/, '').trim().slice(-1), code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28;
    return null; // 한글이 아니면 판단 불가
  }
  function josa(word, pair) {
    const [a, b] = pair.split('/'); // 받침 있을 때 / 없을 때
    const j = hasBatchim(word);
    if (j === null) return word + a + '(' + b + ')';
    if (pair === '으로/로') return word + (j === 0 || j === 8 ? '로' : '으로');
    return word + (j ? a : b);
  }
  const EUN = '은/는', I = '이/가', EUL = '을/를', WA = '과/와', RO = '으로/로';

  function nameOf(labels, v) { return (labels && labels[v]) || v; }
  function joinKo(arr) {
    if (arr.length <= 1) return arr.join('');
    return arr.slice(0, -1).map(s => s).join(', ') + ', ' + arr[arr.length - 1];
  }

  const MODEL_INFO = {
    simple: { title: '단순매개모형', hayes: '모형 4' },
    serial: { title: '순차매개모형', hayes: '모형 6' },
    moderation: { title: '조절모형', hayes: '모형 1' }
  };
  const HAYES_REF = 'Hayes, A. F. (2022). Introduction to mediation, moderation, and conditional process analysis: A regression-based approach (3rd ed.). Guilford Press.';

  // ---------- 분석 방법 설명 ----------
  // 분석 방법 문단을 공통 부분·모형 부분·부트스트랩 문장으로 나눔(여러 분석을 한 보고서로 묶을 때 공통 부분은 한 번만 씀)
  function methodParts(res, opt, basic) {
    const L = opt.labels, tool = opt.toolName || '웹 기반 분석 도구';
    const s = res.spec, info = MODEL_INFO[res.model], conf = Math.round(s.conf * 100);
    const rinfo = opt.info || {};
    const covTxt = s.covariates.length ? josa(joinKo(s.covariates.map(c => nameOf(L, c))), EUL) + ' 공변인으로 모든 회귀식에 투입하였다' + (rinfo.covWhy && rinfo.covWhy.trim() ? `(선정 근거: ${rinfo.covWhy.trim().replace(/[.。]$/, '')}). ` : `. ${TODO('공변인 선정 근거')} `) : '';
    const miss = res.sample.dropped ? `분석 변인에 결측치가 있는 ${res.sample.dropped}명은 목록별 삭제하여 최종 ${res.sample.n}명의 자료를 분석하였다. ` : `최종 ${res.sample.n}명의 자료를 분석하였다. `;
    let common = `자료 분석에는 ${josa(tool, EUL)} 사용하였다${opt.version ? `(버전 ${opt.version})` : ''}. `;
    if (!basic) common += miss;
    else {
      if (basic.demo && basic.demo.length && (opt.demo || []).some(v => basic.demo.find(x => x.name === v))) common += '연구대상의 인구통계학적 특성은 빈도와 기술통계로 정리하였다. ';
      common += '주요 변인의 기술통계와 Pearson 상관계수를 산출하였다. ';
      if (basic.reliability.some(r => r.available)) common += "척도 점수의 내적 일관성 신뢰도는 Cronbach's α로 확인하였다. ";
      if (res.diagnostics) common += XO(opt).vif
        ? `각 회귀식의 예측변인 간 다중공선성은 공차(tolerance)와 분산팽창계수(VIF)로 확인하였으며, VIF ${vifCut(opt)} 이상(공차 ${noLead(1 / vifCut(opt), 2)} 이하)을 검토 기준으로 삼았다. `
        : '각 회귀식의 예측변인 간 다중공선성은 분산팽창계수(VIF)로 점검하였다. ';
    }
    let t = '', boot = '';
    if (res.model !== 'moderation') {
      const meds = s.mediators.map(m => nameOf(L, m));
      t += `${josa(nameOf(L, s.x), WA)} ${nameOf(L, s.y)}의 관계에서 ${res.model === 'simple' ? meds[0] : joinKo(meds) + '(순서대로)'}의 ${res.model === 'simple' ? '' : '순차적 '}매개효과를 검증하기 위해, Hayes(2022)의 ${info.hayes}에 해당하는 구조로 최소제곱(OLS) 회귀분석을 실시하였다. ${covTxt}`;
      t += isHC3(res) ? '회귀계수의 표준오차와 이를 이용한 검정·신뢰구간은 HC3 이분산 일치 표준오차로 산출하였다(Hayes & Cai, 2007). ' : '';
      if (s.boot > 0) boot = `간접효과의 유의성은 ${s.boot.toLocaleString()}회의 부트스트랩 재표집(난수 시드 = ${s.seed})으로 산출한 ${conf}% 백분위수 신뢰구간으로 검증하였으며, 신뢰구간에 0이 포함되지 않으면 간접효과가 유의한 것으로 판단하였다.`;
    } else {
      t += `${josa(nameOf(L, s.x), WA)} ${nameOf(L, s.y)}의 관계에서 ${nameOf(L, s.w)}의 조절효과를 검증하기 위해, Hayes(2022)의 ${info.hayes}에 해당하는 구조로 최소제곱(OLS) 회귀분석을 실시하였다. ${covTxt}`;
      if (isHC3(res)) t += '회귀계수, 조건부 효과와 Johnson-Neyman 경계값의 표준오차는 HC3 이분산 일치 표준오차로 산출하였다(Hayes & Cai, 2007). ';
      if (s.center === 'mean') t += `상호작용항은 ${josa(nameOf(L, s.x), WA)} ${josa(nameOf(L, s.w), EUL)} 평균중심화한 뒤 곱하여 생성하였다. `;
      else t += `상호작용항은 ${josa(nameOf(L, s.x), WA)} ${nameOf(L, s.w)}의 원점수를 곱하여 생성하였다(중심화하지 않음). `;
      if (s.probe === 'binary') t += `조절변인이 두 값을 가지는 변인이므로 각 값에서 ${nameOf(L, s.x)}의 조건부 효과를 산출하였다.`;
      else {
        t += `조건부 효과는 ${nameOf(L, s.w)}의 ${s.probe === 'meansd' ? '평균 및 평균 ±1 표준편차' : '16번째, 50번째, 84번째 백분위수'}에서 산출하였다.`;
        const jn = res.jn;
        if (jn && ['all_sig', 'none_sig', 'changes'].includes(jn.status)) t += ` 또한 Johnson-Neyman 방법으로 ${conf}% 신뢰수준에서 ${nameOf(L, s.x)}의 조건부 효과의 유의성이 바뀌는 ${nameOf(L, s.w)} 값을 산출하였다.`;
        else if (jn && jn.status === 'failed') t += ` Johnson-Neyman 경계값 산출을 시도하였으나 수치 문제로 산출하지 못하였다.`;
      }
    }
    return { common, model: t.trim(), boot, extra: extraMethod(res, opt) };
  }
  function methodText(res, opt, basic) {
    const m = methodParts(res, opt, basic);
    return (m.common + m.model + (m.boot ? ' ' + m.boot : '') + (m.extra.length ? ' ' + m.extra.join(' ') : '')).trim();
  }

  // ---------- 표 ----------
  // 표 객체: {title, headers, rows:[[...]], note}
  // 간접 경로 표시 순서(논문 형식): 매개변인 1개 경로 먼저, 그다음 순차 경로
  function orderedRoutes(res) {
    const r = res.indirect.filter(x => x.route);
    return ST.paper ? r.slice().sort((a, b) => a.route.length - b.route.length) : r;
  }
  function medTitle(res, L) {
    const s = res.spec, ms = s.mediators.map(m => nameOf(L, m));
    return ms.length === 1 ? `${ms[0]}의 단순매개효과` : `${ms.length === 2 ? josa(ms[0], WA) + ' ' + ms[1] : ms.join(', ')}의 순차매개효과`;
  }
  function mediationTablesPaper(res, opt) {
    const L = opt.labels, d = opt.dec, di = opt.decInd, conf = Math.round(res.spec.conf * 100), s = res.spec;
    const X = nameOf(L, s.x), Y = nameOf(L, s.y), k = s.mediators.length;
    const rows = [];
    res.equations.forEach(eq => {
      const f = eq.fit;
      eq.predictors.forEach((p, j) => { const r = f.rows[j + 1];
        rows.push([j === 0 ? nameOf(L, eq.outcome) : '', nameOf(L, p), num(r.beta, d), num(r.b, d), num(r.se, d), num(r.t, d) + stars(r.p), j === 0 ? noLead(f.r2, d) : '', num(r.llci, d), num(r.ulci, d)]); });
    });
    const fnote = res.equations.map(eq => `${nameOf(L, eq.outcome)} F(${eq.fit.df1}, ${eq.fit.df2}) = ${num(eq.fit.F, d)}, p ${pStr(eq.fit.pF)}`).join('; ');
    const t1 = { key: 'reg', title: `${josa(X, WA)} ${Y}의 관계에서 ${medTitle(res, L)}`,
      headers: ['종속변인', '예측변인', 'β', 'B', 'SE', 't', 'R²', `${conf}% CI LL`, `${conf}% CI UL`], rows,
      note: `N = ${res.sample.n}. ${SYM}${seNote(res)} 회귀식의 ${isHC3(res) ? 'HC3 기반 Wald ' : ''}F 검정: ${fnote}.`, stars: STAR };
    const e = [];
    e.push(['총효과', num(res.total.std, d), num(res.total.b, di), num(res.total.se, di), num(res.total.llci, di), num(res.total.ulci, di)]);
    e.push(['직접효과', num(res.direct.std, d), num(res.direct.b, di), num(res.direct.se, di), num(res.direct.llci, di), num(res.direct.ulci, di)]);
    const tot = res.indirect.find(r => !r.route);
    if (tot) e.push(['총간접효과', num(tot.std, d), num(tot.effect, di), num(tot.bootSE, di), num(tot.llci, di), num(tot.ulci, di)]);
    const routes = orderedRoutes(res);
    routes.forEach((r, i) => e.push([`간접효과${routes.length > 1 ? i + 1 : ''}: ${r.route.map(v => nameOf(L, v)).join(' → ')}`, num(r.std, d), num(r.effect, di), num(r.bootSE, di), num(r.llci, di), num(r.ulci, di)]));
    const t2 = { key: 'eff', title: `${k === 1 ? nameOf(L, s.mediators[0]) : (k === 2 ? josa(nameOf(L, s.mediators[0]), WA) + ' ' + nameOf(L, s.mediators[1]) : s.mediators.map(m => nameOf(L, m)).join(', '))}의 간접효과 부트스트래핑 결과`,
      headers: ['경로', 'β', 'B', 'SE', `${conf}% CI LL`, `${conf}% CI UL`], rows: e,
      note: `B = 비표준화 효과, β = 표준화 효과(간접효과는 X와 Y의 표준편차로 표준화한 완전 표준화 간접효과), SE = 표준오차, CI = 신뢰구간, LL = 하한, UL = 상한. 총효과·직접효과의 SE와 신뢰구간은 회귀분석 결과(${isHC3(res) ? 'HC3 강건 표준오차' : '일반 OLS 표준오차'})이며, 간접효과의 SE와 신뢰구간은 ${res.spec.boot.toLocaleString()}회 부트스트래핑(난수 시드 = ${res.spec.seed})의 백분위수 방법으로 산출함. 신뢰구간에 0이 포함되지 않으면 유의한 것으로 판단함.` };
    return [t1, t2];
  }
  function moderationTablesPaper(res, opt) {
    const L = opt.labels, d = opt.dec, conf = Math.round(res.spec.conf * 100), f = res.equation.fit, s = res.spec;
    const X = nameOf(L, s.x), W = nameOf(L, s.w), Y = nameOf(L, s.y), intName = s.x + ' × ' + s.w;
    const label = n => n === intName ? `${X} × ${W}` : nameOf(L, n);
    const rows = f.rows.slice(1).map((r, j) => [j === 0 ? Y : '', label(r.name), num(r.b, d), num(r.se, d), num(r.t, d) + stars(r.p), j === 0 ? noLead(f.r2, d) : '', num(r.llci, d), num(r.ulci, d)]);
    const t1 = { key: 'reg', title: `${josa(X, WA)} ${Y}의 관계에서 ${W}의 조절효과`,
      headers: ['종속변인', '예측변인', 'B', 'SE', 't', 'R²', `${conf}% CI LL`, `${conf}% CI UL`], rows,
      note: `N = ${res.sample.n}. ${SYM.replace('β = 표준화 계수, ', '')}${seNote(res)} 회귀식 ${isHC3(res) ? 'HC3 기반 Wald ' : ''}F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)}. 상호작용항 추가에 따른 ΔR² = ${noLead(res.change.dR2, 3)}, ${isHC3(res) ? 'HC3 기반 ' : ''}F(1, ${res.change.df2}) = ${num(res.change.F, d)}, p ${pStr(res.change.p)}.` +
        (s.center === 'mean' ? ` ${josa(X, WA)} ${josa(W, EUN)} 평균중심화함.` : ` ${josa(X, WA)} ${josa(W, EUN)} 원점수를 사용함.`), stars: STAR };
    const cRows = res.conditional.map(c => [
      s.probe === 'binary' ? `${W} = ${codeLabel(opt, s.w, c.wRaw)}` : `${c.label} (${W} = ${num(c.wRaw, d)}${s.center === 'mean' ? `, 중심화 값 ${num(c.w, d)}` : ''})`,
      num(c.effect, d), num(c.se, d), num(c.t, d) + stars(c.p), num(c.llci, d), num(c.ulci, d)]);
    const t2 = { key: 'cond', title: `${W} 수준에 따른 ${X}의 조건부 효과`, headers: [`${W} 수준`, 'B', 'SE', 't', `${conf}% CI LL`, `${conf}% CI UL`], rows: cRows,
      note: `B = ${W}의 해당 수준에서 ${josa(X, I)} ${josa(Y, EUL)} 예측하는 비표준화 계수(조건부 효과), SE = 표준오차, CI = 신뢰구간, LL = 하한, UL = 상한.` + (s.center === 'mean' ? ` ${W} 값은 원점수이며 괄호 안은 분석에 사용한 평균중심화 값임.` : '') + seNote(res), stars: STAR };
    return [t1, t2];
  }
  // 범주형 변수의 코드 의미(사용자 입력 "0 = 남성, 1 = 여성")
  function codeMap(opt, v) {
    const txt = opt.info && opt.info.codes && opt.info.codes[v]; const m = {};
    if (txt && typeof txt === 'object') { Object.keys(txt).forEach(k => { if (String(txt[k]).trim()) m[Number(k)] = String(txt[k]).trim(); }); return m; }
    if (txt) String(txt).replace(/(-?\d+(?:\.\d+)?)\s*[=:]\s*([^,;]+)/g, (_, k, lab) => { m[Number(k)] = lab.trim(); return ''; });
    return m;
  }
  function codeLabel(opt, v, value) { const m = codeMap(opt, v); return m[value] != null ? `${value}(${m[value]})` : String(value); }

  function mediationTables(res, opt) {
    if (ST.paper) return mediationTablesPaper(res, opt);
    const L = opt.labels, d = opt.dec, di = opt.decInd, conf = Math.round(res.spec.conf * 100);
    const rows = [];
    res.equations.forEach(eq => {
      const f = eq.fit;
      f.rows.forEach((r, j) => {
        rows.push([j === 0 ? nameOf(L, eq.outcome) : '', nameOf(L, r.name), num(r.b, d), num(r.se, d), j === 0 ? '' : num(r.beta, d), num(r.t, d), pCell(r.p), ci(r.llci, r.ulci, d)]);
      });
      rows.push(['', `R² = ${noLead(f.r2, d)}, F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)}`, '', '', '', '', '', '']);
    });
    const t1 = {
      key: 'reg', title: `경로별 회귀계수 (N = ${res.sample.n})`,
      headers: ['종속변인', '예측변인', 'B', 'SE', 'β', 't', 'p', `${conf}% CI`],
      rows,
      note: 'B = 비표준화 계수, β = 표준화 계수, SE = 표준오차, t = 검정통계량, p = 유의확률, CI = 신뢰구간, R² = 결정계수, F = 회귀식 검정통계량.' + seNote(res) + (isHC3(res) ? ' 회귀식 F는 HC3 기반 Wald 검정임.' : '')
    };
    const eRows = [];
    const route = r => r.route ? r.route.map(v => nameOf(L, v)).join(' → ') : '총간접효과';
    eRows.push(['총효과', `${nameOf(L, res.spec.x)} → ${nameOf(L, res.spec.y)}`, num(res.total.b, di), num(res.total.se, di), ci(res.total.llci, res.total.ulci, di), num(res.total.std, di)]);
    eRows.push(['직접효과', `${nameOf(L, res.spec.x)} → ${nameOf(L, res.spec.y)}`, num(res.direct.b, di), num(res.direct.se, di), ci(res.direct.llci, res.direct.ulci, di), num(res.direct.std, di)]);
    res.indirect.forEach(r => eRows.push(['간접효과', route(r), num(r.effect, di), num(r.bootSE, di), r.llci == null ? '—' : ci(r.llci, r.ulci, di), num(r.std, di)]));
    const t2 = {
      key: 'eff', title: '총효과, 직접효과, 간접효과',
      headers: ['구분', '경로', 'B', 'SE', `${conf}% CI`, '표준화 효과'],
      rows: eRows,
      note: `총효과·직접효과의 SE와 신뢰구간은 회귀분석 결과(${isHC3(res) ? 'HC3 강건 표준오차' : '일반 OLS 표준오차'})이며, 간접효과의 SE와 신뢰구간은 ${res.spec.boot.toLocaleString()}회 부트스트랩(시드 = ${res.spec.seed})의 백분위수 방법으로 산출함. 표준화 효과는 X와 Y의 표준편차로 표준화한 값임.`
    };
    return [t1, t2];
  }

  function moderationTables(res, opt) {
    if (ST.paper) return moderationTablesPaper(res, opt);
    const L = opt.labels, d = opt.dec, conf = Math.round(res.spec.conf * 100), f = res.equation.fit, s = res.spec;
    const intName = s.x + ' × ' + s.w;
    const label = n => n === intName ? `${nameOf(L, s.x)} × ${nameOf(L, s.w)}` : nameOf(L, n);
    const rows = f.rows.map(r => [label(r.name), num(r.b, d), num(r.se, d), num(r.t, d), pCell(r.p), ci(r.llci, r.ulci, d)]);
    const t1 = {
      key: 'reg', title: `조절모형 회귀분석 결과 (종속변인: ${nameOf(L, s.y)}, N = ${res.sample.n})`,
      headers: ['예측변인', 'B', 'SE', 't', 'p', `${conf}% CI`],
      rows,
      note: `B = 비표준화 계수, SE = 표준오차, t = 검정통계량, p = 유의확률, CI = 신뢰구간, R² = 결정계수. R² = ${noLead(f.r2, d)}, F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)}. 상호작용항 추가에 따른 ΔR² = ${noLead(res.change.dR2, 3)}, F(1, ${res.change.df2}) = ${num(res.change.F, d)}, p ${pStr(res.change.p)}.` + seNote(res) + (isHC3(res) ? ' 회귀식 F와 상호작용항 F는 HC3 기반 Wald 검정임.' : '') +
        (s.center === 'mean' ? ` ${josa(nameOf(L, s.x), WA)} ${josa(nameOf(L, s.w), EUN)} 평균중심화함.` : '')
    };
    const cRows = res.conditional.map(c => [
      s.probe === 'binary' ? `${nameOf(L, s.w)} = ${num(c.wRaw, 0)}` : `${c.label} (${nameOf(L, s.w)} = ${num(c.wRaw, d)}${s.center === 'mean' ? `, 중심화 값 ${num(c.w, d)}` : ''})`, num(c.effect, d), num(c.se, d), num(c.t, d), pCell(c.p), ci(c.llci, c.ulci, d)
    ]);
    const t2 = {
      key: 'cond', title: `${nameOf(L, s.w)} 수준별 ${nameOf(L, s.x)}의 조건부 효과`,
      headers: [`${nameOf(L, s.w)} 수준`, 'B', 'SE', 't', 'p', `${conf}% CI`],
      rows: cRows,
      note: (s.center === 'mean' ? `${nameOf(L, s.w)} 값은 원점수이며, 괄호 안 중심화 값은 분석에 사용한 평균중심화 값임(원점수 = 중심화 값 + ${num(res.means.w, d)}).` : '') + seNote(res)
    };
    return [t1, t2];
  }

  // ---------- 분석 대상·기초통계·신뢰도 ----------
  const TODO = t => `[작성 필요: ${t}]`;
  const DESIGN = { cross: '횡단 설문', long: '종단(여러 시점 측정)', exp: '실험·준실험' };
  // 주요 변인 간 상관을 변인별로 묶어 서술
  function corrSentences(key, b, L, d, alpha) {
    const cv = b.corr.vars, out = [];
    for (let i = 0; i < key.length - 1; i++) {
      const a = cv.indexOf(key[i]); if (a < 0) continue;
      const pos = [], neg = [], ns = [];
      for (let j = i + 1; j < key.length; j++) {
        const c = cv.indexOf(key[j]); if (c < 0) continue;
        const r = b.corr.r[a][c], p = b.corr.p[a][c], item = `${nameOf(L, key[j])}(r = ${noLead(r, d)}, p ${pStr(p)})`;
        (p < alpha ? (r > 0 ? pos : neg) : ns).push(item);
      }
      const cl = [];
      if (pos.length) cl.push(`${josa(pos.join(', '), WA)} 유의한 정적 상관`);
      if (neg.length) cl.push(`${josa(neg.join(', '), WA)} 유의한 부적 상관`);
      let sen = cl.length ? `${josa(nameOf(L, key[i]), EUN)} ${cl.join('을, ')}을 보였다` : '';
      if (ns.length) sen += (sen ? '. ' : '') + `${josa(nameOf(L, key[i]), WA)} ${ns.join(', ')}의 상관은 통계적으로 유의하지 않았다`;
      if (sen) out.push(sen);
    }
    return out.length ? out.join('. ') + '.' : '';
  }
  function catNote(L, b, opt) {
    const missing = b.cat.filter(c => { const m = codeMap(opt || {}, c.name); return c.levels.some(l => m[l.value] == null); });
    if (!missing.length) return '';
    b = { cat: missing };
    return b.cat.length ? `범주형 변인의 코드 의미(${b.cat.map(c => `${nameOf(L, c.name)}: ${c.levels.map(l => l.value).join(', ')}`).join('; ')})는 연구자가 확인해 기재해야 함.` : '';
  }
  // 연구대상 특성: 사용자가 '연구대상 특성'으로 표시한 변수만
  function demoList(b, opt) { return (opt.demo || []).map(v => (b.demo || []).find(x => x.name === v)).filter(Boolean); }
  function demoTable(b, opt) {
    const L = opt.labels, d = opt.dec, list = demoList(b, opt);
    if (!list.length) return null;
    const rows = [];
    list.forEach(v => {
      if (v.kind === 'cat') {
        const m = codeMap(opt, v.name);
        v.levels.forEach((l, i) => rows.push([i === 0 ? nameOf(L, v.name) : '', m[l.value] != null ? m[l.value] : `코드 ${l.value}`, String(l.n), pc(l.pct)]));
        if (v.nMissing) rows.push(['', '결측', String(v.nMissing), pc(100 * v.nMissing / b.n)]);
      } else {
        rows.push([nameOf(L, v.name), v.n ? `M = ${Number(v.mean).toFixed(d)}, SD = ${Number(v.sd).toFixed(d)} (범위 ${Number(v.min).toFixed(Number.isInteger(v.min) ? 0 : d)}~${Number(v.max).toFixed(Number.isInteger(v.max) ? 0 : d)})` : '값 없음', String(v.n), '']);
        if (v.nMissing) rows.push(['', '결측', String(v.nMissing), pc(100 * v.nMissing / b.n)]);
      }
    });
    const noLabel = list.filter(v => v.kind === 'cat' && v.levels.some(l => codeMap(opt, v.name)[l.value] == null));
    return { sec: 'sample', key: 'demo', left: 2, title: `연구대상의 인구통계학적 특성 (n = ${b.n})`, headers: ['변인', '구분', '빈도(명)', '비율(%)'], rows,
      note: `분석 표본(목록별 삭제 후 ${b.n}명) 기준. 비율은 분석 표본 전체에 대한 값임. M = 평균, SD = 표준편차.` + (noLabel.length ? ` ${joinKo(noLabel.map(v => nameOf(L, v.name)))}의 코드 의미는 '변수 정리'에서 입력해야 함.` : '') };
  }
  function demoText(b, opt, tabNo) {
    const L = opt.labels, d = opt.dec, list = demoList(b, opt);
    if (!list.length) return '';
    const parts = list.map(v => {
      const nm = nameOf(L, v.name);
      if (v.kind === 'cat') { const m = codeMap(opt, v.name); return `${josa(nm, EUN)} ${v.levels.map(l => `${m[l.value] != null ? m[l.value] : '코드 ' + l.value} ${l.n}명(${pc(l.pct)})`).join(', ')}`; }
      return `${nm}의 평균은 ${Number(v.mean).toFixed(d)}(SD = ${Number(v.sd).toFixed(d)})`;
    });
    return `연구대상의 인구통계학적 특성은 ${tabNo ? `표 ${tabNo}` : '표'}에 제시하였다. ${parts.join('이었고, ')}이었다.`;
  }
  function sampleText(res, b, opt, extra) {
    const L = opt.labels, mc = (extra && extra.missingCodes) || [];
    const mv = b.missing.filter(m => m.nMissing > 0);
    const info = opt.info || {};
    let t = info.sample && info.sample.trim() ? info.sample.trim().replace(/[.。]?$/, '.') + ' ' : `${TODO('연구 대상, 표집 방법, 자료 수집 시기와 절차')} `;
    t += info.design && DESIGN[info.design] ? `본 연구는 ${DESIGN[info.design]} 설계로 수집한 자료를 분석하였다. ` : `${TODO('연구설계(횡단·종단·실험 등)')} `;
    t += `수집된 자료 ${b.nTotal}명 중 `;
    t += b.dropped
      ? `분석 변인 중 하나 이상에 결측치가 있는 ${b.dropped}명(${pc(100 * b.dropped / b.nTotal)})을 목록별 삭제(listwise deletion)하여 최종 ${b.n}명의 자료를 분석하였다.`
      : `분석 변인에 결측치가 없어 ${b.nTotal}명 전체를 분석하였다.`;
    if (mv.length) t += ` 변인별 결측은 ${mv.map(m => `${nameOf(L, m.name)} ${m.nMissing}명(${pc(m.pct)})`).join(', ')}이었다.`;
    if (mc.length) t += ` 결측치 코드(${mc.join(', ')})는 결측으로 처리하였다.`;
    const dt = demoText(b, opt, opt.tabNo && opt.tabNo.demo);
    if (dt) t += ' ' + dt;
    return t;
  }
  function basicText(res, b, opt, tabNo) {
    const L = opt.labels, d = opt.dec, alpha = 1 - res.spec.conf;
    const key = opt.keyVars || (res.model === 'moderation' ? [res.spec.x, res.spec.w, res.spec.y] : [res.spec.x].concat(res.spec.mediators, [res.spec.y]));
    const cv = b.corr.vars, pairs = [];
    for (let i = 0; i < key.length; i++) for (let j = i + 1; j < key.length; j++) {
      const a = cv.indexOf(key[i]), c = cv.indexOf(key[j]);
      if (a < 0 || c < 0) continue;
      const r = b.corr.r[a][c], p = b.corr.p[a][c];
      pairs.push(`${nameOf(L, key[i])}–${nameOf(L, key[j])}(r = ${noLead(r, d)}, p ${pStr(p)}${p < alpha ? '' : ', 통계적으로 유의하지 않음'})`);
    }
    if (ST.paper) {
      const sk = b.cont.map(c => Math.abs(c.skew)).filter(isFinite), ku = b.cont.map(c => Math.abs(c.kurt)).filter(isFinite);
      let tp = `주요 변인의 평균, 표준편차, 왜도, 첨도와 변인 간 상관계수는 표 ${tabNo.corr || tabNo.desc}에 제시하였다.`;
      if (sk.length) tp += ` 왜도의 절댓값은 ${num(Math.min(...sk), d)}~${num(Math.max(...sk), d)}, 첨도의 절댓값은 ${num(Math.min(...ku), d)}~${num(Math.max(...ku), d)} 범위였다 ${TODO('왜도·첨도에 대한 판단 기준과 근거 문헌')}.`;
      const cs = corrSentences(key, b, L, d, alpha);
      if (cs) tp += ` Pearson 상관분석 결과, ${cs}`;
      return tp;
    }
    let t = `주요 변인의 기술통계와 상관계수는 ${tabNo.desc ? `표 ${tabNo.desc}` : '표'}${tabNo.corr ? `와 표 ${tabNo.corr}` : ''}에 제시하였다.`;
    if (pairs.length) t += ` 모형에 포함된 주요 변인 간 상관은 ${pairs.join(', ')}로 나타났다.`;
    t += ' 상관분석은 변인 간 관련성을 보여 줄 뿐이며, 모형의 경로 관계는 아래 회귀분석 결과로 검토하였다.';
    return t;
  }
  function reliabilityText(res, b, opt) {
    const L = opt.labels, rel = b.reliability;
    if (!rel.length) return '';
    const ok = rel.filter(r => r.available && r.alpha != null && r.inModel !== false), na = rel.filter(r => !r.available);
    const sub = rel.filter(r => r.available && r.alpha != null && r.inModel === false);
    const parts = [];
    if (ok.length) parts.push(`척도 점수의 내적 일관성 신뢰도(Cronbach's α)는 ${ok.map(r => `${nameOf(L, r.name)} ${r.k}문항 α = ${noLead(r.alpha, 2)}`).join(', ')}로 나타났다(분석 표본 n = ${ok[0].n}).`);
    if (sub.length) parts.push(`하위요인 등 모형에 직접 투입하지 않은 척도의 신뢰도는 ${sub.map(r => `${nameOf(L, r.name)} ${r.k}문항 α = ${noLead(r.alpha, 2)}`).join(', ')}로 나타났다.`);
    if (na.length) parts.push(`${josa(joinKo(na.map(r => nameOf(L, r.name))), EUN)} 문항 자료가 없어 이 도구에서 신뢰도를 산출하지 않았다${' ' + TODO('척도 출처와 선행연구 또는 본 연구의 신뢰도')}.`);
    parts.push('신뢰도 계수는 내적 일관성에 관한 정보이며, 척도의 타당성을 입증하지는 않는다.');
    return parts.join(' ');
  }
  function basicTables(res, b, opt, extra) {
    const L = opt.labels, d = opt.dec, mc = (extra && extra.missingCodes) || [];
    const out = [];
    out.push({ sec: 'sample', key: 'missing', title: `분석 변인별 결측 현황 (전체 N = ${b.nTotal})`, headers: ['변인', '결측 수', '결측 비율'],
      rows: b.missing.map(m => [nameOf(L, m.name), String(m.nMissing), pc(m.pct)]).concat([['하나 이상 결측(분석에서 제외)', String(b.dropped), pc(100 * b.dropped / b.nTotal)]]),
      note: `결측 처리: 분석 변인 중 하나라도 결측인 사례를 목록별 삭제함(분석 사례 n = ${b.n}).` + (mc.length ? ` 결측치 코드 ${mc.join(', ')}를 결측으로 처리함.` : '') + ' 빈칸과 숫자가 아닌 값은 결측으로 처리함.' });
    const dm = demoTable(b, opt);
    if (dm) out.push(dm);
    if (ST.paper && b.cont.length) {
      const cv = b.corr.vars;
      const rows = cv.map((v, i) => [`${i + 1}. ${nameOf(L, v)}`].concat(cv.map((_, j) => j < i ? noLead(b.corr.r[i][j], d) + stars(b.corr.p[i][j]) : j === i ? '—' : '')));
      const stat = (lab, f) => [lab].concat(b.cont.map(f));
      rows.push(stat('M', c => num(c.mean, d)), stat('SD', c => num(c.sd, d)), stat('최솟값', c => num(c.min, d)), stat('최댓값', c => num(c.max, d)), stat('왜도', c => num(c.skew, d)), stat('첨도', c => num(c.kurt, d)));
      out.push({ sec: 'desc', key: 'corr', title: `주요 변인의 기술통계 및 상관계수 (n = ${b.n})`, headers: ['변인'].concat(cv.map((_, i) => String(i + 1))), rows,
        note: `상관계수는 Pearson 적률상관계수임. 모든 값은 목록별 삭제 후 분석 표본(모형 분석과 같은 표본) 기준임. M = 평균, SD = 표준편차(n − 1 분모), 왜도와 첨도는 표본 보정 통계량(첨도는 정규분포에서 0).${b.cat.length ? ' 범주형 변인은 이 표에서 제외함.' : ''}`, stars: STAR + ' (양측)' });
    }
    if (!ST.paper && b.cont.length) out.push({ sec: 'desc', key: 'desc', title: `주요 연속형 변인의 기술통계 (n = ${b.n})`, headers: ['변인', 'n', 'M', 'SD', '최솟값', '최댓값'],
      rows: b.cont.map(c => [nameOf(L, c.name), String(c.n), num(c.mean, d), num(c.sd, d), num(c.min, d), num(c.max, d)]),
      note: `목록별 삭제 후 분석 표본 기준. M = 평균, SD = 표준편차(n − 1 분모).` });
    const shown = new Set(demoList(b, opt).map(v => v.name)), cats = b.cat.filter(c => !shown.has(c.name));
    if (cats.length) out.push({ sec: 'desc', key: 'freq', title: `범주형 변인의 빈도 (n = ${b.n})`, headers: ['변인', '코드', '빈도', '비율'],
      rows: [].concat(...cats.map(c => c.levels.map((l, i) => [i === 0 ? nameOf(L, c.name) : '', codeLabel(opt, c.name, l.value), String(l.n), pc(l.pct)]))),
      note: `분석 표본 기준. 이분형 변인은 코드값 그대로 회귀식에 투입하였으므로 계수는 코드가 1 클 때의 차이를 뜻함. ${catNote(L, { cat: cats }, opt)}` });
    if (!ST.paper && b.corr.vars.length >= 2) {
      const cv = b.corr.vars;
      const rows = cv.map((v, i) => [`${i + 1}. ${nameOf(L, v)}`].concat(cv.map((_, j) => j < i ? noLead(b.corr.r[i][j], d) + stars(b.corr.p[i][j]) : j === i ? '—' : '')));
      out.push({ sec: 'desc', key: 'corr', title: `주요 연속형 변인 간 상관 (n = ${b.n})`, headers: ['변인'].concat(cv.map((_, i) => String(i + 1))), rows,
        note: `Pearson 상관계수. 목록별 삭제 후 분석 표본 기준(모형 분석과 같은 표본). 범주형 변인은 상관표에서 제외함. *p < .05, **p < .01, ***p < .001 (양측).` });
    }
    const rel = b.reliability;
    if (rel.length) out.push({ sec: 'rel', key: 'rel', title: '척도 점수 산출과 신뢰도', headers: ['척도', '문항 수', '점수 산출', '역채점 문항', 'n', "Cronbach's α"],
      rows: rel.map(r => r.available
        ? [nameOf(L, r.name) + (r.inModel === false ? ' (하위요인·기타)' : ''), String(r.k), r.method === 'sum' ? '문항 합계' : '문항 평균', r.rev.length ? `${r.rev.join(', ')} (${r.min}+${r.max}−응답)` : '없음', String(r.n), r.alpha == null ? '산출 불가' : noLead(r.alpha, 2)]
        : [nameOf(L, r.name), '—', '점수 자료 업로드', '—', '—', '문항 자료 없음(산출 불가)']),
      note: '문항 중 하나라도 결측이면 그 사례의 척도 점수를 결측으로 처리함. 신뢰도는 모형 분석과 같은 분석 표본에서 계산함. 신뢰도는 타당성 근거가 아님.' });
    return out;
  }

  // ---------- Johnson-Neyman 요약 (서술·표가 같은 값을 사용) ----------
  // 값은 W 원점수 기준으로 보고하고, 평균중심화한 경우 분석에 쓴 중심화 값을 함께 표시함
  function jnText(res, opt) {
    const jn = res.jn, s = res.spec, L = opt.labels, d = opt.dec;
    if (!jn || jn.status === 'not_applicable') return '';
    const conf = Math.round(jn.conf * 100), X = nameOf(L, s.x), W = nameOf(L, s.w);
    const cen = jn.scale === 'centered';
    const v = (raw, c) => cen ? `${num(raw, d)}(중심화 값 ${num(c, d)})` : num(raw, d);
    const head = `Johnson-Neyman 분석 결과(${conf}% 신뢰수준), `;
    if (jn.status === 'failed') return `Johnson-Neyman 경계값은 수치 문제로 산출하지 못하였다(${jn.reason}).`;
    const range = `관측된 ${W}의 범위(${num(jn.wminRaw, d)} ~ ${num(jn.wmaxRaw, d)}${cen ? ', 원점수 기준' : ''})`;
    const outside = jn.outside.length ? ` 관측 범위 밖에도 경계값이 있었다(${W} = ${jn.outside.map(b => cen ? `${num(b.wRaw, d)}, 중심화 값 ${num(b.w, d)}` : num(b.wRaw, d)).join('; ')}).` : '';
    if (jn.status === 'all_sig') return head + `${range} 전체에서 ${X}의 조건부 효과가 유의하였다.` + (jn.roots.length ? outside : ' 관측 범위 안에서 유의성이 바뀌는 경계값은 없었다.');
    if (jn.status === 'none_sig') return head + `${range} 전체에서 ${X}의 조건부 효과가 유의하지 않았다.` + (jn.roots.length ? outside : ' 관측 범위 안에서 유의성이 바뀌는 경계값은 없었다.');
    const seg = g => `${num(g.fromRaw, d)} ~ ${num(g.toRaw, d)} 구간(사례의 ${pc(g.pct)})`;
    const sig = jn.segments.filter(g => g.sig), non = jn.segments.filter(g => !g.sig);
    return head + `${X}의 조건부 효과의 유의성이 바뀌는 경계값은 ${W} = ${jn.bounds.map(b => v(b.wRaw, b.w)).join(', ')} 지점이었다. ` +
      `${josa(W, I)} ${sig.map(seg).join(', ')}에 있을 때 ${X}의 조건부 효과는 유의하였고, ${non.map(seg).join(', ')}에서는 유의하지 않았다.` + outside;
  }
  function jnTable(res, opt) {
    const jn = res.jn, s = res.spec, L = opt.labels, d = opt.dec;
    if (!jn || jn.status === 'not_applicable') return null;
    const W = nameOf(L, s.w), X = nameOf(L, s.x), cen = jn.scale === 'centered';
    const conf = Math.round(jn.conf * 100), alpha = noLead(1 - jn.conf, 2);
    const headers = ['구분', `${W} (원점수)`].concat(cen ? [`${W} (중심화 값)`] : [], [`${X}의 조건부 효과`, '사례 비율']);
    const row = (a, raw, c, e, pct) => [a, raw].concat(cen ? [c] : [], [e, pct]);
    const rows = [];
    if (jn.status === 'failed') {
      rows.push(row('계산 불가', '—', '—', jn.reason, '—'));
    } else {
      rows.push(row('관측 범위', `${num(jn.wminRaw, d)} ~ ${num(jn.wmaxRaw, d)}`, `${num(jn.wmin, d)} ~ ${num(jn.wmax, d)}`, '', '100.0%'));
      if (!jn.roots.length) rows.push(row('경계값', '없음', '없음', '유의성이 바뀌는 지점 없음', ''));
      jn.roots.forEach(b => rows.push(row('경계값', num(b.wRaw, d), num(b.w, d), b.inRange ? '유의성 전환 지점' : '관측 범위 밖', b.inRange ? `${pc(b.pctBelow)} 아래 / ${pc(b.pctAbove)} 위` : '')));
      jn.segments.forEach(g => rows.push(row('구간', `${num(g.fromRaw, d)} ~ ${num(g.toRaw, d)}`, `${num(g.from, d)} ~ ${num(g.to, d)}`, g.sig ? `유의 (p < ${alpha})` : `비유의 (p ≥ ${alpha})`, `${pc(g.pct)}`)));
    }
    const note = jn.status === 'failed'
      ? `${conf}% 신뢰수준에서 Johnson-Neyman 경계값을 계산하지 못함.`
      : `${conf}% 신뢰수준, t 임계값 = ${num(jn.tcrit, 3)} (df = ${jn.df}).${seNote(res)} 경계값은 ${X}의 조건부 효과의 |B / SE|가 t 임계값과 같아지는 ${W} 값임. 상호작용항 검정과 별개로, ${W}의 각 값에서 조건부 효과가 0인지 검정한 결과임.` + (cen ? ` 원점수 = 중심화 값 + ${num(res.means.w, d)}.` : '');
    return { key: 'jn', title: `Johnson-Neyman 분석 결과 (${W}의 값에 따른 ${X}의 조건부 효과 유의 구간)`, headers, rows, note };
  }

  function tables(res, opt) {
    if (res.model !== 'moderation') return extraTables(res, opt, mediationTables(res, opt));
    const t = moderationTables(res, opt), j = jnTable(res, opt);
    return extraTables(res, opt, j ? t.concat([j]) : t);
  }

  function tableToHTML(t, i) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const left = t.left || (['missing', 'corr', 'desc', 'cond'].includes(t.key) || (t.key === 'eff' && ST.paper) ? 1 : 2);
    let h = `<table class="apa l${left}"><caption><b>표 ${i + 1}</b><br>${ST.paper ? esc(t.title) : `<i>${esc(t.title)}</i>`}</caption><thead><tr>${t.headers.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
    t.rows.forEach(r => {
      const isFit = r.slice(2).every(c => c === '') && r[1] && r[1].startsWith('R²');
      if (isFit) h += `<tr class="fit"><td></td><td colspan="${t.headers.length - 1}">${esc(r[1])}</td></tr>`;
      else h += '<tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>';
    });
    h += '</tbody></table>';
    if (t.note) h += `<p class="tnote"><i>주.</i> ${esc(t.note)}</p>`;
    if (t.stars) h += `<p class="tnote">${esc(t.stars)}</p>`;
    return h;
  }
  function tableToTSV(t) {
    return [t.title, t.headers.join('\t')].concat(t.rows.map(r => r.join('\t'))).concat(t.note ? ['주. ' + t.note] : [], t.stars ? [t.stars] : []).join('\n');
  }
  function tableToCSV(t) {
    const q = s => /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s;
    return [t.headers.map(q).join(',')].concat(t.rows.map(r => r.map(q).join(','))).join('\n');
  }

  // ---------- 결과 서술 ----------
  function pathSentence(pred, outcome, r, d, alpha) {
    const stat = `B = ${num(r.b, d)}, SE = ${num(r.se, d)}, t = ${num(r.t, d)}, p ${pStr(r.p)}`;
    if (r.p < alpha) return `${josa(pred, EUN)} ${josa(outcome, EUL)} 유의하게 ${r.b > 0 ? '정적으로' : '부적으로'} 예측하였다(${stat})`;
    return `${josa(pred, I)} ${josa(outcome, EUL)} 예측한다는 통계적으로 유의한 근거는 확인되지 않았다(${stat})`;
  }
  function fitSentence(outcome, f, d) {
    return `이 회귀식은 ${outcome} 변량의 ${pc(f.r2 * 100)}를 설명하였다(R² = ${noLead(f.r2, d)}, F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)})`;
  }

  // 논문 형식: 본문에는 B와 p(간접효과는 B와 신뢰구간)만 쓰고, 나머지 통계량은 표로 안내
  const bp = (r, d) => `B = ${num(r.b, d)}, p ${pStr(r.p)}`;
  function pathSentenceP(pred, outcome, r, d, alpha) {
    if (r.p < alpha) return `${josa(pred, EUN)} ${josa(outcome, EUL)} 유의하게 ${r.b > 0 ? '정적으로' : '부적으로'} 예측하였다(${bp(r, d)})`;
    return `${josa(pred, I)} ${josa(outcome, EUL)} 예측한다는 통계적으로 유의한 근거는 확인되지 않았다(${bp(r, d)})`;
  }
  const hypLead = opt => (opt.info && opt.info.hyp && opt.info.hyp.trim()) ? `연구가설(${opt.info.hyp.trim().replace(/[.。]$/, '')})을 검증하기 위해 다음과 같이 분석하였다. ` : '';
  const tref = (n, word) => n ? `표 ${n}${word || ''}` : '표';
  function mediationTextPaper(res, opt) {
    const L = opt.labels, d = opt.dec, di = opt.decInd, s = res.spec, alpha = 1 - s.conf, conf = Math.round(s.conf * 100), T = opt.tabNo || {};
    const X = nameOf(L, s.x), Y = nameOf(L, s.y), k = s.mediators.length;
    const covPre = s.covariates.length ? `${josa(joinKo(s.covariates.map(c => nameOf(L, c))), EUL)} 통제한 상태에서 ` : '';
    const sents = [];
    res.equations.forEach((eq, i) => {
      const O = nameOf(L, eq.outcome), f = eq.fit, isY = i === k;
      eq.predictors.filter(p => !s.covariates.includes(p)).forEach(p => {
        if (isY && p === s.x) return;
        sents.push(pathSentenceP(nameOf(L, p), O, f.rows[eq.predictors.indexOf(p) + 1], d, alpha));
      });
      if (isY) { const r = f.rows[1]; sents.push(`${josa(joinKo(s.mediators.map(m => nameOf(L, m))), EUL)} 함께 투입한 회귀식에서 ${X}의 직접효과는 ${r.p < alpha ? '유의하였다' : '통계적으로 유의하지 않았다'}(${bp(r, d)})`); }
    });
    const body = sents.map((t, i) => (i > 0 && i % 2 === 1 ? '또한 ' : '') + t).join('. ') + '.';
    const paras = [hypLead(opt) + `${covPre}${josa(X, WA)} ${Y}의 관계에서 ${josa(medTitle(res, L), EUL)} 검증한 결과는 ${tref(T.reg)}에 제시하였다. ` + body];
    const tr = res.total;
    let p2 = `매개변인을 투입하지 않았을 때 ${X}의 ${Y}에 대한 총효과는 ${tr.p < alpha ? '유의하였다' : '통계적으로 유의하지 않았다'}(${bp(tr, d)}).`;
    if (s.boot > 0) {
      const routeTxt = r => { const ms = r.route.slice(1, -1).map(m => nameOf(L, m)); return `${X}에서 ${josa(ms.join(', '), EUL)} ${ms.length > 1 ? '순차적으로 ' : ''}거쳐 ${josa(Y, RO)} 가는 간접효과`; };
      const one = (name, r) => `${name}는 ${conf}% 신뢰구간에 0이 ${r.significant ? '포함되지 않아 유의하였다' : '포함되어 통계적으로 유의한 간접효과를 확인하지 못했다'}(B = ${num(r.effect, di)}, ${conf}% CI ${ci(r.llci, r.ulci, di)})`;
      const list = orderedRoutes(res).map(r => one(routeTxt(r), r));
      const tot = res.indirect.find(r => !r.route);
      if (tot) list.push(one('총간접효과', tot));
      p2 += ` 간접효과의 유의성을 검증하기 위해 ${s.boot.toLocaleString()}회의 부트스트래핑을 실시하였다${T.eff ? `(표 ${T.eff})` : ''}. ` + list.join('. ') + '.';
      if (res.indirect.filter(r => r.route).length > 1) p2 += ' 간접효과 사이의 차이는 별도로 검정하지 않았으므로, 개별 간접효과의 유의 여부만으로 간접효과 간 크기 차이를 판단할 수 없다.';
    }
    p2 += ` 표준화 경로계수를 포함한 분석 모형은 그림 ${T.fig || 1}에 제시하였다.`;
    paras.push(p2);
    return paras;
  }
  function moderationTextPaper(res, opt) {
    const L = opt.labels, d = opt.dec, s = res.spec, alpha = 1 - s.conf, f = res.equation.fit, T = opt.tabNo || {};
    const X = nameOf(L, s.x), W = nameOf(L, s.w), Y = nameOf(L, s.y);
    const covPre = s.covariates.length ? `${josa(joinKo(s.covariates.map(c => nameOf(L, c))), EUL)} 통제한 상태에서 ` : '';
    const ri = f.rows[3], ch = res.change;
    let p1 = hypLead(opt) + `${covPre}${josa(X, WA)} ${Y}의 관계에서 ${W}의 조절효과를 검증한 결과는 ${tref(T.reg)}에 제시하였다. `;
    if (ri.p < alpha) p1 += `${X} × ${W} 상호작용항은 ${josa(Y, EUL)} 유의하게 예측하였으며(${bp(ri, d)}), 상호작용항 추가에 따른 설명력 증가량은 ${numCop('ΔR² = ' + noLead(ch.dR2, 3))}. 이는 ${josa(X, WA)} ${Y}의 관련성이 ${W}의 수준에 따라 다를 수 있음을 시사한다.`;
    else p1 += `${X} × ${W} 상호작용항은 통계적으로 유의하지 않았으며(${bp(ri, d)}; ΔR² = ${noLead(ch.dR2, 3)}), ${W}의 조절효과에 대한 통계적으로 유의한 근거는 확인되지 않았다.`;
    const cs = res.conditional.map(c => {
      const wv = s.center === 'mean' ? `${num(c.wRaw, d)}, 중심화 값 ${num(c.w, d)}` : num(c.w, d);
      const where = s.probe === 'binary' ? `${W} = ${codeLabel(opt, s.w, c.wRaw)}일 때` : `${josa(W, I)} ${c.label}(${wv})일 때`;
      return `${where} ${X}의 조건부 효과는 ${c.p < alpha ? (c.effect > 0 ? '유의한 정적 효과로 나타났고' : '유의한 부적 효과로 나타났고') : '통계적으로 유의하지 않았고'}(B = ${num(c.effect, d)}, p ${pStr(c.p)})`;
    });
    const lead = ri.p < alpha ? `단순기울기 분석 결과${T.cond ? `(표 ${T.cond})` : ''}, ` : `상호작용항 검정과 별개로 ${W}의 특정 값에서 ${X}의 조건부 효과를 검정한 결과${T.cond ? `(표 ${T.cond})` : ''}, `;
    let p2 = lead + cs.join(', ') + '.';
    p2 = p2.replace(/나타났고\(([^()]*)\)\.$/, '나타났다($1).').replace(/않았고\(([^()]*)\)\.$/, '않았다($1).');
    const jt = jnText(res, opt);
    if (jt) p2 += ' ' + jt.replace(/^Johnson-Neyman 분석 결과\(/, `Johnson-Neyman 분석 결과(${T.jn ? `표 ${T.jn}, ` : ''}`);
    p2 += ` 조절모형과 ${W} 수준별 회귀선은 그림 ${T.fig || 1}, 그림 ${(T.fig || 1) + 1}에 제시하였다.`;
    return [p1, p2];
  }

  function mediationText(res, opt) {
    if (ST.paper) return mediationTextPaper(res, opt);
    const L = opt.labels, d = opt.dec, di = opt.decInd, s = res.spec, alpha = 1 - s.conf, conf = Math.round(s.conf * 100);
    const X = nameOf(L, s.x), Y = nameOf(L, s.y);
    const covPre = s.covariates.length ? `${josa(joinKo(s.covariates.map(c => nameOf(L, c))), EUL)} 통제한 상태에서 ` : '';
    const paras = [];
    const k = s.mediators.length;
    // 매개변인 회귀식
    res.equations.forEach((eq, i) => {
      const O = nameOf(L, eq.outcome), f = eq.fit, isY = i === k;
      const preds = eq.predictors.filter(p => !s.covariates.includes(p));
      const sents = preds.map(p => pathSentence(nameOf(L, p), O, f.rows[eq.predictors.indexOf(p) + 1], d, alpha));
      let intro;
      if (!isY) intro = i === 0 ? `${covPre}먼저 ${josa(O, EUL)} 종속변인으로 한 회귀분석 결과, ` : `다음으로 ${josa(O, EUL)} 종속변인으로 한 회귀분석 결과, `;
      else intro = `${josa(Y, EUL)} 종속변인으로 ${josa(joinKo([X].concat(s.mediators.map(m => nameOf(L, m)))), EUL)} 함께 투입한 결과, `;
      let body = sents.join('. 또한 ');
      // 직접효과는 표현을 바꿈
      if (isY) {
        const medSents = sents.slice(1);
        const r = f.rows[1];
        const dStat = `B = ${num(r.b, d)}, SE = ${num(r.se, d)}, t = ${num(r.t, d)}, p ${pStr(r.p)}`;
        const direct = r.p < alpha ? `${X}의 직접효과는 유의하였다(${dStat})` : `${X}의 직접효과는 통계적으로 유의하지 않았다(${dStat})`;
        body = medSents.join('. 또한 ') + '. ' + direct;
      }
      paras.push(intro + body + '. ' + fitSentence(O, f, d) + '.');
    });
    // 총효과
    const tr = res.total;
    const tStat = `B = ${num(tr.b, di)}, SE = ${num(tr.se, di)}, t = ${num(tr.t, d)}, p ${pStr(tr.p)}`;
    let tot = `매개변인을 투입하지 않았을 때 ${X}의 ${Y}에 대한 총효과는 ${tr.p < alpha ? '유의하였다' : '통계적으로 유의하지 않았다'}(${tStat}).`;
    // 간접효과
    if (s.boot > 0) {
      const routeTxt = r => {
        const ms = r.route.slice(1, -1).map(m => nameOf(L, m));
        return `${X}에서 ${josa(ms.join(', '), EUL)} ${ms.length > 1 ? '순차적으로 ' : ''}거쳐 ${josa(Y, RO)} 가는 간접효과`;
      };
      const indS = res.indirect.map(r => {
        const stat = `B = ${num(r.effect, di)}, Boot SE = ${num(r.bootSE, di)}, ${conf}% CI ${ci(r.llci, r.ulci, di)}`;
        const name = r.route ? routeTxt(r) : '총간접효과';
        return `${name}는 ${r.significant ? '신뢰구간에 0이 포함되지 않아 유의하였다' : '신뢰구간에 0이 포함되어 통계적으로 유의한 간접효과를 확인하지 못했다'}(${stat})`;
      });
      const contrastNote = res.indirect.filter(r => r.route).length > 1 ? ' 간접효과 사이의 차이는 별도로 검정하지 않았으므로, 개별 간접효과의 유의 여부만으로 간접효과 간 크기 차이를 판단할 수 없다.' : '';
      paras.push(tot + ` 부트스트랩 검증 결과, ` + indS.join('. ') + '.' + contrastNote);
    } else paras.push(tot);
    return paras;
  }

  function moderationText(res, opt) {
    if (ST.paper) return moderationTextPaper(res, opt);
    const L = opt.labels, d = opt.dec, s = res.spec, alpha = 1 - s.conf, conf = Math.round(s.conf * 100), f = res.equation.fit;
    const X = nameOf(L, s.x), W = nameOf(L, s.w), Y = nameOf(L, s.y);
    const covPre = s.covariates.length ? `${josa(joinKo(s.covariates.map(c => nameOf(L, c))), EUL)} 통제한 상태에서 ` : '';
    const ri = f.rows[3];
    const iStat = `B = ${num(ri.b, d)}, SE = ${num(ri.se, d)}, t = ${num(ri.t, d)}, p ${pStr(ri.p)}`;
    const ch = res.change;
    const chStat = `ΔR² = ${noLead(ch.dR2, 3)}, ${isHC3(res) ? 'HC3 기반 ' : ''}F(1, ${ch.df2}) = ${num(ch.F, d)}, p ${pStr(ch.p)}`;
    const paras = [];
    let p1 = `${covPre}${X}, ${W}, 그리고 두 변인의 상호작용항을 투입하여 ${josa(Y, EUL)} 예측한 결과, 회귀식은 ${Y} 변량의 ${pc(f.r2 * 100)}를 설명하였다(R² = ${noLead(f.r2, d)}, F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)}). `;
    if (ri.p < alpha) p1 += `${X} × ${W} 상호작용항은 ${josa(Y, EUL)} 유의하게 예측하였으며(${iStat}), 상호작용항 추가로 설명력이 유의하게 증가하였다(${chStat}). 이는 ${josa(X, WA)} ${Y}의 관련성이 ${W}의 수준에 따라 다를 수 있음을 시사한다.`;
    else p1 += `${X} × ${W} 상호작용항은 통계적으로 유의하지 않았으며(${iStat}; ${chStat}), ${W}의 조절효과에 대한 통계적으로 유의한 근거는 확인되지 않았다.`;
    paras.push(p1);
    {
      const cs = res.conditional.map(c => {
        const wv = s.center === 'mean' ? `${num(c.wRaw, d)}, 중심화 값 ${num(c.w, d)}` : num(c.w, d);
        const where = s.probe === 'binary' ? `${W} = ${num(c.wRaw, 0)}일 때` : `${josa(W, I)} ${c.label}(${wv})일 때`;
        const stat = `B = ${num(c.effect, d)}, SE = ${num(c.se, d)}, t = ${num(c.t, d)}, p ${pStr(c.p)}, ${conf}% CI ${ci(c.llci, c.ulci, d)}`;
        return `${where} ${X}의 조건부 효과는 ${c.p < alpha ? (c.effect > 0 ? '유의한 정적 효과로 나타났고' : '유의한 부적 효과로 나타났고') : '통계적으로 유의하지 않았고'}(${stat})`;
      });
      const lead = ri.p < alpha ? '단순기울기 분석 결과, ' : `상호작용항 검정과 별개로 ${W}의 특정 값에서 ${X}의 조건부 효과를 검정한 결과, `;
      let p2 = lead + cs.join(', ').replace(/고\(([^)]*)\)$/, '다($1)') + '.';
      p2 = p2.replace(/나타났고\(([^()]*)\)\.$/, '나타났다($1).').replace(/않았고\(([^()]*)\)\.$/, '않았다($1).');
      const jt = jnText(res, opt);
      if (jt) p2 += ' ' + jt;
      paras.push(p2);
    }
    return paras;
  }

  function resultText(res, opt) { return extraText(res, opt, res.model === 'moderation' ? moderationText(res, opt) : mediationText(res, opt)); }

  // ---------- 추가 검정 (6. 분석 옵션에서 선택: 다중공선성 확인 · 간접효과 경로 간 차이 검증) ----------
  // 숫자는 engine.js가 분석 실행 때 계산한 값(res.diagnostics, res.contrasts)을 그대로 씀
  // 표 순서: [다중공선성] → 기존 모형 표(회귀계수, 효과) → [간접효과 차이]
  //   따라서 다중공선성 표 번호 = 회귀계수 표 번호 − 1, 간접효과 차이 표 번호 = 효과 표 번호 + 1
  function XO(opt) { return (opt && opt.extra) || {}; }
  function vifCut(opt) { return XO(opt).vifCut === 5 ? 5 : 10; }
  const NO_CONTRAST = ' 간접효과 사이의 차이는 별도로 검정하지 않았으므로, 개별 간접효과의 유의 여부만으로 간접효과 간 크기 차이를 판단할 수 없다.';
  // '간접효과1' 같은 숫자 끝 이름의 조사(0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔은 받침 있음)
  function josaN(n, pair) { const [a, b] = pair.split('/'); return '013678'.includes(String(n).slice(-1)) ? a : b; }
  // 신뢰구간 한계값이 표시 자릿수에서 0으로 반올림되면(예: −.0003 → .000) 0이 아닌 숫자가 보일 때까지 자릿수를 3자리까지 늘림
  function numB(v, d, flag) {
    let k = d;
    while (k < d + 3 && v !== 0 && isFinite(v) && Number(Math.abs(v).toFixed(k)) === 0) k++;
    if (k > d && flag) flag.widened = true;
    return num(v, k);
  }
  // 간접 경로 번호: 효과 표와 같은 순서(논문 형식은 매개변인 1개 경로 먼저)
  function routeNums(res) { const shown = orderedRoutes(res); return shown.map((r, i) => ({ r, idx: res.indirect.indexOf(r), n: i + 1 })); }
  const routeArrow = (r, L) => r.route.map(v => nameOf(L, v)).join(' → ');
  // 경계선 결과: 부트스트랩 신뢰구간의 한계값이 0에 매우 가까우면(백분위수 한계값의 몬테카를로 표준오차 3배 이내)
  //   난수 시드나 반복 횟수에 따라 유의 판정이 달라질 수 있으므로 문장과 표 주석에 알림
  //   몬테카를로 표준오차 ≈ SE × √(a(1−a)/B) / φ(z_a), a = (1 − 신뢰수준)/2, B = 부트스트랩 횟수 (정규 근사)
  function nearZero(v, res) {
    const B = res.spec.boot, a = (1 - res.spec.conf) / 2;
    if (!B || !(v.bootSE > 0) || !isFinite(v.llci) || !isFinite(v.ulci)) return false;
    const z = qnorm(a), mc = v.bootSE * Math.sqrt(a * (1 - a) / B) / (Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI));
    return Math.min(Math.abs(v.llci), Math.abs(v.ulci)) < 3 * mc;
  }
  const BORDER = names => `${names.join(', ')}의 신뢰구간은 한쪽 한계값이 0에 매우 가까워, 부트스트랩 난수 시드나 반복 횟수에 따라 유의 판정이 달라질 수 있으므로 해석에 주의가 필요하다.`;
  function borderIndirect(res, opt) {
    if (res.model === 'moderation' || !res.indirect) return [];
    return res.indirect.filter(r => nearZero(r, res)).map(r => (r.route ? `${routeArrow(r, opt.labels)} 경로 간접효과` : '총간접효과'));
  }

  // 다중공선성: 예측변인이 하나인 회귀식은 판단 대상이 아님. 조절모형에서 원점수 곱을 쓴 경우 X·W·상호작용항은 구조적 공선성이므로 판단에서 제외
  function vifCheck(res, opt) {
    const cut = vifCut(opt), raw = res.model === 'moderation' && res.spec.center !== 'mean';
    const judged = [], excluded = [], over = [];
    res.diagnostics.forEach(g => g.vif.forEach(v => {
      if (g.vif.length < 2) return;
      if (raw && isProductPart(res, v.name)) { excluded.push({ g, v }); return; }
      judged.push({ g, v });
      if (!(v.vif < cut)) over.push({ g, v });
    }));
    return { cut, raw, judged, excluded, over, single: res.diagnostics.filter(g => g.vif.length < 2) };
  }
  function vifLabel(res, L, name) { return isInter(res, name) ? `${nameOf(L, res.spec.x)} × ${nameOf(L, res.spec.w)}` : nameOf(L, name); }
  function vifTable(res, opt) {
    const L = opt.labels, c = vifCheck(res, opt), rows = [];
    res.diagnostics.forEach(g => g.vif.forEach((v, i) => rows.push([i === 0 ? nameOf(L, g.outcome) : '', vifLabel(res, L, v.name), noLead(v.tol, 3), isFinite(v.vif) ? num(v.vif, 2) : '∞'])));
    let note = `N = ${res.sample.n}. 공차 = 1 − R²ⱼ(예측변인 j를 같은 회귀식의 나머지 예측변인으로 회귀한 결정계수), VIF = 1 / 공차. 각 회귀식에 실제로 투입된 예측변인(공변인 포함)과 분석 표본으로 계산함. 검토 기준: VIF ${c.cut} 이상(공차 ${noLead(1 / c.cut, 2)} 이하).`;
    if (c.single.length) note += ` 예측변인이 하나뿐인 회귀식(종속변인: ${c.single.map(g => nameOf(L, g.outcome)).join(', ')})은 VIF = 1이며 다중공선성 판단 대상이 아님.`;
    if (c.raw) note += ` ${nameOf(L, res.spec.x)}, ${nameOf(L, res.spec.w)}와 상호작용항의 VIF는 원점수 곱으로 만든 상호작용항 때문에 구조적으로 커지므로 판단에서 제외함(평균중심화하면 줄어들며, 상호작용항의 계수와 검정 결과는 중심화 여부와 관계없이 같음).`;
    else if (res.model === 'moderation') note += ` 상호작용항은 평균중심화한 ${josa(nameOf(L, res.spec.x), WA)} ${nameOf(L, res.spec.w)}를 곱해 만들었음.`;
    note += ' 기준값은 관례적인 검토 기준이며 변인 삭제 기준이 아님.';
    return { key: 'vif', title: '회귀식별 예측변인의 다중공선성 확인', headers: ['종속변인', '예측변인', '공차', 'VIF'], rows, note };
  }
  function vifText(res, opt, no) {
    const L = opt.labels, c = vifCheck(res, opt);
    // 값이 하나로 모이면 '범위' 대신 단일 값으로 씀(예: 공차는 .77, VIF는 1.31이었다)
    const range = (list, tail) => {
      const t = list.map(x => x.v.tol), v = list.map(x => x.v.vif).filter(isFinite);
      const tl = [noLead(Math.min(...t), 2), noLead(Math.max(...t), 2)], vl = [num(Math.min(...v), 2), num(Math.max(...v), 2)];
      if (tl[0] === tl[1] && vl[0] === vl[1]) return `공차는 ${tl[0]}, ${tail ? `VIF는 ${vl[0]}${tail}` : numCop('VIF는 ' + vl[0])}`;
      return `공차는 ${tl.join('~')}, VIF는 ${vl.join('~')} 범위${tail || '였다'}`;
    };
    let t = `${res.model === 'moderation' ? '조절효과' : '매개효과'} 검증에 앞서 각 회귀식에 투입된 예측변인 간 다중공선성을 공차(tolerance)와 분산팽창계수(VIF)로 확인하였다${no ? `(표 ${no})` : ''}.`;
    if (c.judged.length) {
      t += ` ${c.single.length ? '예측변인이 둘 이상인 회귀식에서 ' : ''}${range(c.judged)}${c.raw ? '(상호작용 관련 항 제외)' : ''}.`;
      t += c.over.length
        ? ` ${c.over.map(x => `${nameOf(L, x.g.outcome)} 회귀식의 ${vifLabel(res, L, x.v.name)}(VIF = ${num(x.v.vif, 2)})`).join(', ')}의 VIF가 기준값 ${c.cut} 이상이었다. ${TODO('다중공선성에 대한 연구자의 판단과 대응(예: 변인 구성 재검토, 해석상 유의점)')}`
        : ` 모든 예측변인의 VIF가 ${c.cut} 미만(공차 ${noLead(1 / c.cut, 2)} 초과)으로, 이 기준에서 다중공선성 문제는 확인되지 않았다.`;
    }
    if (c.excluded.length) {
      t += ` ${nameOf(L, res.spec.x)}, ${josa(nameOf(L, res.spec.w), WA)} 상호작용항의 ${range(c.excluded, '였으나')}, 이는 원점수를 곱해 만든 상호작용항 때문에 구조적으로 커지는 값이므로 다중공선성 판단에서 제외하였다.`;
      if (!c.judged.length) t += ' 이 구조적 공선성은 상호작용항의 계수와 검정 결과에 영향을 주지 않으며, 평균중심화한 값으로 확인하려면 상호작용항을 평균중심화하여 다시 분석할 수 있다.';
    }
    return t;
  }

  // 간접효과 경로 간 차이: 표시 순서상 앞 경로 − 뒤 경로(절댓값 방식은 |앞| − |뒤|)
  function contrastRows(res, opt) {
    if (res.model === 'moderation' || !res.contrasts || !res.contrasts.length) return [];
    const mode = XO(opt).contrastType === 'abs' ? 'abs' : 'raw', nums = routeNums(res), out = [];
    for (let p = 0; p < nums.length; p++) for (let q = p + 1; q < nums.length; q++) {
      const A = nums[p], B = nums[q], c = res.contrasts.find(o => o.i === A.idx && o.j === B.idx);
      if (c) out.push({ no: out.length + 1, A, B, mode, v: c[mode], opposite: (A.r.effect > 0) !== (B.r.effect > 0) });
    }
    return out;
  }
  function contrastTable(res, opt, cr) {
    const L = opt.labels, di = opt.decInd, s = res.spec, conf = Math.round(s.conf * 100), abs = cr[0].mode === 'abs', flag = {};
    const nm = x => abs ? `|간접효과${x.n}|` : `간접효과${x.n}`;
    const rows = cr.map(c => [`C${c.no} (${nm(c.A)} − ${nm(c.B)})`, num(c.v.effect, di), num(c.v.bootSE, di), numB(c.v.llci, di, flag), numB(c.v.ulci, di, flag)]);
    let note = routeNums(res).map(x => `간접효과${x.n} = ${routeArrow(x.r, L)}`).join('; ') + '. ' +
      `B = ${abs ? '앞 간접효과의 절댓값에서 뒤 간접효과의 절댓값을 뺀 값' : '앞 간접효과에서 뒤 간접효과를 뺀 값'}, SE = 표준오차, CI = 신뢰구간, LL = 하한, UL = 상한. SE와 신뢰구간은 간접효과 검증과 같은 ${s.boot.toLocaleString()}회 부트스트랩 표본(난수 시드 = ${s.seed})마다 두 간접효과의 ${abs ? '절댓값 ' : ''}차이를 구해 백분위수 방법으로 산출함. 신뢰구간에 0이 포함되지 않으면 두 간접효과가 유의하게 다른 것으로 판단함. 여러 쌍을 비교하였으며 다중비교 보정은 적용하지 않음.`;
    if (!abs && cr.some(c => c.opposite)) note += ' 부호가 서로 다른 두 간접효과의 차이는 크기(절댓값) 비교가 아님.';
    if (flag.widened) note += ' 표시 자릿수에서 0으로 반올림되는 신뢰구간 한계값은 자릿수를 늘려 표시함.';
    const nb = cr.filter(c => nearZero(c.v, res));
    if (nb.length) note += ` ${nb.map(c => 'C' + c.no).join(', ')}의 신뢰구간은 한쪽 한계값이 0에 매우 가까워 난수 시드나 반복 횟수에 따라 유의 판정이 달라질 수 있음.`;
    return { key: 'contrast', left: 1, title: '간접효과 경로 간 차이 검증', headers: ['비교', 'B', 'SE', `${conf}% CI LL`, `${conf}% CI UL`], rows, note };
  }
  function contrastText(res, opt, cr, no) {
    const L = opt.labels, di = opt.decInd, conf = Math.round(res.spec.conf * 100), abs = cr[0].mode === 'abs';
    const nm = x => `간접효과${x.n}(${routeArrow(x.r, L)})`;
    const stat = c => `C${c.no}: B = ${num(c.v.effect, di)}, ${conf}% CI [${numB(c.v.llci, di)}, ${numB(c.v.ulci, di)}]`;
    // 비교가 많으면(매개변인 3개 = 21쌍) 유의한 비교만 문장으로 쓰고, 유의하지 않은 비교는 번호로 묶음
    const many = cr.length > 3, ns = cr.filter(c => !c.v.significant);
    const sents = (many ? cr.filter(c => c.v.significant) : cr).map(c => {
      if (!c.v.significant) return `${nm(c.A)}${josaN(c.A.n, WA)} ${nm(c.B)}의 ${abs ? '크기(절댓값) ' : ''}차이는 통계적으로 유의하지 않았다(${stat(c)})`;
      if (!abs && c.opposite) return `${nm(c.A)}${josaN(c.A.n, WA)} ${nm(c.B)}${josaN(c.B.n, EUN)} 유의하게 달랐으나(${stat(c)}), 두 간접효과의 부호가 반대이므로 이 차이를 크기 차이로 해석할 수는 없다`;
      // 같은 부호(또는 절댓값 방식)일 때만 크기를 비교함. 둘 다 음수이면 차이가 양수일 때 앞 경로의 크기가 더 작음
      const aBig = abs ? c.v.effect > 0 : (c.v.effect > 0) === (c.A.r.effect > 0), big = aBig ? c.A : c.B, small = aBig ? c.B : c.A;
      return `${nm(small)}보다 ${nm(big)}의 간접효과 크기가 유의하게 컸다(${stat(c)})`;
    });
    if (many && ns.length) sents.push(`${ns.length === cr.length ? `${cr.length}개 비교` : `나머지 ${ns.length}개 비교(${ns.map(c => 'C' + c.no).join(', ')})`}에서는 두 간접효과의 ${abs ? '크기(절댓값) ' : ''}차이가 통계적으로 유의하지 않았다${no ? `(표 ${no})` : ''}`);
    let t = `간접효과의 상대적 크기를 비교하기 위해 간접효과 쌍마다 부트스트랩 표본별 ${abs ? '절댓값 ' : ''}차이를 구하여 ${conf}% 신뢰구간을 산출하였다${no ? `(표 ${no})` : ''}. ` + sents.join('. ') + '.';
    if (ns.length) t += ' 차이가 유의하지 않다는 결과는 두 간접효과의 크기가 같다는 것을 입증하지는 않는다.';
    const nb = cr.filter(c => nearZero(c.v, res));
    if (nb.length) t += ' ' + BORDER(nb.map(c => 'C' + c.no));
    return t;
  }

  function extraTables(res, opt, base) {
    const x = XO(opt), out = base.slice();
    if (x.vif && res.diagnostics) out.unshift(vifTable(res, opt));
    const cr = x.contrast ? contrastRows(res, opt) : [];
    if (cr.length) out.push(contrastTable(res, opt, cr));
    return out;
  }
  function extraText(res, opt, paras) {
    const x = XO(opt), T = opt.tabNo || {};
    let out = paras.slice();
    const nb = borderIndirect(res, opt);
    if (nb.length && out.length) out[out.length - 1] += ' ' + BORDER(nb);
    if (x.vif && res.diagnostics) out.unshift(vifText(res, opt, T.reg ? T.reg - 1 : 0));
    const next = T.eff ? T.eff + 1 : 0;
    const cr = x.contrast ? contrastRows(res, opt) : [];
    if (cr.length) { out = out.map(p => p.replace(NO_CONTRAST, '')); out.push(contrastText(res, opt, cr, next)); }
    return out;
  }
  function extraMethod(res, opt) {
    const x = XO(opt), conf = Math.round(res.spec.conf * 100), parts = [];
    if (x.contrast && contrastRows(res, opt).length) parts.push(`간접효과 경로 간 크기 차이는 각 부트스트랩 표본에서 두 간접효과의 ${x.contrastType === 'abs' ? '절댓값 ' : ''}차이를 구해 산출한 ${conf}% 백분위수 신뢰구간으로 검증하였으며, 신뢰구간에 0이 포함되지 않으면 두 간접효과가 유의하게 다른 것으로 판단하였다.`);
    return parts; // 문장 배열: 여러 분석을 한 보고서로 묶을 때 같은 문장은 한 번만 씀
  }

  // ---------- 모형 그림 (흑백 논문용 SVG) ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function box(x, y, w, h, label) {
    return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="1.5"/>` +
      `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14">${esc(label)}</text>`;
  }
  // 상자 경계에서 시작·끝나는 화살표
  function edgePoint(cx, cy, w, h, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    const sx = dx === 0 ? Infinity : (w / 2) / Math.abs(dx), sy = dy === 0 ? Infinity : (h / 2) / Math.abs(dy);
    const s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  }
  function arrow(n1, n2, label, opts) {
    opts = opts || {};
    const [x1, y1] = edgePoint(n1.x, n1.y, n1.w, n1.h, n2.x, n2.y);
    const [x2, y2] = edgePoint(n2.x, n2.y, n2.w, n2.h, n1.x, n1.y);
    let path, lx, ly;
    if (opts.curve) {
      const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - opts.curve;
      path = `M${x1},${y1 - 2} Q${mx},${my} ${x2},${y2 - 2}`;
      lx = mx; ly = (my + Math.min(y1, y2)) / 2 - 2;
    } else {
      path = `M${x1},${y1} L${x2},${y2}`;
      lx = (x1 + x2) / 2 + (opts.dx || 0); ly = (y1 + y2) / 2 + (opts.dy || -8);
    }
    return `<path d="${path}" fill="none" stroke="#000" stroke-width="1.3" marker-end="url(#ah)"${opts.dash ? ' stroke-dasharray="5,4"' : ''}/>` +
      (label ? `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="12.5" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(label)}</text>` : '');
  }
  const DEFS = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#000"/></marker></defs>';

  function mediationFigure(res, opt) {
    const L = opt.labels, d = opt.dec, s = res.spec, k = s.mediators.length;
    const W = k === 1 ? 500 : 160 + 175 * (k + 1), H = 260 + (k > 2 ? 30 : 0);
    const nodeW = 130, nodeH = 44;
    const X = { x: 80, y: H - 60, w: nodeW, h: nodeH }, Yn = { x: W - 80, y: H - 60, w: nodeW, h: nodeH };
    const Ms = s.mediators.map((m, i) => ({ x: k === 1 ? W / 2 : 80 + (W - 160) * (i + 1) / (k + 1), y: 70 + (k > 2 ? 30 : 0), w: nodeW, h: nodeH }));
    const alpha = 1 - s.conf;
    const lab = r => `${num(ST.paper ? r.beta : r.b, d)}${stars(r.p)}`;
    const dsh = (r, o) => Object.assign({}, o, ST.paper && r.p >= alpha ? { dash: true } : {});
    let g = '';
    // 경로
    res.equations.slice(0, k).forEach((eq, i) => {
      const f = eq.fit;
      g += arrow(X, Ms[i], lab(f.rows[1]), dsh(f.rows[1], { dx: -14, dy: -4 }));
      for (let j = 0; j < i; j++) g += arrow(Ms[j], Ms[i], lab(f.rows[2 + j]), dsh(f.rows[2 + j], j === i - 1 ? { dy: -8 } : { curve: 40 + 15 * (i - j) }));
    });
    const fy = res.equations[k].fit;
    Ms.forEach((m, i) => (g += arrow(m, Yn, lab(fy.rows[2 + i]), dsh(fy.rows[2 + i], { dx: 14, dy: -4 }))));
    const cp = fy.rows[1], tot = res.total;
    g += arrow(X, Yn, ST.paper ? lab(cp) : `${lab(cp)} (${num(tot.b, d)}${stars(tot.p)})`, dsh(cp, { dy: 20 }));
    g += box(X.x, X.y, X.w, X.h, nameOf(L, s.x)) + box(Yn.x, Yn.y, Yn.w, Yn.h, nameOf(L, s.y));
    Ms.forEach((m, i) => (g += box(m.x, m.y, m.w, m.h, nameOf(L, s.mediators[i]))));
    const note = (ST.paper ? `주. 표준화 계수(β)를 제시함. 점선은 통계적으로 유의하지 않은 경로.` : `비표준화 계수. 괄호 안은 총효과.`) + `${s.covariates.length ? ' 공변인 경로는 생략함.' : ''} *p < .05, **p < .01, ***p < .001.`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 30}" width="${W}" height="${H + 30}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif" style="background:#fff">${DEFS}<rect width="100%" height="100%" fill="#fff"/>${g}<text x="10" y="${H + 20}" font-size="11">${esc(note)}</text></svg>`;
  }

  function moderationFigure(res, opt) {
    const L = opt.labels, d = opt.dec, s = res.spec, f = res.equation.fit;
    const W = 520, H = 220;
    const X = { x: 90, y: 150, w: 130, h: 44 }, Yn = { x: W - 90, y: 150, w: 130, h: 44 }, Wn = { x: W / 2, y: 50, w: 130, h: 44 };
    let g = arrow(X, Yn, `${num(f.rows[1].b, d)}${stars(f.rows[1].p)}`, { dy: 22 });
    // W → X→Y 경로의 중간
    const mid = { x: W / 2, y: 150, w: 2, h: 2 };
    g += `<path d="M${W / 2},${50 + 22} L${W / 2},${146}" stroke="#000" stroke-width="1.3" marker-end="url(#ah)"/>`;
    g += `<text x="${W / 2 + 8}" y="112" font-size="12.5" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(`상호작용 ${num(f.rows[3].b, d)}${stars(f.rows[3].p)}`)}</text>`;
    g += box(X.x, X.y, X.w, X.h, nameOf(L, s.x)) + box(Yn.x, Yn.y, Yn.w, Yn.h, nameOf(L, s.y)) + box(Wn.x, Wn.y, Wn.w, Wn.h, nameOf(L, s.w));
    const note = `비표준화 계수. X→Y 계수는 ${nameOf(L, s.w)} = 0${s.center === 'mean' ? '(평균)' : ''}일 때의 효과임. *p < .05, **p < .01, ***p < .001.`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 20}" width="${W}" height="${H + 20}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif" style="background:#fff">${DEFS}<rect width="100%" height="100%" fill="#fff"/>${g}<text x="10" y="${H + 10}" font-size="11">${esc(note)}</text></svg>`;
  }

  // 단순기울기 그림: 흑백 인쇄를 고려해 선 모양(실선·파선·점선)과 표식으로 구분
  function slopeFigure(res, opt) {
    const L = opt.labels, d = opt.dec, s = res.spec;
    const W = 520, H = 340, m = { l: 64, r: 150, t: 20, b: 52 };
    const pts = res.lines.flatMap(l => l.points);
    const xs = pts.map(p => p.xRaw), ys = pts.map(p => p.y);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padY = (y1 - y0) * 0.15 || 0.5; y0 -= padY; y1 += padY;
    const padX = (x1 - x0) * 0.08; x0 -= padX; x1 += padX;
    const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
    const ticks = (a, b) => { const step = niceStep((b - a) / 5); const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10)); return out; };
    function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r))), f = r / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
    let g = '';
    g += `<line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="#000"/><line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="#000"/>`;
    ticks(x0, x1).forEach(v => (g += `<line x1="${sx(v)}" y1="${H - m.b}" x2="${sx(v)}" y2="${H - m.b + 5}" stroke="#000"/><text x="${sx(v)}" y="${H - m.b + 19}" text-anchor="middle" font-size="11">${num(v, 1)}</text>`));
    ticks(y0, y1).forEach(v => (g += `<line x1="${m.l - 5}" y1="${sy(v)}" x2="${m.l}" y2="${sy(v)}" stroke="#000"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end" font-size="11">${num(v, 1)}</text>`));
    g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 12}" text-anchor="middle" font-size="13">${esc(nameOf(L, s.x))}</text>`;
    g += `<text transform="translate(16,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="13">${esc(nameOf(L, s.y))} (예측값)</text>`;
    const dashes = ['', '7,4', '2,3'], marks = ['circle', 'square', 'triangle'];
    const mark = (t, x, y) => t === 'circle' ? `<circle cx="${x}" cy="${y}" r="4" fill="#000"/>` : t === 'square' ? `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="#fff" stroke="#000" stroke-width="1.3"/>` : `<path d="M${x},${y - 5} L${x + 5},${y + 4} L${x - 5},${y + 4} z" fill="#fff" stroke="#000" stroke-width="1.3"/>`;
    res.lines.forEach((l, i) => {
      const [a, b] = l.points;
      g += `<line x1="${sx(a.xRaw)}" y1="${sy(a.y)}" x2="${sx(b.xRaw)}" y2="${sy(b.y)}" stroke="#000" stroke-width="1.8" ${dashes[i] ? `stroke-dasharray="${dashes[i]}"` : ''}/>`;
      g += mark(marks[i], sx(a.xRaw), sy(a.y)) + mark(marks[i], sx(b.xRaw), sy(b.y));
      // 범례
      const ly = m.t + 18 + i * 22, lx = W - m.r + 14;
      g += `<line x1="${lx}" y1="${ly}" x2="${lx + 28}" y2="${ly}" stroke="#000" stroke-width="1.8" ${dashes[i] ? `stroke-dasharray="${dashes[i]}"` : ''}/>${mark(marks[i], lx + 14, ly)}`;
      const lt = s.probe === 'binary' ? `${nameOf(L, s.w)} = ${num(l.wRaw, 0)}` : `${l.label.replace('번째 백분위', '%')} (${num(l.wRaw, d)})`;
      g += `<text x="${lx + 34}" y="${ly + 4}" font-size="11">${esc(lt)}</text>`;
    });
    g += `<text x="${W - m.r + 14}" y="${m.t + 2}" font-size="11.5" font-weight="bold">${esc(nameOf(L, s.w))}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif" style="background:#fff"><rect width="100%" height="100%" fill="#fff"/>${g}</svg>`;
  }

  // ---------- 회귀 진단 ----------
  // 정규분포 역함수 (Acklam 근사, 상대오차 약 1e-9)
  function qnorm(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const dd = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((dd[0] * q + dd[1]) * q + dd[2]) * q + dd[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((dd[0] * q + dd[1]) * q + dd[2]) * q + dd[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const isInter = (res, name) => res.model === 'moderation' && name === res.spec.x + ' × ' + res.spec.w;
  // 조절모형의 X·W·상호작용항: 원점수 곱 때문에 VIF가 커지는 구조적 공선성이 있어 경고·범위 요약에서 제외
  const isProductPart = (res, name) => res.model === 'moderation' && [res.spec.x, res.spec.w, res.spec.x + ' × ' + res.spec.w].includes(name);
  function diagTables(res, opt) {
    const L = opt.labels, d = opt.dec;
    const lab = (name) => isInter(res, name) ? `${nameOf(L, res.spec.x)} × ${nameOf(L, res.spec.w)}` : nameOf(L, name);
    const rows = [];
    res.diagnostics.forEach(g => {
      g.vif.forEach((v, i) => rows.push([i === 0 ? nameOf(L, g.outcome) : '', lab(v.name), isFinite(v.vif) ? num(v.vif, 2) : '∞', num(v.tol, 3),
        i === 0 ? num(g.maxCook, 3) : '', i === 0 ? `${g.nCookOver}` : '', i === 0 ? `${g.nStdresOver3}` : '']));
    });
    return [{ sec: 'diag', title: '회귀식별 다중공선성과 영향력 진단', headers: ['종속변인', '예측변인', 'VIF', '공차', "최대 Cook's D", `Cook's D > 4/n 사례`, '|표준화 잔차| > 3 사례'], rows,
      note: `VIF와 공차는 각 회귀식에 실제로 투입된 예측변인과 분석 표본(n = ${res.sample.n})으로 계산함. VIF 10(또는 5) 이상은 다중공선성 검토의 참고 기준이며 변수 삭제 기준이 아님.` +
        (res.model === 'moderation' ? ' 상호작용항과 구성 변수(X, W)의 VIF는 곱셈항 구조 때문에 크게 나타날 수 있으며(평균중심화하면 줄어듦), 이것만으로 조절모형이 부적절하다고 볼 수 없음.' : '') +
        " Cook's D 4/n은 검토가 필요한 사례를 찾는 참고 기준이며, 해당 사례를 자동으로 삭제하지 않음." }];
  }
  function diagText(res, opt) {
    const L = opt.labels, D = res.diagnostics;
    const vifs = [].concat(...D.map(g => g.vif.filter(v => !isProductPart(res, v.name)).map(v => v.vif))).filter(isFinite);
    const parts = [];
    if (vifs.length) parts.push(`각 회귀식의 VIF는 ${num(Math.min(...vifs), 2)}~${num(Math.max(...vifs), 2)}${res.model === 'moderation' ? '(조절 관련 항 제외)' : ''} 범위였다.`);
    if (res.model === 'moderation') parts.push(`${nameOf(L, res.spec.x)}, ${josa(nameOf(L, res.spec.w), WA)} 상호작용항의 VIF는 ${res.spec.center === 'mean' ? '평균중심화 후 값을 표에 제시하였다' : '원점수 곱으로 인해 커질 수 있어 표에만 제시하였다'}. 이 값만으로 조절모형이 부적절하다고 판단하지 않는다.`);
    const maxC = Math.max(...D.map(g => g.maxCook)), over = D.map(g => `${nameOf(L, g.outcome)} 식 ${g.nCookOver}명`).join(', ');
    parts.push(`Cook의 거리 최댓값은 ${num(maxC, 3)}였고, 4/n을 넘는 사례 수는 ${over}였다.`.replace(/(\d)였고/, (m, x) => '013678'.includes(x) ? x + '이었고' : x + '였고').replace(/명였다\.$/, '명이었다.'));
    parts.push('잔차-예측값 그림과 잔차 Q-Q 그림은 분석 진단 영역에 제시하였다. 이 진단 지표들은 검토를 돕는 참고 자료이며, 이 도구는 회귀 가정의 충족 여부를 자동으로 판정하지 않는다. 영향력이 큰 사례는 분석에서 제외하지 않았다.');
    parts.push(TODO('진단 결과에 대한 연구자의 판단(예: 이상치 처리 여부와 근거, 잔차 분포에 대한 해석)'));
    return parts.join(' ');
  }
  // 중요한 진단 신호만 짧게 (접힌 영역 밖에 표시)
  function diagFlags(res, opt) {
    const L = opt.labels, out = [];
    res.diagnostics.forEach(g => {
      const hv = g.vif.filter(v => !isProductPart(res, v.name) && v.vif >= 10);
      if (hv.length) out.push(`${nameOf(L, g.outcome)} 회귀식에서 VIF가 10 이상인 예측변인이 있습니다(${hv.map(v => `${nameOf(L, v.name)} ${num(v.vif, 1)}`).join(', ')}). 다중공선성을 검토해 주세요.`);
      if (g.nCookOver1) out.push(`${nameOf(L, g.outcome)} 회귀식에 Cook의 거리가 1을 넘는 사례가 ${g.nCookOver1}명 있습니다(자료 행 ${g.top.filter(t => t.cook > 1).map(t => t.row).join(', ')}). 영향력이 큰 사례인지 확인해 주세요.`);
    });
    return out;
  }
  function scatter(points, o) {
    const W = 300, H = 240, m = { l: 46, r: 12, t: 26, b: 40 };
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    let x0 = Math.min(...xs, o.x0 ?? Infinity), x1 = Math.max(...xs, o.x1 ?? -Infinity), y0 = Math.min(...ys, o.y0 ?? Infinity), y1 = Math.max(...ys, o.y1 ?? -Infinity);
    const px = (x1 - x0) * 0.06 || 1, py = (y1 - y0) * 0.06 || 1; x0 -= px; x1 += px; y0 -= py; y1 += py;
    const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
    const tick = (a, bb) => { const r = (bb - a) / 4, pw = Math.pow(10, Math.floor(Math.log10(r))), f = r / pw, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pw; const t = []; for (let v = Math.ceil(a / st) * st; v <= bb + 1e-9; v += st) t.push(+v.toFixed(10)); return t; };
    let g = `<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" font-weight="bold">${esc(o.title)}</text>`;
    g += `<line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="#000"/><line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" stroke="#000"/>`;
    tick(x0, x1).forEach(v => (g += `<text x="${sx(v)}" y="${H - m.b + 14}" text-anchor="middle" font-size="10">${num(v, 1)}</text>`));
    tick(y0, y1).forEach(v => (g += `<text x="${m.l - 5}" y="${sy(v) + 3}" text-anchor="end" font-size="10">${num(v, 1)}</text>`));
    if (o.ref === 'zero') g += `<line x1="${m.l}" y1="${sy(0)}" x2="${W - m.r}" y2="${sy(0)}" stroke="#666" stroke-dasharray="4,3"/>`;
    if (o.ref === 'diag') { const a = Math.max(x0, y0), bb = Math.min(x1, y1); g += `<line x1="${sx(a)}" y1="${sy(a)}" x2="${sx(bb)}" y2="${sy(bb)}" stroke="#666" stroke-dasharray="4,3"/>`; }
    points.forEach(p => (g += `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="2" fill="none" stroke="#000" stroke-width="0.8"/>`));
    g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle" font-size="11">${esc(o.xl)}</text><text transform="translate(12,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="11">${esc(o.yl)}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif" style="background:#fff"><rect width="100%" height="100%" fill="#fff"/>${g}</svg>`;
  }
  function diagFigures(res, opt) {
    const L = opt.labels, out = [];
    res.diagnostics.forEach(g => {
      const nm = nameOf(L, g.outcome);
      out.push({ title: `${nm} 회귀식: 잔차-예측값`, svg: scatter(g.fitted.map((f, i) => [f, g.stdres[i]]), { title: `${nm}: 표준화 잔차 vs 예측값`, xl: '예측값', yl: '표준화 잔차', ref: 'zero' }) });
      const sr = g.stdres.slice().sort((a, b) => a - b), n = sr.length;
      out.push({ title: `${nm} 회귀식: 잔차 Q-Q`, svg: scatter(sr.map((v, i) => [qnorm((i + 0.5) / n), v]), { title: `${nm}: 표준화 잔차 Q-Q`, xl: '이론적 정규분위수', yl: '표준화 잔차', ref: 'diag' }) });
    });
    return out;
  }

  function figures(res, opt) {
    const L = opt.labels, s = res.spec, X = nameOf(L, s.x), Y = nameOf(L, s.y);
    if (res.model === 'moderation') return [
      { title: ST.paper ? `${josa(X, WA)} ${Y}의 관계에서 ${nameOf(L, s.w)}의 조절효과 모형` : '조절모형 그림', svg: moderationFigure(res, opt) },
      { title: ST.paper ? `${nameOf(L, s.w)} 수준에 따른 ${josa(X, WA)} ${Y}의 관계` : '단순기울기 그림', svg: slopeFigure(res, opt) }];
    return [{ title: ST.paper ? `${josa(X, WA)} ${Y}의 관계에서 ${medTitle(res, L)}` : MODEL_INFO[res.model].title + ' 그림', svg: mediationFigure(res, opt) }];
  }

  const CAUTION = [
    '이 문장은 계산값을 정해진 문장 틀에 채운 초안임. 연구 설계와 가설에 맞게 연구자가 검토·수정해야 함.',
    '횡단 설문 자료의 매개·조절 분석 결과만으로 인과관계나 시간적 선후관계가 입증되지 않음.',
    '논문에는 실제 사용한 분석 도구와 설정을 기재해야 함. 이 도구로 분석했다면 SPSS PROCESS로 분석했다고 쓰면 안 됨.'
  ];

  const api = { setStyle, codeLabel, codeMap, medTitle, methodParts, demoTable, demoText, diagTables, diagText, diagFlags, diagFigures, qnorm, HC_REF, methodText, sampleText, basicText, reliabilityText, basicTables, numCop, pStr, jnText, jnTable, tables, tableToHTML, tableToTSV, tableToCSV, resultText, figures, josa, num, MODEL_INFO, HAYES_REF, CAUTION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Report = api;
})(typeof window !== 'undefined' ? window : this);
