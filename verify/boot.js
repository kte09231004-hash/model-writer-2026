// 점검 스크립트 공통 준비
// 0.7.0부터 앱은 빈 화면에서 시작하고 기본값이 바뀌었음(시드 11111, 소수점 3자리, 추가 검정 켬).
// 0.5.x 때 만든 점검 스크립트는 '예시 데이터 순차매개 결과가 떠 있고, 시드 20261126, 소수점 2자리, 추가 검정 끔'을 전제로 하므로
// 그 상태를 그대로 만들어 준 뒤 같은 점검을 이어감. 새 기본값과 새 화면은 flow_test.js에서 따로 점검함.
module.exports = async function legacy(p, opt) {
  const sample = !opt || opt.sample !== false;
  await p.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('xVif', false); set('xContrast', false); set('oDec', '2'); set('oDecInd', '2'); set('oSeed', '20261126');
  });
  if (sample) {
    await p.click('#trySample');
    await p.waitForFunction(() => document.getElementById('results').dataset.status === 'current');
    await p.waitForTimeout(200);
  }
};
