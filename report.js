/*
 * 결과 보고 모듈: 계산 결과(engine.js 출력) → 논문용 표, 모형 그림(SVG), 한국어 결과 서술 초안
 * 숫자는 모두 계산 결과에서 그대로 가져오며, 문장은 미리 정한 문장 틀에 값만 채움.
 */
(function (root) {
  'use strict';

  // ---------- 숫자 형식 (APA 양식) ----------
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    let s = Number(v).toFixed(d);
    if (/^-0\.?0*$/.test(s)) s = s.slice(1); // -0.00 → 0.00
    return s.replace('-', '−');
  }
  // 1을 넘을 수 없는 값(p, R² 등)은 앞자리 0 생략
  function noLead(v, d) { return num(v, d).replace(/^(−?)0\./, '$1.'); }
  function pStr(p) { return p < 0.001 ? '< .001' : '= ' + noLead(p, 3); }
  function pCell(p) { return p < 0.001 ? '< .001' : noLead(p, 3); }
  function stars(p) { return p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : ''; }
  function ci(lo, hi, d) { return '[' + num(lo, d) + ', ' + num(hi, d) + ']'; }

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
  function methodText(res, opt) {
    const L = opt.labels, tool = opt.toolName || '웹 기반 분석 도구';
    const s = res.spec, info = MODEL_INFO[res.model], conf = Math.round(s.conf * 100);
    const covTxt = s.covariates.length ? josa(joinKo(s.covariates.map(c => nameOf(L, c))), EUL) + ' 공변인으로 모든 회귀식에 투입하였다. ' : '';
    const miss = res.sample.dropped ? `분석 변인에 결측치가 있는 ${res.sample.dropped}명은 목록별 삭제하여 최종 ${res.sample.n}명의 자료를 분석하였다. ` : `최종 ${res.sample.n}명의 자료를 분석하였다. `;
    let t = `자료 분석에는 ${josa(tool, EUL)} 사용하였다. ${miss}`;
    if (res.model !== 'moderation') {
      const meds = s.mediators.map(m => nameOf(L, m));
      t += `${josa(nameOf(L, s.x), WA)} ${nameOf(L, s.y)}의 관계에서 ${res.model === 'simple' ? meds[0] : joinKo(meds) + '(순서대로)'}의 ${res.model === 'simple' ? '' : '순차적 '}매개효과를 검증하기 위해, Hayes(2022)의 ${info.hayes}에 해당하는 구조로 최소제곱(OLS) 회귀분석을 실시하였다. ${covTxt}`;
      if (s.boot > 0) t += `간접효과의 유의성은 ${s.boot.toLocaleString()}회의 부트스트랩 재표집(난수 시드 = ${s.seed})으로 산출한 ${conf}% 백분위수 신뢰구간으로 검증하였으며, 신뢰구간에 0이 포함되지 않으면 간접효과가 유의한 것으로 판단하였다.`;
    } else {
      t += `${josa(nameOf(L, s.x), WA)} ${nameOf(L, s.y)}의 관계에서 ${nameOf(L, s.w)}의 조절효과를 검증하기 위해, Hayes(2022)의 ${info.hayes}에 해당하는 구조로 최소제곱(OLS) 회귀분석을 실시하였다. ${covTxt}`;
      if (s.center === 'mean') t += `상호작용항은 ${josa(nameOf(L, s.x), WA)} ${josa(nameOf(L, s.w), EUL)} 평균중심화한 뒤 곱하여 생성하였다. `;
      else t += `상호작용항은 ${josa(nameOf(L, s.x), WA)} ${nameOf(L, s.w)}의 원점수를 곱하여 생성하였다(중심화하지 않음). `;
      if (s.probe === 'binary') t += `조절변인이 두 값을 가지는 변인이므로 각 값에서 ${nameOf(L, s.x)}의 조건부 효과를 산출하였다.`;
      else t += `조건부 효과는 ${nameOf(L, s.w)}의 ${s.probe === 'meansd' ? '평균 및 평균 ±1 표준편차' : '16번째, 50번째, 84번째 백분위수'}에서 산출하였고, Johnson-Neyman 방법으로 조건부 효과가 유의한 조절변인의 범위를 확인하였다.`;
    }
    return t;
  }

  // ---------- 표 ----------
  // 표 객체: {title, headers, rows:[[...]], note}
  function mediationTables(res, opt) {
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
      title: `경로별 회귀계수 (N = ${res.sample.n})`,
      headers: ['종속변인', '예측변인', 'B', 'SE', 'β', 't', 'p', `${conf}% CI`],
      rows,
      note: 'B = 비표준화 계수, β = 표준화 계수, CI = 신뢰구간.'
    };
    const eRows = [];
    const route = r => r.route ? r.route.map(v => nameOf(L, v)).join(' → ') : '총간접효과';
    eRows.push(['총효과', `${nameOf(L, res.spec.x)} → ${nameOf(L, res.spec.y)}`, num(res.total.b, di), num(res.total.se, di), ci(res.total.llci, res.total.ulci, di), num(res.total.std, di)]);
    eRows.push(['직접효과', `${nameOf(L, res.spec.x)} → ${nameOf(L, res.spec.y)}`, num(res.direct.b, di), num(res.direct.se, di), ci(res.direct.llci, res.direct.ulci, di), num(res.direct.std, di)]);
    res.indirect.forEach(r => eRows.push(['간접효과', route(r), num(r.effect, di), num(r.bootSE, di), r.llci == null ? '—' : ci(r.llci, r.ulci, di), num(r.std, di)]));
    const t2 = {
      title: '총효과, 직접효과, 간접효과',
      headers: ['구분', '경로', 'B', 'SE', `${conf}% CI`, '표준화 효과'],
      rows: eRows,
      note: `총효과·직접효과의 SE와 신뢰구간은 회귀분석 결과이며, 간접효과의 SE와 신뢰구간은 ${res.spec.boot.toLocaleString()}회 부트스트랩(시드 = ${res.spec.seed})의 백분위수 방법으로 산출함. 표준화 효과는 X와 Y의 표준편차로 표준화한 값임.`
    };
    return [t1, t2];
  }

  function moderationTables(res, opt) {
    const L = opt.labels, d = opt.dec, conf = Math.round(res.spec.conf * 100), f = res.equation.fit, s = res.spec;
    const intName = s.x + ' × ' + s.w;
    const label = n => n === intName ? `${nameOf(L, s.x)} × ${nameOf(L, s.w)}` : nameOf(L, n);
    const rows = f.rows.map(r => [label(r.name), num(r.b, d), num(r.se, d), num(r.t, d), pCell(r.p), ci(r.llci, r.ulci, d)]);
    const t1 = {
      title: `조절모형 회귀분석 결과 (종속변인: ${nameOf(L, s.y)}, N = ${res.sample.n})`,
      headers: ['예측변인', 'B', 'SE', 't', 'p', `${conf}% CI`],
      rows,
      note: `R² = ${noLead(f.r2, d)}, F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)}. 상호작용항 추가에 따른 ΔR² = ${noLead(res.change.dR2, 3)}, F(1, ${res.change.df2}) = ${num(res.change.F, d)}, p ${pStr(res.change.p)}.` +
        (s.center === 'mean' ? ` ${josa(nameOf(L, s.x), WA)} ${josa(nameOf(L, s.w), EUN)} 평균중심화함.` : '')
    };
    const cRows = res.conditional.map(c => [
      s.probe === 'binary' ? `${nameOf(L, s.w)} = ${num(c.w, 0)}` : `${c.label} (${nameOf(L, s.w)} = ${num(c.w, d)})`, num(c.effect, d), num(c.se, d), num(c.t, d), pCell(c.p), ci(c.llci, c.ulci, d)
    ]);
    const t2 = {
      title: `${nameOf(L, s.w)} 수준별 ${nameOf(L, s.x)}의 조건부 효과`,
      headers: [`${nameOf(L, s.w)} 수준`, 'B', 'SE', 't', 'p', `${conf}% CI`],
      rows: cRows,
      note: s.center === 'mean' ? `${nameOf(L, s.w)} 값은 평균중심화된 값임(원점수 = 표시값 + ${num(res.means.w, d)}).` : ''
    };
    return [t1, t2];
  }

  function tables(res, opt) { return res.model === 'moderation' ? moderationTables(res, opt) : mediationTables(res, opt); }

  function tableToHTML(t, i) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let h = `<table class="apa"><caption><b>표 ${i + 1}</b><br><i>${esc(t.title)}</i></caption><thead><tr>${t.headers.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
    t.rows.forEach(r => {
      const isFit = r.slice(2).every(c => c === '') && r[1] && r[1].startsWith('R²');
      if (isFit) h += `<tr class="fit"><td></td><td colspan="${t.headers.length - 1}">${esc(r[1])}</td></tr>`;
      else h += '<tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>';
    });
    h += '</tbody></table>';
    if (t.note) h += `<p class="tnote"><i>주.</i> ${esc(t.note)}</p>`;
    return h;
  }
  function tableToTSV(t) {
    return [t.title, t.headers.join('\t')].concat(t.rows.map(r => r.join('\t'))).concat(t.note ? ['주. ' + t.note] : []).join('\n');
  }
  function tableToCSV(t) {
    const q = s => /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s;
    return [t.headers.map(q).join(',')].concat(t.rows.map(r => r.map(q).join(','))).join('\n');
  }

  // ---------- 결과 서술 ----------
  function pathSentence(pred, outcome, r, d, alpha) {
    const stat = `B = ${num(r.b, d)}, SE = ${num(r.se, d)}, t = ${num(r.t, d)}, p ${pStr(r.p)}`;
    if (r.p < alpha) return `${josa(pred, EUN)} ${josa(outcome, EUL)} 유의하게 ${r.b > 0 ? '정적으로' : '부적으로'} 예측하였다(${stat})`;
    return `${josa(pred, EUN)} ${josa(outcome, EUL)} 유의하게 예측하지 않았다(${stat})`;
  }
  function fitSentence(outcome, f, d) {
    return `이 회귀식은 ${outcome} 변량의 ${num(f.r2 * 100, 1)}%를 설명하였다(R² = ${noLead(f.r2, d)}, F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)})`;
  }

  function mediationText(res, opt) {
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
        const direct = r.p < alpha ? `${X}의 직접효과는 유의하였다(${dStat})` : `${X}의 직접효과는 유의하지 않았다(${dStat})`;
        body = medSents.join('. 또한 ') + '. ' + direct;
      }
      paras.push(intro + body + '. ' + fitSentence(O, f, d) + '.');
    });
    // 총효과
    const tr = res.total;
    const tStat = `B = ${num(tr.b, di)}, SE = ${num(tr.se, di)}, t = ${num(tr.t, d)}, p ${pStr(tr.p)}`;
    let tot = `매개변인을 투입하지 않았을 때 ${X}의 ${Y}에 대한 총효과는 ${tr.p < alpha ? '유의하였다' : '유의하지 않았다'}(${tStat}).`;
    // 간접효과
    if (s.boot > 0) {
      const routeTxt = r => {
        const ms = r.route.slice(1, -1).map(m => nameOf(L, m));
        return `${X}에서 ${josa(ms.join(', '), EUL)} ${ms.length > 1 ? '순차적으로 ' : ''}거쳐 ${josa(Y, RO)} 가는 간접효과`;
      };
      const indS = res.indirect.map(r => {
        const stat = `B = ${num(r.effect, di)}, Boot SE = ${num(r.bootSE, di)}, ${conf}% CI ${ci(r.llci, r.ulci, di)}`;
        const name = r.route ? routeTxt(r) : '총간접효과';
        return `${name}는 ${r.significant ? '신뢰구간에 0이 포함되지 않아 유의하였다' : '신뢰구간에 0이 포함되어 유의하지 않았다'}(${stat})`;
      });
      paras.push(tot + ` 부트스트랩 검증 결과, ` + indS.join('. ') + '.');
    } else paras.push(tot);
    return paras;
  }

  function moderationText(res, opt) {
    const L = opt.labels, d = opt.dec, s = res.spec, alpha = 1 - s.conf, conf = Math.round(s.conf * 100), f = res.equation.fit;
    const X = nameOf(L, s.x), W = nameOf(L, s.w), Y = nameOf(L, s.y);
    const covPre = s.covariates.length ? `${josa(joinKo(s.covariates.map(c => nameOf(L, c))), EUL)} 통제한 상태에서 ` : '';
    const ri = f.rows[3];
    const iStat = `B = ${num(ri.b, d)}, SE = ${num(ri.se, d)}, t = ${num(ri.t, d)}, p ${pStr(ri.p)}`;
    const ch = res.change;
    const chStat = `ΔR² = ${noLead(ch.dR2, 3)}, F(1, ${ch.df2}) = ${num(ch.F, d)}, p ${pStr(ch.p)}`;
    const paras = [];
    let p1 = `${covPre}${X}, ${W}, 그리고 두 변인의 상호작용항을 투입하여 ${josa(Y, EUL)} 예측한 결과, 회귀식은 ${Y} 변량의 ${num(f.r2 * 100, 1)}%를 설명하였다(R² = ${noLead(f.r2, d)}, F(${f.df1}, ${f.df2}) = ${num(f.F, d)}, p ${pStr(f.pF)}). `;
    if (ri.p < alpha) p1 += `${X} × ${W} 상호작용항은 ${josa(Y, EUL)} 유의하게 예측하였으며(${iStat}), 상호작용항 추가로 설명력이 유의하게 증가하였다(${chStat}). 이는 ${josa(X, WA)} ${Y}의 관계가 ${W}의 수준에 따라 달라짐을 의미한다.`;
    else p1 += `${X} × ${W} 상호작용항은 유의하지 않았으며(${iStat}; ${chStat}), ${W}의 조절효과는 확인되지 않았다.`;
    paras.push(p1);
    if (ri.p < alpha) {
      const cs = res.conditional.map(c => {
        const where = s.probe === 'binary' ? `${W} = ${num(c.w, 0)}일 때` : `${josa(W, I)} ${c.label}(${num(c.w, d)})일 때`;
        const stat = `B = ${num(c.effect, d)}, SE = ${num(c.se, d)}, t = ${num(c.t, d)}, p ${pStr(c.p)}, ${conf}% CI ${ci(c.llci, c.ulci, d)}`;
        return `${where} ${X}의 조건부 효과는 ${c.p < alpha ? (c.effect > 0 ? '유의한 정적 효과로 나타났고' : '유의한 부적 효과로 나타났고') : '유의하지 않았고'}(${stat})`;
      });
      let p2 = '단순기울기 분석 결과, ' + cs.join(', ').replace(/고\(([^)]*)\)$/, '다($1)') + '.';
      p2 = p2.replace(/나타났고\(([^()]*)\)\.$/, '나타났다($1).').replace(/않았고\(([^()]*)\)\.$/, '않았다($1).');
      if (res.jn) {
        const b = res.jn.bounds, cen = s.center === 'mean' ? '(평균중심화된 값 기준)' : '';
        if (b.length === 0) p2 += ` Johnson-Neyman 분석 결과, 관찰된 ${W}의 범위(${num(res.jn.wmin, d)} ~ ${num(res.jn.wmax, d)})${cen} 전체에서 조건부 효과가 ${res.jn.sigAtMin ? '유의하였다' : '유의하지 않았다'}.`;
        else if (b.length === 1) {
          const v = b[0];
          p2 += res.jn.sigAtMin
            ? ` Johnson-Neyman 분석 결과, ${josa(W + cen, I)} ${num(v.w, d)}보다 낮을 때(사례의 ${num(v.pctBelow, 1)}%) ${X}의 조건부 효과가 유의하였다.`
            : ` Johnson-Neyman 분석 결과, ${josa(W + cen, I)} ${num(v.w, d)}보다 높을 때(사례의 ${num(v.pctAbove, 1)}%) ${X}의 조건부 효과가 유의하였다.`;
        } else {
          p2 += res.jn.sigAtMin
            ? ` Johnson-Neyman 분석 결과, ${josa(W + cen, I)} ${num(b[0].w, d)}보다 낮거나 ${num(b[1].w, d)}보다 높을 때 ${X}의 조건부 효과가 유의하였다.`
            : ` Johnson-Neyman 분석 결과, ${josa(W + cen, I)} ${num(b[0].w, d)}에서 ${num(b[1].w, d)} 사이일 때 ${X}의 조건부 효과가 유의하였다.`;
        }
      }
      paras.push(p2);
    }
    return paras;
  }

  function resultText(res, opt) { return res.model === 'moderation' ? moderationText(res, opt) : mediationText(res, opt); }

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
    const lab = r => `${num(r.b, d)}${stars(r.p)}`;
    let g = '';
    // 경로
    res.equations.slice(0, k).forEach((eq, i) => {
      const f = eq.fit;
      g += arrow(X, Ms[i], lab(f.rows[1]), { dx: -14, dy: -4 });
      for (let j = 0; j < i; j++) g += arrow(Ms[j], Ms[i], lab(f.rows[2 + j]), j === i - 1 ? { dy: -8 } : { curve: 40 + 15 * (i - j) });
    });
    const fy = res.equations[k].fit;
    Ms.forEach((m, i) => (g += arrow(m, Yn, lab(fy.rows[2 + i]), { dx: 14, dy: -4 })));
    const cp = fy.rows[1], tot = res.total;
    g += arrow(X, Yn, `${lab(cp)} (${num(tot.b, d)}${stars(tot.p)})`, { dy: 20 });
    g += box(X.x, X.y, X.w, X.h, nameOf(L, s.x)) + box(Yn.x, Yn.y, Yn.w, Yn.h, nameOf(L, s.y));
    Ms.forEach((m, i) => (g += box(m.x, m.y, m.w, m.h, nameOf(L, s.mediators[i]))));
    const note = `비표준화 계수. 괄호 안은 총효과.${s.covariates.length ? ' 공변인 경로는 생략함.' : ''} *p < .05, **p < .01, ***p < .001.`;
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

  function figures(res, opt) {
    if (res.model === 'moderation') return [{ title: '조절모형 그림', svg: moderationFigure(res, opt) }, { title: '단순기울기 그림', svg: slopeFigure(res, opt) }];
    return [{ title: MODEL_INFO[res.model].title + ' 그림', svg: mediationFigure(res, opt) }];
  }

  const CAUTION = [
    '이 문장은 계산값을 정해진 문장 틀에 채운 초안임. 연구 설계와 가설에 맞게 연구자가 검토·수정해야 함.',
    '횡단 설문 자료의 매개·조절 분석 결과만으로 인과관계나 시간적 선후관계가 입증되지 않음.',
    '논문에는 실제 사용한 분석 도구와 설정을 기재해야 함. 이 도구로 분석했다면 SPSS PROCESS로 분석했다고 쓰면 안 됨.'
  ];

  const api = { methodText, tables, tableToHTML, tableToTSV, tableToCSV, resultText, figures, josa, num, pStr, MODEL_INFO, HAYES_REF, CAUTION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Report = api;
})(typeof window !== 'undefined' ? window : this);
