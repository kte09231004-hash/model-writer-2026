* 모형분석 결과작성기 - SPSS PROCESS 비교용 신택스.
* 사용 순서: (1) sample_scores.csv를 SPSS로 연다  (2) PROCESS의 process.sps를 열어 전체 실행(매크로 정의)
*           (3) 이 파일을 열어 전체 실행  (4) 출력 창을 PDF나 캡처로 저장.
* 주의: 결측치가 빈칸으로 된 CSV이므로 불러온 뒤 변수 avoid, support, distress에 결측이 있어야 정상(각 2, 2, 1개).

* A 단순매개 (공변인 age gender).
process y=distress /x=alex /m=avoid /cov=age gender /model=4 /total=1 /boot=5000 /seed=20261126.

* B 순차매개.
process y=distress /x=alex /m=avoid dysreg /model=6 /total=1 /boot=5000 /seed=20261126.

* C 조절 (원점수, 16/50/84 백분위, Johnson-Neyman).
process y=distress /x=alex /w=support /model=1 /jn=1.

* D 조절 (평균중심화, 평균 +-1SD).
process y=distress /x=alex /w=support /model=1 /center=1 /moments=1.
