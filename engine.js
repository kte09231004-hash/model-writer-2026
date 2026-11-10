/*
 * 매개·조절 분석 계산 엔진 (MVP)
 * - 최소제곱(OLS) 회귀, 일반(동분산 가정) 표준오차
 * - 단순매개(매개변인 1개) / 순차매개(매개변인 2~4개) / 조절(X×W)
 * - 간접효과: 사례 재표집 부트스트랩, 백분위수(percentile) 신뢰구간
 * 외부 라이브러리 없이 브라우저와 Node.js에서 모두 동작함.
 */
(function (root) {
  'use strict';

  // ---------- 분포 함수 ----------
  function logGamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  // 정규화된 불완전 베타함수 I_x(a,b)
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  // t 분포 양측 p
  function tPvalue(t, df) { return ibeta(df / (df + t * t), df / 2, 0.5); }
  // F 분포 상측 p
  function fPvalue(F, df1, df2) {
    if (!(F > 0)) return 1;
    return ibeta(df2 / (df2 + df1 * F), df2 / 2, df1 / 2);
  }
  // 양측 신뢰수준 conf에 해당하는 t 임계값
  function tCrit(conf, df) {
    const alpha = 1 - conf;
    let lo = 0, hi = 1e4;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tPvalue(mid, df) > alpha) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------- 행렬 ----------
  function invert(A) {
    const n = A.length;
    const M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let col = 0; col < n; col++) {
      let piv = col, best = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > best) { best = Math.abs(M[r][col]); piv = r; }
      if (best < 1e-12) return null; // 특이행렬
      [M[col], M[piv]] = [M[piv], M[col]];
      const p = M[col][col];
      for (let j = 0; j < 2 * n; j++) M[col][j] /= p;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
      }
    }
    return M.map(r => r.slice(n));
  }

  // ---------- 기술통계 ----------
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); }
  // 백분위수: (n+1)p 위치 가중평균 (SPSS FREQUENCIES 기본 HAVERAGE 방식과 같은 정의)
  function percentile(a, p) {
    const s = a.slice().sort((x, y) => x - y), n = s.length;
    const pos = (n + 1) * p;
    if (pos <= 1) return s[0];
    if (pos >= n) return s[n - 1];
    const k = Math.floor(pos), frac = pos - k;
    return s[k - 1] + frac * (s[k] - s[k - 1]);
  }
  const uniqueVals = a => Array.from(new Set(a)).sort((x, y) => x - y);

  // ---------- 회귀 ----------
  // y: 배열, cols: [{name, values}], 절편 자동 포함
  function ols(y, cols, opts) {
    opts = opts || {};
    const n = y.length, p = cols.length + 1;
    const X = new Array(n);
    for (let i = 0; i < n; i++) { const r = new Array(p); r[0] = 1; for (let j = 0; j < cols.length; j++) r[j + 1] = cols[j].values[i]; X[i] = r; }
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const r = X[i];
      for (let a = 0; a < p; a++) { Xty[a] += r[a] * y[i]; for (let b = a; b < p; b++) XtX[a][b] += r[a] * r[b]; }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    const inv = invert(XtX);
    if (!inv) return null;
    const coef = inv.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0));
    if (opts.coefOnly) return { coef };
    let sse = 0; const ym = mean(y); let sst = 0;
    for (let i = 0; i < n; i++) {
      let fit = 0; for (let j = 0; j < p; j++) fit += X[i][j] * coef[j];
      sse += (y[i] - fit) ** 2; sst += (y[i] - ym) ** 2;
    }
    const df = n - p, mse = sse / df;
    const conf = opts.conf || 0.95, tc = tCrit(conf, df);
    const names = ['상수'].concat(cols.map(c => c.name));
    const rows = coef.map((b, j) => {
      const se = Math.sqrt(mse * inv[j][j]), t = b / se;
      return { name: names[j], b, se, t, p: tPvalue(t, df), llci: b - tc * se, ulci: b + tc * se };
    });
    const r2 = 1 - sse / sst, k = p - 1;
    const F = (r2 / k) / ((1 - r2) / df);
    return { n, rows, coef, cov: inv.map(r => r.map(v => v * mse)), r2, R: Math.sqrt(r2), mse, F, df1: k, df2: df, pF: fPvalue(F, k, df), tcrit: tc };
  }

  // ---------- 난수(시드 고정) ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 백분위수 부트스트랩 구간: 정렬값에서 하한 ceil(B*α/2)번째, 상한 floor(B*(1-α/2))+1번째 값
  function bootCI(arr, conf) {
    const s = arr.slice().sort((x, y) => x - y), B = s.length, a = (1 - conf) / 2;
    const lo = Math.max(1, Math.ceil(B * a)), hi = Math.min(B, Math.floor(B * (1 - a)) + 1);
    return [s[lo - 1], s[hi - 1]];
  }

  // ---------- 데이터 준비 ----------
  function toNumber(v, missingCodes) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim();
    if (s === '') return NaN;
    const x = Number(s);
    if (!isFinite(x)) return NaN;
    if (missingCodes && missingCodes.includes(x)) return NaN;
    return x;
  }
  // 분석에 쓰는 변수 모두에 값이 있는 사례만 사용(목록별 삭제)
  function prepare(rows, vars, missingCodes) {
    const out = {}; vars.forEach(v => (out[v] = []));
    let dropped = 0;
    for (const r of rows) {
      const vals = vars.map(v => toNumber(r[v], missingCodes));
      if (vals.some(x => isNaN(x))) { dropped++; continue; }
      vars.forEach((v, j) => out[v].push(vals[j]));
    }
    return { data: out, n: rows.length - dropped, dropped, nTotal: rows.length };
  }

  function standardizedRows(fit, outcomeVals, colVals) {
    const sy = sd(outcomeVals);
    fit.rows.forEach((r, j) => { r.beta = j === 0 ? null : r.b * sd(colVals[j - 1]) / sy; });
  }

  // ---------- 매개(단순·순차) ----------
  // spec: {x, mediators:[...], y, covariates:[], boot:5000, seed, conf:.95, missingCodes:[]}
  function mediation(rows, spec) {
    const covs = spec.covariates || [];
    const meds = spec.mediators;
    if (!meds || meds.length < 1) throw new Error('매개변인을 1개 이상 지정해야 함');
    const allVars = [spec.x].concat(meds, [spec.y], covs);
    if (new Set(allVars).size !== allVars.length) throw new Error('한 변수를 두 가지 역할에 동시에 지정할 수 없음');
    const conf = spec.conf || 0.95, B = spec.boot == null ? 5000 : spec.boot, seed = spec.seed == null ? 1 : spec.seed;
    const prep = prepare(rows, allVars, spec.missingCodes);
    const D = prep.data, n = prep.n, k = meds.length;
    if (n < allVars.length + 3) throw new Error('분석 가능한 사례 수가 너무 적음 (n=' + n + ')');
    const warnings = [];
    if (uniqueVals(D[spec.x]).length === 2) warnings.push('X가 두 값만 가지는 변수임. 표준화 계수(β)는 해석에 주의가 필요함.');

    // 회귀식 정의: Mi ~ X + M1..M(i-1) + C ; Y ~ X + M + C ; 총효과 Y ~ X + C
    const eqDefs = [];
    for (let i = 0; i < k; i++) eqDefs.push({ outcome: meds[i], preds: [spec.x].concat(meds.slice(0, i), covs) });
    eqDefs.push({ outcome: spec.y, preds: [spec.x].concat(meds, covs) });
    const totalDef = { outcome: spec.y, preds: [spec.x].concat(covs) };

    function fitAll(idx, coefOnly) {
      const pick = v => (idx ? idx.map(i => D[v][i]) : D[v]);
      const res = [];
      for (const e of eqDefs) {
        const f = ols(pick(e.outcome), e.preds.map(p => ({ name: p, values: pick(p) })), { conf, coefOnly });
        if (!f) return null;
        res.push(f);
      }
      return res;
    }
    // 경로계수 추출: a[i] (X→Mi), d[i][j] (Mj→Mi, j<i), b[i] (Mi→Y), cp (X→Y 직접)
    function paths(fits) {
      const a = [], d = [], b = [];
      for (let i = 0; i < k; i++) { a.push(fits[i].coef[1]); d.push(fits[i].coef.slice(2, 2 + i)); }
      const fy = fits[k].coef;
      for (let i = 0; i < k; i++) b.push(fy[2 + i]);
      return { a, d, b, cp: fy[1] };
    }
    // 간접 경로: 매개변인의 순서를 유지하는 모든 부분집합
    const routes = [];
    for (let mask = 1; mask < (1 << k); mask++) {
      const s = []; for (let i = 0; i < k; i++) if (mask & (1 << i)) s.push(i);
      routes.push(s);
    }
    routes.sort((p, q) => (p[0] - q[0]) || (p.length - q.length) || (p.join() < q.join() ? -1 : 1));
    function indirects(P) {
      return routes.map(s => {
        let v = P.a[s[0]];
        for (let t = 1; t < s.length; t++) v *= P.d[s[t]][s[t - 1]];
        return v * P.b[s[s.length - 1]];
      });
    }

    const fits = fitAll(null, false);
    if (!fits) throw new Error('회귀식을 계산할 수 없음(변수 간 완전 공선성 등)');
    fits.forEach((f, i) => standardizedRows(f, D[eqDefs[i].outcome], eqDefs[i].preds.map(p => D[p])));
    const totalFit = ols(D[spec.y], totalDef.preds.map(p => ({ name: p, values: D[p] })), { conf });
    standardizedRows(totalFit, D[spec.y], totalDef.preds.map(p => D[p]));
    const P = paths(fits);
    const ind = indirects(P);
    const totalInd = ind.reduce((s, v) => s + v, 0);
    const sdX = sd(D[spec.x]), sdY = sd(D[spec.y]);

    // 부트스트랩
    const bootInd = routes.map(() => []), bootTot = [];
    let failed = 0;
    if (B > 0) {
      const rnd = mulberry32(seed);
      const idx = new Array(n);
      let done = 0, guard = 0;
      while (done < B && guard < B * 10) {
        guard++;
        for (let i = 0; i < n; i++) idx[i] = Math.floor(rnd() * n);
        const bf = fitAll(idx, true);
        if (!bf) { failed++; continue; }
        const bi = indirects(paths(bf));
        bi.forEach((v, j) => bootInd[j].push(v));
        bootTot.push(bi.reduce((s, v) => s + v, 0));
        done++;
      }
    }
    const medLabel = i => 'M' + (k === 1 ? '' : i + 1);
    function effRow(label, routeNames, est, boots) {
      const r = { label, route: routeNames, effect: est, std: est * sdX / sdY };
      if (boots.length) {
        const ci = bootCI(boots, conf);
        r.bootSE = sd(boots); r.llci = ci[0]; r.ulci = ci[1];
        const sci = bootCI(boots.map(v => v * sdX / sdY), conf);
        r.stdLlci = sci[0]; r.stdUlci = sci[1];
        r.significant = !(ci[0] <= 0 && ci[1] >= 0);
      }
      return r;
    }
    const indirectRows = routes.map((s, j) => effRow(
      'Ind' + (j + 1),
      [spec.x].concat(s.map(i => meds[i]), [spec.y]),
      ind[j], bootInd[j]));
    if (k > 1) indirectRows.push(effRow('총간접효과', null, totalInd, bootTot));

    const cpRow = fits[k].rows[1], cRow = totalFit.rows[1];
    return {
      model: k === 1 ? 'simple' : 'serial',
      spec: { x: spec.x, mediators: meds, y: spec.y, covariates: covs, boot: B, seed, conf },
      sample: { nTotal: prep.nTotal, n, dropped: prep.dropped },
      descriptives: allVars.map(v => ({ name: v, mean: mean(D[v]), sd: sd(D[v]) })),
      equations: eqDefs.map((e, i) => ({ outcome: e.outcome, predictors: e.preds, fit: fits[i] })),
      totalEquation: { outcome: spec.y, predictors: totalDef.preds, fit: totalFit },
      paths: P,
      total: Object.assign({ std: cRow.b * sdX / sdY }, cRow),
      direct: Object.assign({ std: cpRow.b * sdX / sdY }, cpRow),
      indirect: indirectRows,
      bootFailed: failed,
      warnings,
      medLabel
    };
  }

  // ---------- 조절 ----------
  // spec: {x, w, y, covariates, center:'none'|'mean', probe:'percentile'|'meansd', conf, jn:true}
  function moderation(rows, spec) {
    const covs = spec.covariates || [];
    const allVars = [spec.x, spec.w, spec.y].concat(covs);
    if (new Set(allVars).size !== allVars.length) throw new Error('한 변수를 두 가지 역할에 동시에 지정할 수 없음');
    const conf = spec.conf || 0.95;
    const prep = prepare(rows, allVars, spec.missingCodes);
    const D = prep.data, n = prep.n;
    if (n < allVars.length + 4) throw new Error('분석 가능한 사례 수가 너무 적음 (n=' + n + ')');
    const center = spec.center || 'none';
    const mx = mean(D[spec.x]), mw = mean(D[spec.w]);
    const X = center === 'mean' ? D[spec.x].map(v => v - mx) : D[spec.x];
    const W = center === 'mean' ? D[spec.w].map(v => v - mw) : D[spec.w];
    const XW = X.map((v, i) => v * W[i]);
    const intName = spec.x + ' × ' + spec.w;
    const cols = [{ name: spec.x, values: X }, { name: spec.w, values: W }, { name: intName, values: XW }]
      .concat(covs.map(c => ({ name: c, values: D[c] })));
    const fit = ols(D[spec.y], cols, { conf });
    if (!fit) throw new Error('회귀식을 계산할 수 없음(변수 간 완전 공선성 등)');
    const reduced = ols(D[spec.y], cols.filter((_, j) => j !== 2), { conf });
    const dR2 = fit.r2 - reduced.r2;
    const Fch = dR2 / ((1 - fit.r2) / fit.df2);
    const change = { dR2, F: Fch, df1: 1, df2: fit.df2, p: fPvalue(Fch, 1, fit.df2) };

    const b1 = fit.coef[1], b3 = fit.coef[3];
    const V = fit.cov, v11 = V[1][1], v13 = V[1][3], v33 = V[3][3];
    const tc = fit.tcrit;
    const wUniq = uniqueVals(W);
    let probeVals, probeLabels, probeType;
    if (wUniq.length === 2) {
      probeVals = wUniq; probeLabels = ['', '']; probeType = 'binary';
    } else if (spec.probe === 'meansd') {
      const m = mean(W), s = sd(W);
      probeVals = [m - s, m, m + s]; probeLabels = ['M − 1SD', 'M', 'M + 1SD']; probeType = 'meansd';
    } else {
      probeVals = [0.16, 0.5, 0.84].map(p => percentile(W, p));
      probeLabels = ['16번째 백분위', '50번째 백분위', '84번째 백분위']; probeType = 'percentile';
    }
    const cond = probeVals.map((w, i) => {
      const eff = b1 + b3 * w, se = Math.sqrt(v11 + 2 * w * v13 + w * w * v33), t = eff / se;
      return { label: probeLabels[i], w, wRaw: center === 'mean' ? w + mw : w, effect: eff, se, t, p: tPvalue(t, fit.df2), llci: eff - tc * se, ulci: eff + tc * se };
    });

    // Johnson-Neyman 경계값
    let jn = null;
    if (wUniq.length > 2 && spec.jn !== false) {
      const A = b3 * b3 - tc * tc * v33, Bq = 2 * (b1 * b3 - tc * tc * v13), C = b1 * b1 - tc * tc * v11;
      const wmin = wUniq[0], wmax = wUniq[wUniq.length - 1];
      let roots = [];
      if (Math.abs(A) < 1e-14) { if (Math.abs(Bq) > 1e-14) roots = [-C / Bq]; }
      else { const disc = Bq * Bq - 4 * A * C; if (disc >= 0) roots = [(-Bq - Math.sqrt(disc)) / (2 * A), (-Bq + Math.sqrt(disc)) / (2 * A)]; }
      roots = roots.filter(r => r >= wmin && r <= wmax).sort((a, b) => a - b);
      jn = roots.map(r => ({
        w: r, wRaw: center === 'mean' ? r + mw : r,
        pctBelow: 100 * W.filter(v => v < r).length / n,
        pctAbove: 100 * W.filter(v => v > r).length / n
      }));
      // 관찰 범위의 양 끝에서 조건부 효과 유의 여부
      const sigAt = w => { const e = b1 + b3 * w, s = Math.sqrt(v11 + 2 * w * v13 + w * w * v33); return Math.abs(e / s) >= tc; };
      jn = { bounds: jn, sigAtMin: sigAt(wmin), sigAtMax: sigAt(wmax), wmin, wmax };
    }

    // 단순기울기 그림용 예측값: X는 16·84번째 백분위(또는 M±1SD), 공변량은 평균
    const xLoHi = spec.probe === 'meansd' ? [mean(X) - sd(X), mean(X) + sd(X)] : [percentile(X, 0.16), percentile(X, 0.84)];
    const covMeans = covs.map(c => mean(D[c]));
    const lines = probeVals.map((w, i) => ({
      label: probeLabels[i], w, wRaw: cond[i].wRaw,
      points: xLoHi.map(x => {
        let yhat = fit.coef[0] + b1 * x + fit.coef[2] * w + b3 * x * w;
        covMeans.forEach((m, j) => (yhat += fit.coef[4 + j] * m));
        return { x, xRaw: center === 'mean' ? x + mx : x, y: yhat };
      })
    }));

    return {
      model: 'moderation',
      spec: { x: spec.x, w: spec.w, y: spec.y, covariates: covs, center, probe: probeType, conf },
      sample: { nTotal: prep.nTotal, n, dropped: prep.dropped },
      descriptives: allVars.map(v => ({ name: v, mean: mean(D[v]), sd: sd(D[v]) })),
      equation: { outcome: spec.y, fit },
      change, conditional: cond, jn, lines, means: { x: mx, w: mw },
      warnings: []
    };
  }

  // ---------- 문항 채점 ----------
  // def: {name, items:[...], reverse:[...], min, max, method:'mean'|'sum'}
  // 문항 중 하나라도 결측이면 해당 사례의 점수는 결측 처리
  function scoreScale(rows, def, missingCodes) {
    const rev = new Set(def.reverse || []);
    const k = def.items.length;
    const complete = [];
    const scores = rows.map(r => {
      const vals = def.items.map(it => {
        const v = toNumber(r[it], missingCodes);
        return rev.has(it) ? def.min + def.max - v : v;
      });
      if (vals.some(v => isNaN(v))) return '';
      complete.push(vals);
      const s = vals.reduce((a, b) => a + b, 0);
      return def.method === 'sum' ? s : s / k;
    });
    let alpha = null;
    if (k >= 2 && complete.length > 2) {
      const itemVar = def.items.map((_, j) => { const c = complete.map(r => r[j]); return sd(c) ** 2; });
      const totVar = sd(complete.map(r => r.reduce((a, b) => a + b, 0))) ** 2;
      alpha = (k / (k - 1)) * (1 - itemVar.reduce((a, b) => a + b, 0) / totVar);
    }
    // 범위 밖 응답 확인
    let outOfRange = 0;
    rows.forEach(r => def.items.forEach(it => { const v = toNumber(r[it], missingCodes); if (!isNaN(v) && (v < def.min || v > def.max)) outOfRange++; }));
    return { scores, alpha, nComplete: complete.length, outOfRange };
  }

  const api = { ols, mediation, moderation, scoreScale, tPvalue, fPvalue, tCrit, percentile, bootCI, mulberry32, mean, sd, prepare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : this);
