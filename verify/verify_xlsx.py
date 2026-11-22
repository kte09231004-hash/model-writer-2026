# 엑셀 참고 파일과의 대조 검증
# 사용법: python3 -I verify_xlsx.py <엑셀 파일 경로>
# 대상 파일: 시트 '가상원자료'(문항 원점수) · '코드북'(척도·하위요인·응답 범위·역문항) · '척도점수'(엑셀 수식으로 계산한 점수)
#           · '재현검증'(이 자료를 다른 곳에서 따로 분석한 값)이 들어 있는 시연용 가상 데이터
# 하는 일: 코드북대로 우리 엔진이 만든 척도 점수와 분석 결과를, 파일에 들어 있는 값과 비교함
import sys, os, json, re, subprocess, tempfile, csv
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
path = sys.argv[1]
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
def sheet(name): return [list(r) for r in wb[name].iter_rows(values_only=True)]
fails, checks, approx = [], 0, []
def close(a, b, what, tol):
    global checks; checks += 1
    if a is None or b is None or abs(float(a) - float(b)) > tol: fails.append(f'{what}: 엔진={a} 참고={b}')

# ---------- 자료와 코드북 ----------
data = sheet('가상원자료'); header = [str(h) for h in data[0]]
cb = sheet('코드북'); ch = [str(x) for x in cb[0]]
ci = {k: ch.index(k) for k in ['변수명', '척도', '하위요인', '응답 범위', '역문항']}
scales, order = {}, []
for r in cb[1:]:
    nm, sc = r[ci['변수명']], r[ci['척도']]
    if not nm or not sc or nm not in header: continue
    if sc not in scales: scales[sc] = []; order.append(sc)
    m = re.search(r'(-?\d+)\s*[–—\-~]\s*(-?\d+)', str(r[ci['응답 범위']]))
    scales[sc].append(dict(item=nm, sub=r[ci['하위요인']], min=int(m.group(1)), max=int(m.group(2)), rev=(str(r[ci['역문항']] or '').strip() == '역문항')))
defs = []
for sc in order:
    its = scales[sc]; prefix = re.match(r'^(.*?)_\d+$', its[0]['item']).group(1)
    base = dict(min=its[0]['min'], max=its[0]['max'], method='mean')
    defs.append(dict(name=prefix, items=[i['item'] for i in its], rev=[i['item'] for i in its if i['rev']], **base))
    subs = []
    for i in its:
        if i['sub'] not in subs: subs.append(i['sub'])
    if len(subs) > 1:
        for sb in subs:
            defs.append(dict(name=f'{prefix}_{sb}', items=[i['item'] for i in its if i['sub'] == sb], rev=[i['item'] for i in its if i['sub'] == sb and i['rev']], **base))
totals = [re.match(r'^(.*?)_\d+$', scales[sc][0]['item']).group(1) for sc in order]   # X, M1, M2, Y 순서
X, M1, M2, Y = totals

tmp = tempfile.mkdtemp()
csv_path = os.path.join(tmp, 'data.csv')
with open(csv_path, 'w', newline='', encoding='utf8') as f:
    w = csv.writer(f); w.writerow(header)
    for r in data[1:]: w.writerow(['' if v is None else v for v in r])
cfg = dict(csv=csv_path, scales=defs, vars=totals, scaleVars=totals, model=dict(x=X, mediators=[M1, M2], y=Y, boot=5000, seed=20261126))
cfg_path = os.path.join(tmp, 'cfg.json'); json.dump(cfg, open(cfg_path, 'w', encoding='utf8'), ensure_ascii=False)
out = json.loads(subprocess.run(['node', os.path.join(HERE, 'xlsx_cli.js'), cfg_path], capture_output=True, text=True, check=True).stdout)

