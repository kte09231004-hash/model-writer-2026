# 독립 검산: statsmodels OLS + 동일 난수열로 재현한 부트스트랩
import json, numpy as np, pandas as pd, statsmodels.api as sm
from scipy import stats
R = json.load(open('/home/user/verify/engine_out.json'))
raw = pd.read_csv('/home/user/app/sample/sample_scores.csv')
fails = []; checks = 0
def close(a, b, what, tol=1e-8):
    global checks; checks += 1
    if not (abs(a-b) <= tol*max(1, abs(b))): fails.append(f'{what}: engine={a} ref={b}')

def fit(df, y, xs):
    return sm.OLS(df[y], sm.add_constant(df[xs])).fit()

def cmp_eq(eng, res, tag):
    for j, r in enumerate(eng['rows']):
        for k, ref in [('b',res.params.iloc[j]),('se',res.bse.iloc[j]),('t',res.tvalues.iloc[j]),('p',res.pvalues.iloc[j]),
                       ('llci',res.conf_int().iloc[j,0]),('ulci',res.conf_int().iloc[j,1])]:
            close(r[k], ref, f'{tag} {r["name"]} {k}')
    close(eng['r2'], res.rsquared, f'{tag} R2'); close(eng['F'], res.fvalue, f'{tag} F'); close(eng['pF'], res.f_pvalue, f'{tag} pF', 1e-6)
    close(eng['mse'], res.mse_resid, f'{tag} MSE')

def mulberry32(seed):
    a = seed & 0xffffffff
    def imul(x, y): return (x*y) & 0xffffffff
    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xffffffff
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xffffffff
        return ((t ^ (t >> 14)) & 0xffffffff) / 4294967296
    return nxt

def boot_ci(v, conf=.95):
    s = np.sort(v); B = len(s); a = (1-conf)/2
    return s[int(np.ceil(B*a))-1], s[int(np.floor(B*(1-a)))]

def check_med(key):
    e = R[key]; sp = e['spec']; meds = sp['mediators']; covs = sp['covariates']
    vars_ = [sp['x']] + meds + [sp['y']] + covs
    df = raw[vars_].dropna().reset_index(drop=True)
    close(e['sample']['n'], len(df), f'{key} n')
    eqs = [(m, [sp['x']] + meds[:i] + covs) for i, m in enumerate(meds)] + [(sp['y'], [sp['x']] + meds + covs)]
    for i, (yv, xs) in enumerate(eqs):
        res = fit(df, yv, xs); cmp_eq(e['equations'][i]['fit'], res, f'{key} eq{i+1}({yv})')
        # 표준화 계수: z점수 회귀로 독립 계산
        z = (df - df.mean())/df.std()
        rz = sm.OLS(z[yv], sm.add_constant(z[xs])).fit()
        for j in range(1, len(xs)+1): close(e['equations'][i]['fit']['rows'][j]['beta'], rz.params.iloc[j], f'{key} eq{i+1} beta{j}')
    rt = fit(df, sp['y'], [sp['x']] + covs); cmp_eq(e['totalEquation']['fit'], rt, f'{key} total')
    # 경로 열거 및 점추정
    k = len(meds); routes = []
    for mask in range(1, 1 << k):
        routes.append([i for i in range(k) if mask >> i & 1])
    routes.sort(key=lambda s: (s[0], len(s), s))
    def ind_from(d):
        fits = [fit(d, yv, xs).params.values for yv, xs in eqs]
        a = [fits[i][1] for i in range(k)]; dd = [fits[i][2:2+i] for i in range(k)]; b = [fits[k][2+i] for i in range(k)]
        out = []
        for s in routes:
            v = a[s[0]]
            for t in range(1, len(s)): v *= dd[s[t]][s[t-1]]
            out.append(v*b[s[-1]])
        return out, fits[k][1]
    ind, cp = ind_from(df)
    for j, v in enumerate(ind): close(e['indirect'][j]['effect'], v, f'{key} ind{j+1}')
    # 효과 분해: 총효과 = 직접 + 총간접 (공변량 동일 시 OLS에서 정확히 성립)
    close(e['total']['b'], cp + sum(ind), f'{key} total=direct+indirect')
    # 부트스트랩 재현 (동일 난수열 → 동일 재표집)
    rnd = mulberry32(sp['seed']); n = len(df); boots = []
    for _ in range(sp['boot']):
        idx = [int(np.floor(rnd()*n)) for _ in range(n)]
        boots.append(ind_from(df.iloc[idx].reset_index(drop=True))[0])
    boots = np.array(boots)
    for j in range(len(routes)):
        lo, hi = boot_ci(boots[:, j]); close(e['indirect'][j]['llci'], lo, f'{key} ind{j+1} LLCI'); close(e['indirect'][j]['ulci'], hi, f'{key} ind{j+1} ULCI')
        close(e['indirect'][j]['bootSE'], boots[:, j].std(ddof=1), f'{key} ind{j+1} bootSE')
    if k > 1:
        lo, hi = boot_ci(boots.sum(1)); close(e['indirect'][-1]['llci'], lo, f'{key} totind LLCI'); close(e['indirect'][-1]['ulci'], hi, f'{key} totind ULCI')
    # 간접효과 경로 간 차이(0.6.0에서 추가된 계산): 같은 부트스트랩 표본에서 두 간접효과의 차이(또는 절댓값 차이)를 다시 구해 대조
    #   엔진은 모든 순서쌍(i, j)을 따로 계산하므로 두 방향을 모두 확인함
    global checks
    cons = e.get('contrasts', [])
    checks += 1
    if len(cons) != len(routes)*(len(routes)-1): fails.append(f'{key} contrast 쌍 개수: engine={len(cons)} ref={len(routes)*(len(routes)-1)}')
    for c in cons:
        i, j = c['i'], c['j']
        for mode, fn in (('raw', lambda u, v: u - v), ('abs', lambda u, v: np.abs(u) - np.abs(v))):
            d = fn(boots[:, i], boots[:, j]); lo, hi = boot_ci(d); o = c[mode]; tag = f'{key} contrast {i+1}-{j+1} {mode}'
            close(o['effect'], fn(ind[i], ind[j]), tag + ' effect'); close(o['bootSE'], d.std(ddof=1), tag + ' bootSE')
            close(o['llci'], lo, tag + ' LLCI'); close(o['ulci'], hi, tag + ' ULCI')
            checks += 1
            if bool(o['significant']) != (not (lo <= 0 <= hi)): fails.append(tag + f' 유의 판정: engine={o["significant"]}')

