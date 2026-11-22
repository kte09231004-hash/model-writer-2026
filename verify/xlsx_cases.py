# 엑셀 읽기 점검용 파일 생성 + 참고값 추출
# 사용법: python3 -I xlsx_cases.py <출력 폴더> [참고 엑셀 파일]
import sys, os, json, random
import openpyxl

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
random.seed(7)
def data_rows(n=60):
    rows = [['ID', '성별', '지역', 'q1', 'q2', 'q3', 'q4', 'r1', 'r2', 'r3', '점수']]
    for i in range(1, n + 1):
        t = random.gauss(0, 1)
        q = [max(1, min(5, round(3 + t + random.gauss(0, .7)))) for _ in range(4)]
        q[1] = 6 - q[1]                                   # q2는 역문항
        r = [max(0, min(3, round(1.5 + .6 * t + random.gauss(0, .6)))) for _ in range(3)]
        rows.append([i, 1 + (i % 2), 1 + (i % 3), *q, *r, round(50 + 10 * t + random.gauss(0, 5), 1)])
    return rows
def book(sheets, path):
    wb = openpyxl.Workbook(); wb.remove(wb.active)
    for name, rows in sheets:
        ws = wb.create_sheet(name)
        for r in rows: ws.append(r)
    wb.save(path)

cb_ok = [['변수명', '설명', '척도', '하위요인', '응답 범위', '역문항', '값 라벨'],
         ['성별', '', '', '', '1-2', '', '1: 남; 2: 여'],
         ['지역', '', '', '', '1~3', '', '1 = 수도권, 2 = 충청, 3 = 영남'],
         ['q1', '', '태도 척도', '', '1–5', '', ''], ['q2', '', '태도 척도', '', '1–5', '역문항', ''],
         ['q3', '', '태도 척도', '', '1–5', '', ''], ['q4', '', '태도 척도', '', '1–5', '', ''],
         ['없는변수', '', '', '', '', '', '1 = 가, 2 = 나']]
# 1) 코드북이 첫 시트, 자료가 둘째 시트
book([('코드북', cb_ok), ('자료', data_rows())], os.path.join(out, 'cb_first.xlsx'))
# 2) 코드북의 변수 이름이 자료와 하나도 맞지 않음 → 코드북을 쓰지 않아야 함
book([('자료', data_rows()), ('코드북', [cb_ok[0], ['다른이름', '', '', '', '', '', '1 = 가, 2 = 나']])], os.path.join(out, 'cb_nomatch.xlsx'))
# 3) 코드북 없음, 시트 2개
book([('자료', data_rows()), ('메모', [['이 시트는 메모입니다']])], os.path.join(out, 'no_cb.xlsx'))
# 4) 같은 척도인데 문항마다 응답 범위가 다름 → 한꺼번에 만들기에서 건너뛰고 알려야 함
cb_bad = [r[:] for r in cb_ok]; cb_bad[5][4] = '1–7'
cb_bad += [['r1', '', '반응 척도', '', '0–3', '', ''], ['r2', '', '반응 척도', '', '0–3', '', ''], ['r3', '', '반응 척도', '', '0–3', '', '']]
book([('자료', data_rows()), ('코드북', cb_bad)], os.path.join(out, 'cb_range.xlsx'))

# 참고 엑셀 파일의 '재현검증' 시트에서 화면 대조용 값 추출
if len(sys.argv) > 2:
    wb = openpyxl.load_workbook(sys.argv[2], read_only=True, data_only=True)
    rv = [list(r) for r in wb['재현검증'].iter_rows(values_only=True)]
    def find(p):
        return next(i for i, r in enumerate(rv) if r[0] is not None and str(r[0]).strip().startswith(p))
    i1, i3, i4, i5 = find('1. 기술통계'), find('3. 신뢰도'), find('4. 순차매개'), find('5. 간접효과')
    ref = {'mean': [rv[i1 + 2 + k][5] for k in range(4)], 'sd': [rv[i1 + 2 + k][6] for k in range(4)],
           'alpha': {str(rv[i3 + 2 + k][0]): rv[i3 + 2 + k][2] for k in range(16)},
           'b_x_m1': rv[i4 + 3][5], 'b_m2_y': rv[i4 + 10][5], 'ind_serial': rv[i5 + 4][5], 'n': 250}
    json.dump(ref, open(os.path.join(out, 'ref.json'), 'w', encoding='utf8'), ensure_ascii=False)
print('ok')
