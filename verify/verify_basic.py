# 기초통계·결측·상관·신뢰도 독립 검증 (pandas 기술통계, scipy.stats.pearsonr, pingouin.cronbach_alpha)
import json, subprocess, os, numpy as np, pandas as pd
from scipy import stats
import pingouin as pg
HERE = os.path.dirname(os.path.abspath(__file__))
fails, checks = [], 0
def close(a, b, what, tol=1e-9):
    global checks; checks += 1
    if a is None or b is None or not np.isfinite(b) or abs(a - b) > tol * max(1, abs(b)): fails.append(f'{what}: 엔진={a} 기준={b}')
def same(a, b, what):
    global checks; checks += 1
    if a != b: fails.append(f'{what}: 엔진={a} 기준={b}')

sc = pd.read_csv(os.path.join(HERE, '..', 'sample', 'sample_scores.csv'))
it = pd.read_csv(os.path.join(HERE, '..', 'sample', 'sample_items.csv'))
df = sc.merge(it, on='id')
df['q4'] = df['q4'].astype('Int64').astype(object)  # 정수 그대로 보존
df.loc[[3, 40, 77], 'alex'] = 999      # 결측치 코드
df.loc[[12], 'q5'] = np.nan              # 문항 결측
df.loc[[150], 'q1'] = 999                # 문항에도 결측치 코드
df['grp'] = (np.arange(len(df)) % 3) + 1   # 3범주 변수(모형에 넣지 않음)
df.loc[[7, 8], 'grp'] = np.nan; df.loc[[20], 'gender'] = np.nan
path = '/tmp/basic_test.csv'; df.to_csv(path, index=False)