def check_mod(key):
    e = R[key]; sp = e['spec']; covs = sp['covariates']
    df = raw[[sp['x'], sp['w'], sp['y']] + covs].dropna().reset_index(drop=True)
    X = df[sp['x']].copy(); W = df[sp['w']].copy()
    if sp['center'] == 'mean': X -= X.mean(); W -= W.mean()
    d = pd.DataFrame({'X': X, 'W': W, 'XW': X*W}); 
    for c in covs: d[c] = df[c]
    res = sm.OLS(df[sp['y']], sm.add_constant(d)).fit(); cmp_eq(e['equation']['fit'], res, f'{key} eq')
    red = sm.OLS(df[sp['y']], sm.add_constant(d.drop(columns='XW'))).fit()
    close(e['change']['dR2'], res.rsquared - red.rsquared, f'{key} dR2')
    ft = res.compare_f_test(red); close(e['change']['F'], ft[0], f'{key} Fchange'); close(e['change']['p'], ft[1], f'{key} pchange', 1e-6)
    # 조건부 효과: W를 해당 값만큼 이동시켜 재추정한 X 계수와 비교(독립 방식)
    for c in e['conditional']:
        d2 = d.copy(); d2['W'] = W - c['w']; d2['XW'] = X*d2['W']
        r2 = sm.OLS(df[sp['y']], sm.add_constant(d2)).fit()
        close(c['effect'], r2.params['X'], f'{key} cond w={c["w"]:.3f} eff'); close(c['se'], r2.bse['X'], f'{key} cond se')
        close(c['p'], r2.pvalues['X'], f'{key} cond p'); close(c['llci'], r2.conf_int().loc['X', 0], f'{key} cond llci')
    if sp['probe'] == 'percentile':
        for c, p in zip(e['conditional'], [.16, .5, .84]): close(c['w'], np.percentile(W, p*100, method='weibull'), f'{key} pct{p}')
    if sp['probe'] == 'meansd':
        for c, m in zip(e['conditional'], [-1, 0, 1]): close(c['w'], W.mean() + m*W.std(ddof=1), f'{key} meansd')
    if e['jn'] and e['jn'].get('bounds') is not None:
        tc = stats.t.ppf(.975, res.df_resid)
        for bnd in e['jn']['bounds']:
            d2 = d.copy(); d2['W'] = W - bnd['w']; d2['XW'] = X*d2['W']
            r2 = sm.OLS(df[sp['y']], sm.add_constant(d2)).fit()
            close(abs(r2.tvalues['X']), tc, f'{key} JN |t|=tcrit', 1e-6)

for k in ['simple', 'serial', 'serial3']: check_med(k)
for k in ['mod', 'modc', 'modbin']: check_mod(k)
print(f'검산 항목 {checks}개, 불일치 {len(fails)}개')
for f in fails[:30]: print(' -', f)
