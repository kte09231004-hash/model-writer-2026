/*
 * 매개·조절 분석 계산 엔진
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
    const fitted = new Array(n), resid = new Array(n), lev = new Array(n);
    for (let i = 0; i < n; i++) {
      let fit = 0; for (let j = 0; j < p; j++) fit += X[i][j] * coef[j];
      fitted[i] = fit; resid[i] = y[i] - fit;
      sse += resid[i] ** 2; sst += (y[i] - ym) ** 2;
      // 레버리지 h_ii = x_i' (X'X)^-1 x_i
      let h = 0; for (let a = 0; a < p; a++) { let t = 0; for (let b = 0; b < p; b++) t += inv[a][b] * X[i][b]; h += X[i][a] * t; }
      lev[i] = h;
    }
    const df = n - p, mse = sse / df;
    const conf = opts.conf || 0.95, tc = tCrit(conf, df);
    const names = ['상수'].concat(cols.map(c => c.name));
    // 공분산 행렬: 일반(OLS) 또는 HC3 = (X'X)^-1 [Σ x_i x_i' e_i²/(1-h_i)²] (X'X)^-1
    let cov;
    const seType = opts.se === 'hc3' ? 'hc3' : 'ols';
    if (seType === 'hc3') {
      if (lev.some(h => h >= 1 - 1e-10)) throw new Error('레버리지가 1인 사례가 있어 HC3 표준오차를 계산할 수 없음(한 사례가 회귀식을 완전히 결정함)');
      const M = Array.from({ length: p }, () => new Array(p).fill(0));
      for (let i = 0; i < n; i++) { const w = resid[i] ** 2 / (1 - lev[i]) ** 2; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] += w * X[i][a] * X[i][b]; }
      const IM = inv.map(r => M[0].map((_, b) => r.reduce((s2, v, k2) => s2 + v * M[k2][b], 0)));
      cov = IM.map(r => inv[0].map((_, b) => r.reduce((s2, v, k2) => s2 + v * inv[k2][b], 0)));
    } else cov = inv.map(r => r.map(v => v * mse));
    const rows = coef.map((b, j) => {
      const se = Math.sqrt(cov[j][j]), t = b / se;
      return { name: names[j], b, se, t, p: tPvalue(t, df), llci: b - tc * se, ulci: b + tc * se };
    });
    const r2 = 1 - sse / sst, k = p - 1;
    let F;
    if (seType === 'hc3') {
      // 기울기 전체에 대한 Wald 검정: F = b' V^-1 b / k (V = HC3 공분산의 기울기 부분)
      const bs = coef.slice(1), Vs = cov.slice(1).map(r => r.slice(1)), Vi = invert(Vs);
      F = Vi ? bs.reduce((s2, bi, a) => s2 + bi * Vi[a].reduce((s3, v, c) => s3 + v * bs[c], 0), 0) / k : NaN;
    } else F = (r2 / k) / ((1 - r2) / df);
    return { n, rows, coef, cov, seType, r2, R: Math.sqrt(r2), mse, F, df1: k, df2: df, pF: fPvalue(F, k, df), tcrit: tc, fitted, resid, lev, p };
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
    let dropped = 0; const idx = [];
    rows.forEach((r, i) => {
      const vals = vars.map(v => toNumber(r[v], missingCodes));
      if (vals.some(x => isNaN(x))) { dropped++; return; }
      vars.forEach((v, j) => out[v].push(vals[j])); idx.push(i);
    });
    return { data: out, n: rows.length - dropped, dropped, nTotal: rows.length, idx };
  }

  // 분석 표본에서 값이 하나뿐인 변수(상수)를 찾아 구체적으로 알림
  function assertNotConstant(D, vars) {
    vars.forEach(v => { if (uniqueVals(D[v]).length < 2) throw new Error(`변수 '${v}'의 값이 분석 표본에서 모두 같음(상수, 값 = ${D[v][0]}). 상수 변수는 회귀식에 넣을 수 없음`); });
  }
  function collinearError(outcome, preds) {
    return new Error(`회귀식(종속변인 '${outcome}')의 예측변인 ${preds.map(p => `'${p}'`).join(', ')} 사이에 완전한 선형 종속이 있어 계수를 추정할 수 없음. 같은 정보를 담은 변수(예: 합계와 평균, 같은 변수의 복사본)가 함께 들어갔는지 확인 필요`);
  }

  // ---------- 회귀 진단 ----------
  // 각 회귀식에 실제로 투입된 예측변수와 분석 표본으로 계산함
  // VIF_j = 1 / (1 − R²_j), R²_j: 예측변수 j를 같은 식의 나머지 예측변수로 회귀한 결정계수
  // Cook's D_i = e_i² h_i / (p · MSE · (1 − h_i)²), 표준화 잔차 r_i = e_i / √(MSE (1 − h_i))
  function diagnose(outcome, cols, fit, idx) {
    const n = fit.n, p = fit.p;
    const vif = cols.map((c, j) => {
      if (cols.length < 2) return { name: c.name, vif: 1, tol: 1 };
      const others = cols.filter((_, k) => k !== j);
      const f = ols(c.values, others, { conf: 0.95 });
      if (!f) return { name: c.name, vif: Infinity, tol: 0 };
      return { name: c.name, vif: 1 / (1 - f.r2), tol: 1 - f.r2 };
    });
    const cook = fit.resid.map((e, i) => (e * e * fit.lev[i]) / (p * fit.mse * (1 - fit.lev[i]) ** 2));
    const stdres = fit.resid.map((e, i) => e / Math.sqrt(fit.mse * (1 - fit.lev[i])));
    const cut = 4 / n;
    const order = cook.map((d, i) => i).sort((a, b) => cook[b] - cook[a]);
    const top = order.slice(0, 5).map(i => ({ row: idx[i] + 1, cook: cook[i], lev: fit.lev[i], stdres: stdres[i] }));
    return { outcome, n, p, vif, cook, stdres, fitted: fit.fitted, lev: fit.lev, rows: idx.map(i => i + 1),
      maxCook: Math.max(...cook), nCookOver: cook.filter(d => d > cut).length, nCookOver1: cook.filter(d => d > 1).length, cookCut: cut,
      nStdresOver3: stdres.filter(r => Math.abs(r) > 3).length, top };
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
    const conf = spec.conf || 0.95, B = spec.boot == null ? 5000 : spec.boot, seed = spec.seed == null ? 1 : spec.seed, se = spec.se === 'hc3' ? 'hc3' : 'ols';
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

    assertNotConstant(D, allVars);
    const fits = [];
    for (const e of eqDefs) {
      const f = ols(D[e.outcome], e.preds.map(p => ({ name: p, values: D[p] })), { conf, se });
      if (!f) throw collinearError(e.outcome, e.preds);
      fits.push(f);
    }
    fits.forEach((f, i) => standardizedRows(f, D[eqDefs[i].outcome], eqDefs[i].preds.map(p => D[p])));
    const totalFit = ols(D[spec.y], totalDef.preds.map(p => ({ name: p, values: D[p] })), { conf, se });
    if (!totalFit) throw collinearError(spec.y, totalDef.preds);
    const diagnostics = eqDefs.map((e, i) => diagnose(e.outcome, e.preds.map(p => ({ name: p, values: D[p] })), fits[i], prep.idx));
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

    // ---------- 추가 검정 (분석 옵션에서 선택한 경우에만 표·문장으로 보고) ----------
    // 간접효과 경로 간 차이(Hayes PROCESS의 contrast와 같은 방식): 같은 부트스트랩 표본마다 두 간접효과의 차이를 구해
    //   SE(표본 표준편차)와 백분위수 신뢰구간을 산출. raw = Ind_i − Ind_j, abs = |Ind_i| − |Ind_j|
    //   표에 쓰는 경로 순서가 보고 형식에 따라 달라지므로 두 방향(i − j, j − i)을 모두 부트스트랩 값에서 직접 계산함
    //   (부호만 바꿔 유도하면 bootCI의 하한·상한 순위 계산에서 소수 오차로 한 순위 어긋날 수 있음)
    const contrasts = [];
    if (routes.length > 1 && bootInd[0].length) {
      const one = (f, i, j) => {
        const est = f(ind[i], ind[j]), draws = bootInd[i].map((v, t) => f(v, bootInd[j][t])), c = bootCI(draws, conf);
        return { effect: est, bootSE: sd(draws), llci: c[0], ulci: c[1], significant: !(c[0] <= 0 && c[1] >= 0) };
      };
      for (let i = 0; i < routes.length; i++) for (let j = 0; j < routes.length; j++) if (i !== j)
        contrasts.push({ i, j, raw: one((p, q) => p - q, i, j), abs: one((p, q) => Math.abs(p) - Math.abs(q), i, j) });
    }

    const cpRow = fits[k].rows[1], cRow = totalFit.rows[1];
    return {
      model: k === 1 ? 'simple' : 'serial',
      spec: { x: spec.x, mediators: meds, y: spec.y, covariates: covs, boot: B, seed, conf, se },
      diagnostics,
      sample: { nTotal: prep.nTotal, n, dropped: prep.dropped },
      descriptives: allVars.map(v => ({ name: v, mean: mean(D[v]), sd: sd(D[v]) })),
      equations: eqDefs.map((e, i) => ({ outcome: e.outcome, predictors: e.preds, fit: fits[i] })),
      totalEquation: { outcome: spec.y, predictors: totalDef.preds, fit: totalFit },
      paths: P,
      total: Object.assign({ std: cRow.b * sdX / sdY }, cRow),
      direct: Object.assign({ std: cpRow.b * sdX / sdY }, cpRow),
      indirect: indirectRows,
      contrasts,
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
    const conf = spec.conf || 0.95, se = spec.se === 'hc3' ? 'hc3' : 'ols';
    const prep = prepare(rows, allVars, spec.missingCodes);
    const D = prep.data, n = prep.n;
    if (n < allVars.length + 4) throw new Error('분석 가능한 사례 수가 너무 적음 (n=' + n + ')');
    assertNotConstant(D, allVars);
    const center = spec.center || 'none';
    const mx = mean(D[spec.x]), mw = mean(D[spec.w]);
    const X = center === 'mean' ? D[spec.x].map(v => v - mx) : D[spec.x];
    const W = center === 'mean' ? D[spec.w].map(v => v - mw) : D[spec.w];
    const XW = X.map((v, i) => v * W[i]);
    const intName = spec.x + ' × ' + spec.w;
    const cols = [{ name: spec.x, values: X }, { name: spec.w, values: W }, { name: intName, values: XW }]
      .concat(covs.map(c => ({ name: c, values: D[c] })));
    const fit = ols(D[spec.y], cols, { conf, se });
    if (!fit) throw collinearError(spec.y, cols.map(c => c.name));
    const reduced = ols(D[spec.y], cols.filter((_, j) => j !== 2), { conf });
    const dR2 = fit.r2 - reduced.r2;
    // 상호작용항 검정: 일반 SE는 R² 변화량 F, HC3는 상호작용 계수의 강건 Wald 검정(F = t²)
    const Fch = se === 'hc3' ? fit.rows[3].t ** 2 : dR2 / ((1 - fit.r2) / fit.df2);
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

    // Johnson-Neyman: |b1 + b3·w| / SE(w) = t임계값 을 만족하는 w (조건부 효과 유의성이 바뀌는 지점)
    // status: all_sig(관측 범위 전체 유의) / none_sig(전체 비유의) / changes(범위 안에서 바뀜)
    //         / failed(수치 문제로 계산 불가) / not_applicable(W가 두 값뿐)
    const toRaw = w => (center === 'mean' ? w + mw : w);
    let jn;
    if (wUniq.length <= 2) {
      jn = { status: 'not_applicable', reason: '조절변인이 두 값만 가지므로 Johnson-Neyman 방법을 적용하지 않음', conf };
    } else {
      const wmin = wUniq[0], wmax = wUniq[wUniq.length - 1];
      const base = { conf, tcrit: tc, df: fit.df2, scale: center === 'mean' ? 'centered' : 'raw', wmin, wmax, wminRaw: toRaw(wmin), wmaxRaw: toRaw(wmax) };
      const seAt = w => Math.sqrt(v11 + 2 * w * v13 + w * w * v33);
      const sigAt = w => Math.abs((b1 + b3 * w) / seAt(w)) >= tc;
      try {
        const A = b3 * b3 - tc * tc * v33, Bq = 2 * (b1 * b3 - tc * tc * v13), C = b1 * b1 - tc * tc * v11;
        if (![A, Bq, C, v11, v13, v33].every(isFinite)) throw new Error('회귀계수 또는 공분산 값이 유한하지 않음');
        let roots = [];
        const scaleA = Math.max(b3 * b3, tc * tc * v33, 1e-300);
        if (Math.abs(A) / scaleA < 1e-12) { if (Math.abs(Bq) > 1e-300) roots = [-C / Bq]; }
        else {
          const disc = Bq * Bq - 4 * A * C;
          if (disc >= 0) { const sq = Math.sqrt(disc); roots = [(-Bq - sq) / (2 * A), (-Bq + sq) / (2 * A)]; }
        }
        if (!roots.every(isFinite)) throw new Error('경계값이 유한하지 않음');
        roots.sort((a, b) => a - b);
        const all = roots.map(r => ({
          w: r, wRaw: toRaw(r), inRange: r >= wmin && r <= wmax,
          pctBelow: 100 * W.filter(v => v < r).length / n,
          pctAbove: 100 * W.filter(v => v > r).length / n
        }));
        const bounds = all.filter(b => b.inRange);
        // 관측 범위를 경계값으로 나눈 구간별 유의 여부(구간 중앙에서 판정)
        const cuts = [wmin].concat(bounds.map(b => b.w), [wmax]);
        const segments = [];
        for (let i = 0; i < cuts.length - 1; i++) {
          const lo = cuts[i], hi = cuts[i + 1];
          if (hi - lo <= 0) continue;
          const sig = sigAt((lo + hi) / 2);
          segments.push({ from: lo, to: hi, fromRaw: toRaw(lo), toRaw: toRaw(hi), sig, pct: 100 * W.filter(v => v >= lo && v <= hi).length / n });
        }
        if (!segments.length) throw new Error('관측 범위를 구간으로 나눌 수 없음');
        const anySig = segments.some(s => s.sig), allSig = segments.every(s => s.sig);
        const status = allSig ? 'all_sig' : !anySig ? 'none_sig' : 'changes';
        jn = Object.assign(base, { status, roots: all, bounds, outside: all.filter(b => !b.inRange), segments, sigAtMin: sigAt(wmin), sigAtMax: sigAt(wmax) });
      } catch (e) {
        jn = Object.assign(base, { status: 'failed', reason: e.message, roots: [], bounds: [], outside: [], segments: [] });
      }
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
      spec: { x: spec.x, w: spec.w, y: spec.y, covariates: covs, center, probe: probeType, conf, se },
      diagnostics: [diagnose(spec.y, cols, fit, prep.idx)],
      sample: { nTotal: prep.nTotal, n, dropped: prep.dropped },
      descriptives: allVars.map(v => ({ name: v, mean: mean(D[v]), sd: sd(D[v]) })),
      equation: { outcome: spec.y, fit },
      change, conditional: cond, jn, lines, means: { x: mx, w: mw },
      warnings: []
    };
  }

  // ---------- 신뢰도 ----------
  // matrix: 사례 × 문항(역채점 반영 후). 결측 없는 행만 전달
  function alphaOf(matrix) {
    const k = matrix[0] ? matrix[0].length : 0;
    if (k < 2 || matrix.length < 3) return null;
    const itemVar = Array.from({ length: k }, (_, j) => sd(matrix.map(r => r[j])) ** 2);
    const totVar = sd(matrix.map(r => r.reduce((a, b) => a + b, 0))) ** 2;
    if (!(totVar > 0)) return null;
    return (k / (k - 1)) * (1 - itemVar.reduce((a, b) => a + b, 0) / totVar);
  }
  function itemMatrix(rows, def, idx, missingCodes) {
    const rev = new Set(def.reverse || def.rev || []);
    const out = [];
    (idx || rows.map((_, i) => i)).forEach(i => {
      const vals = def.items.map(it => { const v = toNumber(rows[i][it], missingCodes); return rev.has(it) ? def.min + def.max - v : v; });
      if (!vals.some(v => isNaN(v))) out.push(vals);
    });
    return out;
  }

  // ---------- 기초통계 ----------
  // spec: {vars:[분석 변수], types:{변수: 'continuous'|'binary'|'categorical'|'id'}, missingCodes, scales:[{name, items, rev, min, max, method}]}
  // 기술통계·빈도·상관·신뢰도는 모두 모형 분석과 같은 분석 표본(목록별 삭제 후)에서 계산함
  function basic(rows, spec) {
    const vars = spec.vars, types = spec.types || {};
    const prep = prepare(rows, vars, spec.missingCodes);
    const D = prep.data, n = prep.n;
    const missing = vars.map(v => {
      const m = rows.filter(r => isNaN(toNumber(r[v], spec.missingCodes))).length;
      return { name: v, nMissing: m, pct: 100 * m / rows.length };
    });
    const isCat = v => types[v] === 'binary' || types[v] === 'categorical';
    const cont = vars.filter(v => !isCat(v)).map(v => {
      const a = D[v]; return { name: v, n: a.length, mean: mean(a), sd: sd(a), min: Math.min(...a), max: Math.max(...a), skew: skewness(a), kurt: kurtosis(a) };
    });
    const cat = vars.filter(isCat).map(v => ({ name: v, levels: uniqueVals(D[v]).map(val => { const c = D[v].filter(x => x === val).length; return { value: val, n: c, pct: 100 * c / n }; }) }));
    // Pearson 상관: 연속형 변수끼리만
    const cv = cont.map(c => c.name);
    const r = cv.map(a => cv.map(b => pearson(D[a], D[b])));
    const pm = r.map(row => row.map(x => { if (Math.abs(x) >= 1) return 0; const t = x * Math.sqrt((n - 2) / (1 - x * x)); return tPvalue(t, n - 2); }));
    // 신뢰도 대상: 모형의 척도 변인(spec.scaleVars, 기본은 연속형 분석 변수 전체)
    const relVars = (spec.scaleVars || vars).filter(v => vars.includes(v) && !isCat(v));
    const reliability = relVars.map(v => {
      const def = (spec.scales || []).find(sc => sc.name === v);
      if (!def) return { name: v, available: false };
      const mat = itemMatrix(rows, def, prep.idx, spec.missingCodes);
      return { name: v, available: true, inModel: true, k: def.items.length, items: def.items, rev: def.rev || def.reverse || [], method: def.method, min: def.min, max: def.max, n: mat.length, alpha: alphaOf(mat) };
    });
    // 모형에 쓰지 않은 척도(하위요인 등)의 신뢰도: 같은 분석 표본에서 문항이 모두 있는 사례로 계산
    (spec.scales || []).filter(sc => !relVars.includes(sc.name)).forEach(def => {
      const mat = itemMatrix(rows, def, prep.idx, spec.missingCodes);
      reliability.push({ name: def.name, available: true, inModel: false, k: def.items.length, items: def.items, rev: def.rev || def.reverse || [], method: def.method, min: def.min, max: def.max, n: mat.length, alpha: alphaOf(mat) });
    });
    // 연구대상 특성(인구통계): 모형에 넣지 않은 변수도 분석 표본의 사례로 계산. 해당 변수의 결측은 따로 셈
    const demo = (spec.demoVars || []).map(v => {
      const vals = prep.idx.map(i => toNumber(rows[i][v], spec.missingCodes)), valid = vals.filter(x => !isNaN(x)), nMissing = vals.length - valid.length;
      if (isCat(v)) return { name: v, kind: 'cat', n: valid.length, nMissing, levels: uniqueVals(valid).map(val => { const c = valid.filter(x => x === val).length; return { value: val, n: c, pct: 100 * c / vals.length }; }) };
      return { name: v, kind: 'cont', n: valid.length, nMissing, mean: valid.length ? mean(valid) : null, sd: valid.length > 1 ? sd(valid) : null, min: valid.length ? Math.min(...valid) : null, max: valid.length ? Math.max(...valid) : null };
    });
    return { nTotal: prep.nTotal, n, dropped: prep.dropped, missing, cont, cat, corr: { vars: cv, r, p: pm, n }, reliability, demo };
  }
  // 왜도·첨도: 표본 보정 통계량(SPSS·Excel과 같은 정의, 첨도는 정규분포 = 0인 초과첨도)
  function skewness(a) {
    const n = a.length, m = mean(a), s = sd(a);
    if (n < 3 || !(s > 0)) return null;
    return (n / ((n - 1) * (n - 2))) * a.reduce((t, v) => t + ((v - m) / s) ** 3, 0);
  }
  function kurtosis(a) {
    const n = a.length, m = mean(a), s = sd(a);
    if (n < 4 || !(s > 0)) return null;
    return (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * a.reduce((t, v) => t + ((v - m) / s) ** 4, 0) - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3));
  }
  function pearson(a, b) {
    const ma = mean(a), mb = mean(b); let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return sab / Math.sqrt(saa * sbb);
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
    const alpha = k >= 2 && complete.length > 2 ? alphaOf(complete) : null;
    // 범위 밖 응답 확인
    let outOfRange = 0;
    rows.forEach(r => def.items.forEach(it => { const v = toNumber(r[it], missingCodes); if (!isNaN(v) && (v < def.min || v > def.max)) outOfRange++; }));
    return { scores, alpha, nComplete: complete.length, outOfRange };
  }

  const VERSION = '0.7.0';
  const api = { VERSION, ols, diagnose, mediation, moderation, scoreScale, basic, alphaOf, pearson, skewness, kurtosis, tPvalue, fPvalue, tCrit, percentile, bootCI, mulberry32, mean, sd, prepare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : this);
