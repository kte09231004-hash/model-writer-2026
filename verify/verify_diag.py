# HC3 강건 표준오차·회귀 진단 독립 검증 (statsmodels 0.15.0)
#  - HC3: OLS(...).fit(cov_type='HC3', use_t=True)  ※ t분포·잔차 자유도 사용(엔진과 같은 기준)
#  - VIF: statsmodels.stats.outliers_influence.variance_inflation_factor (상수 포함 설계행렬)
#  - Cook's D·레버리지·표준화(내적 스튜던트화) 잔차: OLSInfluence
import json, subprocess, os, numpy as np, pandas as pd, statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor, OLSInfluence
from scipy import stats
HERE = os.path.dirname(os.path.abspath(__file__))
fails, checks = [], 0
def close(a, b, what, tol=1e-8):
    global checks; checks += 1
    if a is None or not np.isfinite(b) or abs(a - b) > tol * max(1, abs(b)): fails.append(f'{what}: 엔진={a} 기준={b}')
def run(spec):
    return json.loads(subprocess.run(['node', os.path.join(HERE, 'model_cli.js'), CSV, json.dumps(spec)], capture_output=True, text=True, check=True).stdout)
CSV = os.path.join(HERE, '..', 'sample', 'sample_scores.csv')
raw = pd.read_csv(CSV)

def cmp_fit(fit, y, X, tag, hc3):
    m = sm.OLS(y, sm.add_constant(X))
    r = m.fit(cov_type='HC3', use_t=True) if hc3 else m.fit()
    ci = r.conf_int()
    for j, row in enumerate(fit['rows']):
        close(row['b'], r.params.iloc[j], f'{tag} {row["name"]} b'); close(row['se'], r.bse.iloc[j], f'{tag} {row["name"]} SE')
        close(row['t'], r.tvalues.iloc[j], f'{tag} {row["name"]} t'); close(row['p'], r.pvalues.iloc[j], f'{tag} {row["name"]} p', 1e-6)
        close(row['llci'], ci.iloc[j, 0], f'{tag} {row["name"]} LLCI'); close(row['ulci'], ci.iloc[j, 1], f'{tag} {row["name"]} ULCI')
    close(fit['F'], float(np.squeeze(r.fvalue)), f'{tag} F'); close(fit['pF'], float(np.squeeze(r.f_pvalue)), f'{tag} F의 p', 1e-6)
    close(fit['r2'], r.rsquared, f'{tag} R2')
    return r

def cmp_diag(dg, y, X, tag):
    ols = sm.OLS(y, sm.add_constant(X)).fit(); inf = OLSInfluence(ols)
    exog = sm.add_constant(X).values
    for j, v in enumerate(dg['vif']):
        close(v['vif'], variance_inflation_factor(exog, j + 1), f'{tag} VIF {v["name"]}', 1e-8)
        close(v['tol'], 1 / variance_inflation_factor(exog, j + 1), f'{tag} 공차 {v["name"]}', 1e-8)
    global checks; checks += 3
    if not np.allclose(dg['cook'], inf.cooks_distance[0], rtol=1e-8, atol=1e-12): fails.append(f'{tag} Cook D 불일치')
    if not np.allclose(dg['lev'], inf.hat_matrix_diag, rtol=1e-8, atol=1e-12): fails.append(f'{tag} 레버리지 불일치')
    if not np.allclose(dg['stdres'], inf.resid_studentized_internal, rtol=1e-8, atol=1e-12): fails.append(f'{tag} 표준화 잔차 불일치')
    close(dg['maxCook'], inf.cooks_distance[0].max(), f'{tag} 최대 Cook D')
    close(dg['nCookOver'], float((inf.cooks_distance[0] > 4 / len(y)).sum()), f'{tag} 4/n 초과 수')

