# Johnson-Neyman 독립 검증
# 기준: statsmodels OLS로 W를 w0만큼 이동해 재추정한 X 계수의 t값(=w0에서의 조건부 효과 t)을 직접 계산하고,
#       |t| - t임계값 의 부호가 바뀌는 지점을 촘촘한 격자 + brentq로 찾아 엔진 경계값과 비교함.
import json, subprocess, sys, os
import numpy as np, pandas as pd, statsmodels.api as sm
from scipy import stats, optimize
HERE = os.path.dirname(os.path.abspath(__file__))
TOL_BOUND = 1e-6   # 경계값 허용오차(원점수 단위, 상대)
fails, checks = [], 0
def check(ok, what):
    global checks; checks += 1
    if not ok: fails.append(what)

def engine(csv, spec):
    out = subprocess.run(['node', os.path.join(HERE, 'jn_cli.js'), csv, json.dumps(spec)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)

def ref_jn(df, conf, covs=()):
    """원점수 W 기준 참고 구현. 반환: (관측 범위 안 경계값 목록, 구간별 유의 여부 함수)"""
    X, W, Y = df['x'].values, df['w'].values, df['y'].values
    tc = None
    def t_at(w0):
        nonlocal tc
        Wc = W - w0
        d = pd.DataFrame({'X': X, 'W': Wc, 'XW': X * Wc})
        for c in covs: d[c] = df[c].values
        r = sm.OLS(Y, sm.add_constant(d)).fit()
        if tc is None: tc = stats.t.ppf(1 - (1 - conf) / 2, r.df_resid)
        return r.tvalues['X']
    t_at(W.mean())
    g = lambda w0: abs(t_at(w0)) - tc
    lo, hi = W.min(), W.max()
    grid = np.linspace(lo, hi, 3001); vals = np.array([g(w) for w in grid])
    roots = []
    for i in range(len(grid) - 1):
        if vals[i] == 0: roots.append(grid[i])
        elif vals[i] * vals[i + 1] < 0: roots.append(optimize.brentq(g, grid[i], grid[i + 1], xtol=1e-12))
    return roots, (lambda w0: g(w0) >= 0), tc

def run_case(name, df, conf, center, expect_status=None, covs=()):
    path = f'/tmp/jn_{name}.csv'
    df.to_csv(path, index=False)
    e = engine(path, {'x': 'x', 'w': 'w', 'y': 'y', 'covariates': list(covs), 'conf': conf, 'center': center})
    jn = e['jn']
    roots, sig, tc = ref_jn(df, conf, covs)
    tag = f'{name} conf={conf} center={center}'
    check(abs(jn['tcrit'] - tc) < 1e-8, f'{tag} t임계값 {jn["tcrit"]} vs {tc}')
    eng_in = sorted(b['wRaw'] for b in jn['bounds'])
    check(len(eng_in) == len(roots), f'{tag} 범위 안 경계값 개수 엔진 {len(eng_in)} vs 기준 {len(roots)}')
    for a, b in zip(eng_in, roots): check(abs(a - b) <= TOL_BOUND * max(1, abs(b)), f'{tag} 경계값 {a} vs {b}')
    for sg in jn['segments']:
        mid = (sg['fromRaw'] + sg['toRaw']) / 2
        check(sg['sig'] == bool(sig(mid)), f'{tag} 구간 {sg["fromRaw"]:.3f}~{sg["toRaw"]:.3f} 유의 판정')
    check(abs(jn['wminRaw'] - df['w'].min()) < 1e-9 and abs(jn['wmaxRaw'] - df['w'].max()) < 1e-9, f'{tag} 관측 범위')
    # 범위 밖 경계값: 그 지점에서 |t| = 임계값인지 직접 확인
    for b in jn['outside']:
        Wc = df['w'] - b['wRaw']; d = pd.DataFrame({'X': df['x'], 'W': Wc, 'XW': df['x'] * Wc})
        for c in covs: d[c] = df[c]
        r = sm.OLS(df['y'], sm.add_constant(d)).fit()
        check(abs(abs(r.tvalues['X']) - tc) < 1e-6, f'{tag} 범위 밖 경계값 {b["wRaw"]} |t|={abs(r.tvalues["X"])}')
        check(not (df['w'].min() <= b['wRaw'] <= df['w'].max()), f'{tag} 범위 밖 표시 오류')
    if expect_status: check(jn['status'] == expect_status, f'{tag} 상태 {jn["status"]} (기대 {expect_status})')
    return jn

rng = np.random.default_rng(7)
def make(n, b1, b3, noise=1.0, wmean=0.0, wsd=1.0, seed=None):
    r = np.random.default_rng(seed)
    x = r.normal(0, 1, n); w = r.normal(wmean, wsd, n)
    y = 0.2 + b1 * x + 0.3 * w + b3 * x * w + r.normal(0, noise, n)
    return pd.DataFrame({'x': x.round(4), 'w': w.round(4), 'y': y.round(4)})

summary = []
# 1) 예시 데이터: 원점수·중심화 × 90/95/99%
raw = pd.read_csv(os.path.join(HERE, '..', 'sample', 'sample_scores.csv'))
ex = raw[['alex', 'support', 'distress']].dropna().rename(columns={'alex': 'x', 'support': 'w', 'distress': 'y'})
for conf in (0.90, 0.95, 0.99):
    a = run_case('example', ex, conf, 'none'); b = run_case('example', ex, conf, 'mean')
    # 중심화 전후: 같은 원점수 W에서 경계값·구간이 일치하는가
    check(len(a['roots']) == len(b['roots']) and all(abs(p['wRaw'] - q['wRaw']) < 1e-8 for p, q in zip(a['roots'], b['roots'])), f'example conf={conf} 원점수/중심화 경계값 불일치')
    check([s['sig'] for s in a['segments']] == [s['sig'] for s in b['segments']], f'example conf={conf} 원점수/중심화 구간 판정 불일치')
    summary.append((f'예시 데이터 {int(conf*100)}%', a['status'], ', '.join(f"{x['wRaw']:.4f}{'' if x['inRange'] else '(범위 밖)'}" for x in a['roots'])))
# 2) 공변인 포함
exc = raw[['alex', 'support', 'distress', 'age']].dropna().rename(columns={'alex': 'x', 'support': 'w', 'distress': 'y'})
j = run_case('example_cov', exc, 0.95, 'none', covs=('age',)); summary.append(('예시 + 공변인 age 95%', j['status'], ', '.join(f"{x['wRaw']:.4f}{'' if x['inRange'] else '(범위 밖)'}" for x in j['roots'])))
# 3) 상황별 합성 데이터
cases = [
  ('all_sig',  make(400, 1.0, 0.02, seed=1), 'all_sig'),      # 강한 X 효과, 상호작용 거의 없음 → 전체 유의
  ('none_sig', make(400, 0.0, 0.00, noise=3, seed=2), 'none_sig'),  # 효과 없음 → 전체 비유의
  ('changes',  make(400, 0.3, 0.30, seed=3), 'changes'),      # 범위 안에서 전환
  ('outside',  make(400, 1.0, 0.10, wmean=0, wsd=0.3, seed=4), 'all_sig'),  # 경계값이 관측 범위 밖 (W 범위를 좁힘)
]
for name, df, st in cases:
    for center in ('none', 'mean'):
        j = run_case(name, df, 0.95, center, st)
    summary.append((name, j['status'], ', '.join(f"{x['wRaw']:.4f}{'' if x['inRange'] else '(범위 밖)'}" for x in j['roots']) or '경계값 없음'))
print(f'JN 검증 항목 {checks}개, 불일치 {len(fails)}개')
for f in fails: print(' -', f)
print('\n사례별 결과 (원점수 W 기준):')
for s in summary: print(' ', s)