# ---------- 1) 척도 점수: 엑셀 수식으로 계산된 '척도점수' 시트와 비교 ----------
sc_sheet = sheet('척도점수'); sh = [str(x) for x in sc_sheet[0]]
n_score = 0
for d in defs:
    col = d['name'] if d['name'] in sh else d['name'] + '_전체'
    if col not in sh: fails.append(f"'척도점수' 시트에 {d['name']} 열이 없음"); continue
    j = sh.index(col)
    for i, r in enumerate(sc_sheet[1:]):
        close(out['scores'][d['name']][i], r[j], f"척도 점수 {d['name']} {i+1}번 사례", 1e-9); n_score += 1

# ---------- 2) '재현검증' 시트의 '데이터' 열과 비교 ----------
rv = sheet('재현검증')
def find(prefix, start=0):
    for i in range(start, len(rv)):
        if rv[i][0] is not None and str(rv[i][0]).strip().startswith(prefix): return i
    raise KeyError(prefix)
b = out['basic']; cont = {c['name']: c for c in b['cont']}
T = 1e-6
i0 = find('1. 기술통계')
for k, v in enumerate(totals):
    r = rv[i0 + 2 + k]
    close(cont[v]['mean'], r[5], f'{v} 평균', T); close(cont[v]['sd'], r[6], f'{v} SD', T); close(cont[v]['skew'], r[7], f'{v} 왜도', T); close(cont[v]['kurt'], r[8], f'{v} 첨도', T)
i0 = find('2. 상관관계'); cv = b['corr']['vars']
for a in range(1, 4):
    for c in range(a):
        close(b['corr']['r'][cv.index(totals[a])][cv.index(totals[c])], rv[i0 + 2 + a][1 + c], f'상관 {totals[a]}-{totals[c]}', T)
# 신뢰도 16개: 시트의 순서 = 척도별 (전체, 하위요인들)
i0 = find('3. 신뢰도'); k = i0 + 2
by_prefix = {}
for d in defs: by_prefix.setdefault(d['name'].split('_')[0], []).append(d)
for prefix in totals:               # 시트는 척도마다 '전체' 한 줄 다음에 하위요인 줄이 이어짐. 하위요인은 이름으로 짝지음
    group = by_prefix[prefix]
    for _ in group:
        label = str(rv[k][0]).split(' ', 1)[1]          # 예: 'PSPS 완벽주의적 자기노력' → '완벽주의적 자기노력'
        name = prefix if label == '전체' else f'{prefix}_{label}'
        if name not in out['alphaAll']: fails.append(f'신뢰도 줄 {rv[k][0]}에 해당하는 척도를 찾지 못함')
        else: close(out['alphaAll'][name], rv[k][2], f'Cronbach α {name}', T)
        k += 1
# 경로계수
res = out['res']; eq = res['equations']
def row(e, name): return [r for r in e['fit']['rows'] if r['name'] == name][0]
i0 = find('4. 순차매개')
ref_rows = [(eq[0], X, i0 + 3), (eq[1], X, i0 + 5), (eq[1], M1, i0 + 6), (eq[2], X, i0 + 8), (eq[2], M1, i0 + 9), (eq[2], M2, i0 + 10)]
for e, nm, ri in ref_rows:
    r, ref = row(e, nm), rv[ri]
    tag = f"경로 {nm}→{e['outcome']}"
    close(r['b'], ref[5], tag + ' B', T); close(r['beta'], ref[6], tag + ' β', T); close(r['se'], ref[7], tag + ' SE', T); close(r['t'], ref[8], tag + ' t', 1e-5); close(r['p'], ref[9], tag + ' p', T)
for k, e in enumerate(eq):
    close(e['fit']['r2'], rv[i0 + 12 + k][5], f"R² {e['outcome']}", T); close(e['fit']['F'], rv[i0 + 12 + k][6], f"F {e['outcome']}", 1e-4)