for hc3 in (False, True):
    se = 'hc3' if hc3 else 'ols'
    # 단순매개(공변인 포함)
    e = run({'model': 'mediation', 'x': 'alex', 'mediators': ['avoid'], 'y': 'distress', 'covariates': ['age', 'gender'], 'boot': 0, 'se': se})
    d = raw[['alex', 'avoid', 'distress', 'age', 'gender']].dropna().reset_index(drop=True)
    for i, eq in enumerate(e['equations']):
        X = d[eq['predictors']]; y = d[eq['outcome']]
        cmp_fit(eq['fit'], y, X, f'[{se}] 단순매개 식{i+1}', hc3)
        if not hc3: cmp_diag(e['diagnostics'][i], y, X, f'단순매개 식{i+1}')
    cmp_fit(e['totalEquation']['fit'], d['distress'], d[['alex', 'age', 'gender']], f'[{se}] 총효과식', hc3)
    # 순차매개
    e = run({'model': 'mediation', 'x': 'alex', 'mediators': ['avoid', 'dysreg'], 'y': 'distress', 'boot': 0, 'se': se})
    d = raw[['alex', 'avoid', 'dysreg', 'distress']].dropna().reset_index(drop=True)
    for i, eq in enumerate(e['equations']):
        X = d[eq['predictors']]; y = d[eq['outcome']]
        cmp_fit(eq['fit'], y, X, f'[{se}] 순차매개 식{i+1}', hc3)
        if not hc3: cmp_diag(e['diagnostics'][i], y, X, f'순차매개 식{i+1}')
    # 조절(원점수·평균중심화)
    for center in ('none', 'mean'):
        e = run({'model': 'moderation', 'x': 'alex', 'w': 'support', 'y': 'distress', 'covariates': ['age'], 'center': center, 'se': se})
        d = raw[['alex', 'support', 'distress', 'age']].dropna().reset_index(drop=True)
        Xv, Wv = d['alex'].copy(), d['support'].copy()
        if center == 'mean': Xv -= Xv.mean(); Wv -= Wv.mean()
        X = pd.DataFrame({'X': Xv, 'W': Wv, 'XW': Xv * Wv, 'age': d['age']})
        r = cmp_fit(e['equation']['fit'], d['distress'], X, f'[{se}] 조절({center})', hc3)
        close(e['change']['F'], r.tvalues['XW'] ** 2 if hc3 else (r.rsquared - sm.OLS(d['distress'], sm.add_constant(X.drop(columns='XW'))).fit().rsquared) / ((1 - r.rsquared) / r.df_resid), f'[{se}] 조절({center}) 상호작용 F')
        if not hc3: cmp_diag(e['diagnostics'][0], d['distress'], X, f'조절({center})')
        # 조건부 효과: W를 옮겨 재추정(같은 SE 방식)
        for c in e['conditional']:
            Wc = Wv - c['w']; X2 = pd.DataFrame({'X': Xv, 'W': Wc, 'XW': Xv * Wc, 'age': d['age']})
            m2 = sm.OLS(d['distress'], sm.add_constant(X2)); r2 = m2.fit(cov_type='HC3', use_t=True) if hc3 else m2.fit()
            close(c['se'], r2.bse['X'], f'[{se}] 조절({center}) 조건부 SE w={c["w"]:.3f}'); close(c['p'], r2.pvalues['X'], f'[{se}] 조절({center}) 조건부 p', 1e-6)
        # JN 경계에서 |t| = 임계값 (같은 SE 방식)
        tc = stats.t.ppf(0.975, r.df_resid)
        for bnd in e['jn']['bounds']:
            Wc = Wv - bnd['w']; X2 = pd.DataFrame({'X': Xv, 'W': Wc, 'XW': Xv * Wc, 'age': d['age']})
            m2 = sm.OLS(d['distress'], sm.add_constant(X2)); r2 = m2.fit(cov_type='HC3', use_t=True) if hc3 else m2.fit()
            close(abs(r2.tvalues['X']), tc, f'[{se}] 조절({center}) JN 경계 |t|', 1e-6)
print(f'HC3·회귀 진단 검증 항목 {checks}개, 불일치 {len(fails)}개')
for f in fails[:30]: print(' -', f)