ITEMS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']; REV = ['q3', 'q5']
cases = [
  ('평균 척도', dict(name='s6', items=ITEMS, rev=REV, min=1, max=5, method='mean')),
  ('합계 척도', dict(name='s6', items=ITEMS, rev=REV, min=1, max=5, method='sum')),
]
for label, d in cases:
    vars_ = ['alex', 'avoid', 's6', 'distress', 'age', 'gender']
    sub = dict(name='sub3', items=['q1', 'q3', 'q5'], rev=['q3', 'q5'], min=1, max=5, method='mean')   # 모형에 쓰지 않는 하위요인
    spec = dict(vars=vars_, types={'gender': 'binary', 'grp': 'categorical'}, missingCodes=[999], scales=[d, sub], scaleVars=['alex', 'avoid', 's6', 'distress'], demoVars=['gender', 'grp', 'support'])
    out = json.loads(subprocess.run(['node', os.path.join(HERE, 'basic_cli.js'), path, json.dumps({'def': d, 'spec': spec})], capture_output=True, text=True, check=True).stdout)
    b = out['basic']
    # 기준: pandas
    ref = df.copy().apply(pd.to_numeric, errors='coerce').replace(999, np.nan)
    items = ref[ITEMS].copy()
    for q in REV: items[q] = d['min'] + d['max'] - items[q]
    ref['s6'] = items.mean(axis=1, skipna=False) if d['method'] == 'mean' else items.sum(axis=1, skipna=False)
    # 척도 점수
    eng_scores = pd.to_numeric(pd.Series(out['scores']).replace('', np.nan))
    checks += 1
    if not np.allclose(eng_scores.fillna(-1e9), ref['s6'].fillna(-1e9), atol=1e-12): fails.append(f'{label} 척도 점수 불일치')
    # 결측
    same(b['nTotal'], len(ref), f'{label} 전체 N')
    for m in b['missing']: same(m['nMissing'], int(ref[m['name']].isna().sum()), f'{label} 결측 {m["name"]}')
    an = ref[vars_].dropna()
    same(b['n'], len(an), f'{label} 분석 n'); same(b['dropped'], len(ref) - len(an), f'{label} 제외 n')
    # 기술통계
    for c in b['cont']:
        s = an[c['name']]
        close(c['mean'], s.mean(), f'{label} {c["name"]} 평균'); close(c['sd'], s.std(ddof=1), f'{label} {c["name"]} SD')
        close(c['min'], s.min(), f'{label} {c["name"]} 최솟값'); close(c['max'], s.max(), f'{label} {c["name"]} 최댓값')
        close(c['skew'], s.skew(), f'{label} {c["name"]} 왜도'); close(c['kurt'], s.kurt(), f'{label} {c["name"]} 첨도')
        close(c['skew'], stats.skew(s, bias=False), f'{label} {c["name"]} 왜도(scipy)'); close(c['kurt'], stats.kurtosis(s, bias=False), f'{label} {c["name"]} 첨도(scipy)')
    same([x['name'] for x in b['cont']], ['alex', 'avoid', 's6', 'distress', 'age'], f'{label} 연속형 목록(범주형 제외)')
    # 빈도
    vc = an['gender'].value_counts().sort_index()
    for lv in b['cat'][0]['levels']: same(lv['n'], int(vc[lv['value']]), f'{label} 성별 {lv["value"]} 빈도')
    # 상관 (scipy pearsonr)
    cv = b['corr']['vars']
    for i in range(len(cv)):
        for j in range(i + 1, len(cv)):
            r, pv = stats.pearsonr(an[cv[i]], an[cv[j]])
            close(b['corr']['r'][i][j], r, f'{label} r {cv[i]}-{cv[j]}', 1e-9); close(b['corr']['p'][i][j], pv, f'{label} p {cv[i]}-{cv[j]}', 1e-7)
    # 신뢰도: 분석 표본의 문항(역채점 후)으로 pingouin
    rel = {r['name']: r for r in b['reliability']}
    a_ref, _ = pg.cronbach_alpha(data=items.loc[an.index])
    close(rel['s6']['alpha'], a_ref, f'{label} Cronbach α (pingouin)', 1e-9)
    same(rel['s6']['n'], len(an), f'{label} α 산출 n')
    same(rel['alex']['available'], False, f'{label} 문항 없는 변수는 α 산출 안 함')
    same('age' in rel, False, f'{label} 공변인은 신뢰도 대상 아님')
    # 모형에 쓰지 않은 척도(하위요인)의 α: 같은 분석 표본에서 pingouin으로 계산
    sub_items = items.loc[an.index, ['q1', 'q3', 'q5']].dropna()
    a_sub, _ = pg.cronbach_alpha(data=sub_items)
    close(rel['sub3']['alpha'], a_sub, f'{label} 하위요인 α (pingouin)', 1e-9)
    same(rel['sub3']['inModel'], False, f'{label} 하위요인은 모형 미사용으로 표시'); same(rel['sub3']['n'], len(sub_items), f'{label} 하위요인 α n')
    # 연구대상 특성: 분석 표본의 사례에서 계산(모형에 넣지 않은 grp, support 포함)
    dm = {x['name']: x for x in b['demo']}
    for v in ('gender', 'grp'):
        col = ref.loc[an.index, v]; vc = col.value_counts().sort_index()
        same(dm[v]['kind'], 'cat', f'{label} 특성 {v} 유형'); same(dm[v]['nMissing'], int(col.isna().sum()), f'{label} 특성 {v} 결측')
        for lv in dm[v]['levels']:
            same(lv['n'], int(vc[lv['value']]), f'{label} 특성 {v}={lv["value"]} 빈도'); close(lv['pct'], 100 * vc[lv['value']] / len(an), f'{label} 특성 {v}={lv["value"]} 비율')
    col = ref.loc[an.index, 'support']
    same(dm['support']['nMissing'], int(col.isna().sum()), f'{label} 특성 support 결측'); close(dm['support']['mean'], col.mean(), f'{label} 특성 support 평균'); close(dm['support']['sd'], col.std(ddof=1), f'{label} 특성 support SD')
    close(dm['support']['min'], col.min(), f'{label} 특성 support 최솟값'); close(dm['support']['max'], col.max(), f'{label} 특성 support 최댓값')
print(f'기초통계·신뢰도 검증 항목 {checks}개, 불일치 {len(fails)}개')
for f in fails: print(' -', f)