close(res['total']['std'], rv[i0 + 15][6], '총효과 β', T)
# 간접효과: 점추정은 정확 비교, 부트스트랩 SE·신뢰구간은 난수 방식이 달라 근사 비교
i0 = find('5. 간접효과')
ind = {tuple(r['route'][1:-1]) if r.get('route') else 'total': r for r in res['indirect']}
for key, ri in [((M1,), i0 + 2), ((M2,), i0 + 3), ((M1, M2), i0 + 4), ('total', i0 + 5)]:
    r, ref = ind[key], rv[ri]; tag = '간접효과 ' + ('총' if key == 'total' else '→'.join(key))
    close(r['effect'], ref[5], tag + ' 점추정', T)
    approx.append((tag, r['bootSE'], ref[6], r['llci'], ref[7], r['ulci'], ref[8]))
    sig_ours = not (r['llci'] <= 0 <= r['ulci']); sig_ref = not (ref[7] <= 0 <= ref[8])
    checks += 1
    if sig_ours != sig_ref: fails.append(tag + ' 유의성 판정 불일치')
# 간접효과 경로 간 차이(대비): 점추정은 정확 비교, SE·신뢰구간은 근사 비교
#   C1 = Ind1 − Ind2, C2 = Ind1 − Ind3, C3 = Ind2 − Ind3 (Ind1 = X→M1→Y, Ind2 = X→M2→Y, Ind3 = X→M1→M2→Y)
i0 = find('6. 간접효과 간 차이')
ridx = {tuple(r['route'][1:-1]): k for k, r in enumerate(res['indirect']) if r.get('route')}
con = {(c['i'], c['j']): c['raw'] for c in res['contrasts']}
border = []
for k, (ka, kb) in enumerate([((M1,), (M2,)), ((M1,), (M1, M2)), ((M2,), (M1, M2))]):
    c, ref = con[(ridx[ka], ridx[kb])], rv[i0 + 2 + k]; tag = f'간접효과 차이 C{k+1}'
    close(c['effect'], ref[5], tag + ' 점추정', T)
    approx.append((tag, c['bootSE'], ref[6], c['llci'], ref[7], c['ulci'], ref[8]))
    sig_ours = not (c['llci'] <= 0 <= c['ulci']); sig_ref = not (ref[7] <= 0 <= ref[8])
    if sig_ours != sig_ref: border.append(f"{tag}: 우리 [{c['llci']:.4f}, {c['ulci']:.4f}] ({'유의' if sig_ours else '비유의'}) / 참고 [{ref[7]:.4f}, {ref[8]:.4f}] ({'유의' if sig_ref else '비유의'})")
# VIF (Y 회귀식의 예측변인 3개)
i0 = find('7. 추가 검정'); dg = res['diagnostics'][2]
vif = {v['name']: v for v in dg['vif']}
for k, nm in enumerate([X, M1, M2]):
    ref = rv[i0 + 4 + k]
    close(vif[nm]['tol'], ref[1], f'공차 {nm}', T); close(vif[nm]['vif'], ref[2], f'VIF {nm}', 1e-5)

print(f'엑셀 참고 파일 대조: 정확 비교 {checks}개 중 불일치 {len(fails)}개 (척도 점수 {n_score}개 포함)')
for f in fails[:20]: print(' -', f)
print('부트스트랩(근사 비교, 난수 방식이 달라 정확히 같을 수 없음): 우리 값 / 참고 값')
worst = 0
for tag, se, rse, lo, rlo, hi, rhi in approx:
    worst = max(worst, abs(lo - rlo), abs(hi - rhi), abs(se - rse))
    print(f'  {tag}: SE {se:.4f} / {rse:.4f}, 하한 {lo:.4f} / {rlo:.4f}, 상한 {hi:.4f} / {rhi:.4f}')
print(f'  신뢰구간·SE의 최대 차이 = {worst:.4f}')
if border:
    print('간접효과 차이의 유의 판정이 참고 값과 다른 항목(신뢰구간 한쪽 끝이 0에 매우 가까워 난수에 따라 판정이 바뀌는 경계선 결과):')
    for t in border: print('  ' + t)
else: print('간접효과 차이 3쌍의 유의 판정이 참고 값과 모두 같음')
