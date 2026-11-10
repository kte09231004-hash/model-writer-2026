# 검증용 가상 데이터 생성 (실제 연구 자료 아님)
import numpy as np, pandas as pd
rng = np.random.default_rng(20261109)
n = 300
age = rng.integers(19, 30, n)
gender = rng.integers(0, 2, n)
X = rng.normal(3.0, 0.7, n)                                   # 감정표현불능(가상)
M1 = 1.0 + 0.45*X + rng.normal(0, 0.6, n)                       # 경험회피(가상)
M2 = 0.8 + 0.20*X + 0.40*M1 + rng.normal(0, 0.6, n)             # 정서조절곤란(가상)
W = rng.normal(3.2, 0.8, n)                                     # 사회적지지(가상)
Y = 0.5 + 0.15*X + 0.10*M1 + 0.35*M2 - 0.25*W - 0.15*(X-3)*(W-3.2) + 0.02*(age-24) + rng.normal(0, 0.6, n)
df = pd.DataFrame(dict(id=np.arange(1, n+1), age=age, gender=gender,
    alex=X.round(3), avoid=M1.round(3), dysreg=M2.round(3), support=W.round(3), distress=Y.round(3)))
# 결측치 일부 삽입
for col, rows in {'avoid':[4,57], 'distress':[120], 'support':[201,250]}.items():
    df.loc[rows, col] = np.nan
df.to_csv('/home/user/app/sample/sample_scores.csv', index=False)

# 문항별 원자료 예시: 5점 척도 6문항, 3·5번 역채점
lat = rng.normal(0, 1, n)
items = {}
for j in range(1, 7):
    raw = 3 + 0.9*lat + rng.normal(0, 0.8, n)
    if j in (3, 5): raw = 6 - raw
    items[f'q{j}'] = np.clip(np.rint(raw), 1, 5).astype(int)
it = pd.DataFrame(items); it.insert(0, 'id', np.arange(1, n+1))
it.loc[[10], 'q2'] = np.nan
it.to_csv('/home/user/app/sample/sample_items.csv', index=False)
print(df.head()); print(df.isna().sum().to_dict())
