/* ペットの計算ノート — per-site app code (vanilla JS, no deps)
   Pure functions are exported via module.exports for node tests. */
(function () {
  'use strict';

  // ---------- 共通ユーティリティ ----------
  const fmt = (n, d) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: 0 });
  const yen = n => '¥' + fmt(Math.round(n));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (el, def) => { const v = parseFloat(el && el.value); return Number.isFinite(v) ? v : (def == null ? 0 : def); };

  // ---------- 1. 犬の年齢換算 ----------
  // 従来の換算表: 1歳=15, 2歳=24, 以降 体格ごとに毎年加算
  // senior/high は 東京都「シニア犬猫の飼い方」講習資料（小・中型7歳〜/大型5歳〜、高齢者相当: 小型12/中型10/大型8）を参考にした目安。
  // 超大型犬は公的資料が見つからなかったため、大型犬より早めに設定（独自の目安）。
  const DOG_SIZES = {
    small: { label: '小型犬', note: '〜10kg', add: 4, senior: 7, high: 12 },
    medium: { label: '中型犬', note: '10〜25kg', add: 5, senior: 7, high: 10 },
    large: { label: '大型犬', note: '25〜40kg', add: 6, senior: 5, high: 8 },
    giant: { label: '超大型犬', note: '40kg〜', add: 7, senior: 5, high: 7 }
  };
  function dogHumanAgeTable(years, size) {
    const s = DOG_SIZES[size] || DOG_SIZES.small;
    if (years <= 0) return 0;
    if (years < 1) return 15 * years;           // 0〜1歳は直線補間
    if (years < 2) return 15 + 9 * (years - 1); // 1〜2歳は 15→24 を直線補間
    return 24 + s.add * (years - 2);
  }
  // UCSD の DNAメチル化研究（Wang et al., Cell Systems 2020）: human_age = 16·ln(dog_age) + 31
  function dogHumanAgeLog(years) {
    if (years <= 0) return 0;
    return Math.max(0, 16 * Math.log(years) + 31);
  }
  function dogLifeStage(years, size) {
    const s = DOG_SIZES[size] || DOG_SIZES.small;
    if (years < 1) return { key: 'puppy', label: '子犬（成長期）' };
    if (years < s.senior) return { key: 'adult', label: '成犬' };
    if (years < s.high) return { key: 'senior', label: 'シニア' };
    return { key: 'high', label: 'ハイシニア' };
  }

  // ---------- 2. 猫の年齢換算 ----------
  // International Cat Care / AAFP の一般的な換算: 1歳=15, 2歳=24, 以降+4/年。1歳未満は ICC の月齢表で補間。
  const CAT_MONTHS = { 0: 0, 1: 1, 2: 2, 3: 4, 4: 6, 5: 8, 6: 10, 7: 12, 8: 12.6, 9: 13.2, 10: 13.8, 11: 14.4, 12: 15 };
  function catHumanAge(years) {
    if (years <= 0) return 0;
    if (years < 1) {
      const m = years * 12, lo = Math.floor(m), hi = Math.min(12, lo + 1);
      const a = CAT_MONTHS[lo], b = CAT_MONTHS[hi];
      return a + (b - a) * (m - lo);
    }
    if (years < 2) return 15 + 9 * (years - 1);
    return 24 + 4 * (years - 2);
  }
  // 2021 AAHA/AAFP Feline Life Stage Guidelines: kitten 〜1歳 / young adult 1〜6 / mature adult 7〜10 / senior 10歳超
  function catLifeStage(years) {
    if (years < 1) return { key: 'puppy', label: '子猫（Kitten）' };
    if (years < 7) return { key: 'adult', label: '若齢成猫（Young adult）' };
    if (years < 11) return { key: 'senior', label: '中高齢成猫（Mature adult）' };
    return { key: 'high', label: 'シニア（Senior）' };
  }

  // ---------- 3. 生涯費用 ----------
  function lifetimeCost(p) {
    const yearsLeft = Math.max(0, p.lifespan - p.age);
    const insurance = p.insurance ? p.insuranceMonthly * 12 : 0;
    const items = [
      ['フード・おやつ', p.foodMonthly * 12],
      ['トイレ用品・日用品', p.goodsMonthly * 12],
      ['予防医療（ワクチン・健診）', p.preventYearly],
      ['治療費（ケガ・病気）', p.treatYearly],
      ['ペット保険料', insurance],
      ['トリミング・シャンプー', p.trimPerYear * p.trimPrice],
      ['その他', p.otherYearly || 0]
    ].filter(x => x[1] > 0);
    const yearly = items.reduce((a, x) => a + x[1], 0);
    return { yearsLeft, yearly, lifetime: yearly * yearsLeft, monthly: yearly / 12, items };
  }

  // ---------- 4. フード量 ----------
  function RER(kg) { return 70 * Math.pow(kg, 0.75); }
  // DER係数（一般的な獣医栄養学の目安。幅のあるものは [低, 高]）
  const DER_FACTORS = {
    dog: [
      { key: 'puppy_young', label: '子犬（生後4か月未満）', f: [3.0, 3.0] },
      { key: 'puppy', label: '子犬（4か月〜成犬まで）', f: [2.0, 2.0] },
      { key: 'adult_neutered', label: '成犬・避妊去勢済み', f: [1.6, 1.6] },
      { key: 'adult_intact', label: '成犬・未避妊去勢', f: [1.8, 1.8] },
      { key: 'active', label: '活動量の多い成犬', f: [2.0, 2.0] },
      { key: 'senior', label: 'シニア犬', f: [1.2, 1.4] },
      { key: 'inactive', label: '運動不足・太りやすい', f: [1.2, 1.4] },
      { key: 'loss', label: '減量中', f: [1.0, 1.2] }
    ],
    cat: [
      { key: 'kitten_young', label: '子猫（生後4か月未満）', f: [2.5, 2.5] },
      { key: 'kitten', label: '子猫（4か月〜成猫まで）', f: [2.0, 2.0] },
      { key: 'adult_neutered', label: '成猫・避妊去勢済み', f: [1.2, 1.2] },
      { key: 'adult_intact', label: '成猫・未避妊去勢', f: [1.4, 1.4] },
      { key: 'senior', label: 'シニア猫', f: [1.1, 1.4] },
      { key: 'inactive', label: '運動不足・太りやすい', f: [1.0, 1.0] },
      { key: 'loss', label: '減量中', f: [0.8, 1.0] }
    ]
  };
  function foodAmount(kg, species, key, kcalPer100g) {
    const list = DER_FACTORS[species] || DER_FACTORS.dog;
    const fac = (list.find(x => x.key === key) || list[2]).f;
    const rer = RER(kg);
    const derLo = rer * fac[0], derHi = rer * fac[1];
    const gLo = kcalPer100g > 0 ? derLo / kcalPer100g * 100 : 0;
    const gHi = kcalPer100g > 0 ? derHi / kcalPer100g * 100 : 0;
    return { rer, factor: fac, derLo, derHi, gLo, gHi };
  }

  const API = { DOG_SIZES, dogHumanAgeTable, dogHumanAgeLog, dogLifeStage, catHumanAge, catLifeStage, lifetimeCost, RER, DER_FACTORS, foodAmount };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined') return;

  // ---------- DOM ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const stageHtml = st => `<span class="stage ${st.key}">${st.label}</span>`;
  const rangeHtml = (a, b, d, u) => a === b ? `約${fmt(a, d)}<small>${u}</small>` : `約${fmt(a, d)}〜${fmt(b, d)}<small>${u}</small>`;

  const tools = {
    'inu-nenrei'(rootEl) {
      const y = $('#dog-years', rootEl), m = $('#dog-months', rootEl), sz = $('#dog-size', rootEl), out = $('#dog-result', rootEl), tbl = $('#dog-table tbody', rootEl);
      const render = () => {
        const years = clamp(num(y, 3), 0, 30) + clamp(num(m, 0), 0, 11) / 12;
        const size = sz.value, s = DOG_SIZES[size];
        const t = dogHumanAgeTable(years, size), l = dogHumanAgeLog(years), st = dogLifeStage(years, size);
        out.innerHTML =
          '<div class="sub">' + s.label + '（' + s.note + '）・' + fmt(years, 1) + '歳 の換算結果</div>' +
          '<div class="result-grid">' +
          '<div class="box"><div class="lbl">従来の換算表（体格別）</div><div class="val">約' + fmt(t, 0) + '<small>歳</small></div></div>' +
          '<div class="box"><div class="lbl">DNAメチル化の対数式（UCSD）</div><div class="val">' + (years >= 1 ? '約' + fmt(l, 0) + '<small>歳</small>' : '<small>1歳以上で算出</small>') + '</div></div>' +
          '<div class="box"><div class="lbl">ライフステージ（目安）</div><div class="val">' + stageHtml(st) + '</div></div>' +
          '</div>' +
          '<p class="note">シニア期の目安: ' + s.label + 'は' + s.senior + '歳ごろ〜、ハイシニアは' + s.high + '歳ごろ〜（個体差があります）。</p>';
        if (tbl) {
          let rows = '';
          for (let a = 1; a <= 20; a++) {
            rows += '<tr' + (Math.round(years) === a ? ' class="hl"' : '') + '><td class="num">' + a + '歳</td>' +
              Object.keys(DOG_SIZES).map(k => '<td class="num">' + fmt(dogHumanAgeTable(a, k), 0) + '</td>').join('') +
              '<td class="num">' + fmt(dogHumanAgeLog(a), 0) + '</td></tr>';
          }
          tbl.innerHTML = rows;
        }
      };
      rootEl.addEventListener('input', render); render();
    },

    'neko-nenrei'(rootEl) {
      const y = $('#cat-years', rootEl), m = $('#cat-months', rootEl), out = $('#cat-result', rootEl), tbl = $('#cat-table tbody', rootEl);
      const render = () => {
        const years = clamp(num(y, 3), 0, 30) + clamp(num(m, 0), 0, 11) / 12;
        const h = catHumanAge(years), st = catLifeStage(years);
        out.innerHTML =
          '<div class="sub">' + fmt(years, 1) + '歳 の換算結果</div>' +
          '<div class="result-grid">' +
          '<div class="box"><div class="lbl">人間に換算すると</div><div class="val">約' + fmt(h, 0) + '<small>歳</small></div></div>' +
          '<div class="box"><div class="lbl">ライフステージ（AAHA/AAFP 2021）</div><div class="val">' + stageHtml(st) + '</div></div>' +
          '</div>' +
          '<p class="note">11歳以降は International Cat Care（ISFM）の区分では「シニア（11〜14歳）」「スーパーシニア（15歳〜）」にあたります。</p>';
        if (tbl) {
          let rows = '';
          for (let a = 1; a <= 25; a++) rows += '<tr' + (Math.round(years) === a ? ' class="hl"' : '') + '><td class="num">' + a + '歳</td><td class="num">' + fmt(catHumanAge(a), 0) + '歳</td><td>' + catLifeStage(a).label + '</td></tr>';
          tbl.innerHTML = rows;
        }
      };
      rootEl.addEventListener('input', render); render();
    },

    'inu-neko-hiyou'(rootEl) {
      const f = id => $('#' + id, rootEl);
      const species = f('c-species'), size = f('c-size'), age = f('c-age'), life = f('c-life'), food = f('c-food'), goods = f('c-goods'), prevent = f('c-prevent'), treat = f('c-treat'), ins = f('c-ins'), insM = f('c-ins-m'), trimN = f('c-trim-n'), trimP = f('c-trim-p'), other = f('c-other'), out = f('c-result'), chart = f('c-chart');
      // 既定値: アニコム損保「ペットにかける年間支出調査（2025年）」の治療費、ペットフード協会調査の平均寿命などを参考にした目安
      const DEF = {
        dog: { life: 15, food: 6000, goods: 1500, prevent: 30000, treat: 89000, ins: 3500, trimN: { small: 8, medium: 6, large: 4, giant: 4 }, trimP: { small: 6000, medium: 8000, large: 12000, giant: 15000 }, other: 40000 },
        cat: { life: 16, food: 4500, goods: 2000, prevent: 15000, treat: 47000, ins: 2500, trimN: { small: 0 }, trimP: { small: 5000 }, other: 20000 }
      };
      let lastSpecies = null;
      const applyDefaults = () => {
        const sp = species.value, d = DEF[sp], sz = sp === 'dog' ? size.value : 'small';
        if (lastSpecies !== sp) {
          life.value = d.life; food.value = d.food; goods.value = d.goods; prevent.value = d.prevent; treat.value = d.treat; insM.value = d.ins; other.value = d.other;
          lastSpecies = sp;
        }
        trimN.value = d.trimN[sz] || 0; trimP.value = d.trimP[sz] || 0;
        f('c-size-wrap').style.display = sp === 'dog' ? '' : 'none';
      };
      const render = () => {
        const r = lifetimeCost({
          age: clamp(num(age, 0), 0, 30), lifespan: clamp(num(life, 15), 0, 30), foodMonthly: num(food), goodsMonthly: num(goods), preventYearly: num(prevent), treatYearly: num(treat),
          insurance: ins.checked, insuranceMonthly: num(insM), trimPerYear: num(trimN), trimPrice: num(trimP), otherYearly: num(other)
        });
        out.innerHTML =
          '<div class="result-grid">' +
          '<div class="box"><div class="lbl">年間費用</div><div class="val">' + yen(r.yearly) + '</div></div>' +
          '<div class="box"><div class="lbl">月あたり</div><div class="val">' + yen(r.monthly) + '</div></div>' +
          '<div class="box"><div class="lbl">これからの生涯費用（残り' + fmt(r.yearsLeft, 1) + '年）</div><div class="val">' + yen(r.lifetime) + '</div></div>' +
          '</div>' +
          '<div class="kv">' + r.items.map(x => '<div>' + x[0] + '</div><div>' + yen(x[1]) + ' / 年</div>').join('') + '</div>' +
          '<p class="note">医療費は年齢とともに増える傾向があるため、シニア期を含む長期の見積もりでは治療費の欄を多めに見ておくと安心です。</p>';
        // SVG 横棒グラフ（内訳）
        const colors = ['#c9641f', '#2e8b57', '#3b8bd6', '#b23a3a', '#8e5fbf', '#d9a21b', '#777'];
        const max = Math.max(1, ...r.items.map(x => x[1]));
        const W = 640, rowH = 30, left = 190, right = 90, H = r.items.length * rowH + 10;
        let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="年間費用の内訳">';
        r.items.forEach((x, i) => {
          const w = (W - left - right) * x[1] / max, y0 = 5 + i * rowH;
          svg += '<text x="' + (left - 8) + '" y="' + (y0 + 19) + '" text-anchor="end" font-size="12" fill="currentColor">' + x[0] + '</text>';
          svg += '<rect x="' + left + '" y="' + (y0 + 5) + '" width="' + Math.max(2, w) + '" height="20" rx="4" fill="' + colors[i % colors.length] + '"/>';
          svg += '<text x="' + (left + w + 6) + '" y="' + (y0 + 19) + '" font-size="12" fill="currentColor">' + yen(x[1]) + '</text>';
        });
        chart.innerHTML = svg + '</svg>';
      };
      species.addEventListener('change', () => { applyDefaults(); render(); });
      size.addEventListener('change', () => { applyDefaults(); render(); });
      rootEl.addEventListener('input', render);
      applyDefaults(); render();
    },

    'food-ryo'(rootEl) {
      const f = id => $('#' + id, rootEl);
      const species = f('f-species'), kg = f('f-kg'), stage = f('f-stage'), kcal = f('f-kcal'), out = f('f-result');
      const facLabel = x => '×' + (x[0] === x[1] ? x[0] : x[0] + '〜' + x[1]);
      const fillStages = () => {
        const cur = stage.value;
        stage.innerHTML = DER_FACTORS[species.value].map(x => '<option value="' + x.key + '">' + x.label + '（' + facLabel(x.f) + '）</option>').join('');
        stage.value = [...stage.options].some(o => o.value === cur) ? cur : 'adult_neutered';
      };
      const render = () => {
        const w = clamp(num(kg, 5), 0.1, 120), k = clamp(num(kcal, 350), 1, 1000);
        const r = foodAmount(w, species.value, stage.value, k);
        out.innerHTML =
          '<div class="sub">' + (species.value === 'dog' ? '犬' : '猫') + '・体重' + fmt(w, 1) + 'kg・フード' + fmt(k) + 'kcal/100g</div>' +
          '<div class="result-grid">' +
          '<div class="box"><div class="lbl">安静時エネルギー要求量 RER</div><div class="val">約' + fmt(r.rer, 0) + '<small>kcal/日</small></div></div>' +
          '<div class="box"><div class="lbl">1日の必要カロリー DER（係数' + facLabel(r.factor) + '）</div><div class="val">' + rangeHtml(r.derLo, r.derHi, 0, 'kcal/日') + '</div></div>' +
          '<div class="box"><div class="lbl">1日のフード量</div><div class="val">' + rangeHtml(r.gLo, r.gHi, 0, 'g/日') + '</div></div>' +
          '<div class="box"><div class="lbl">2回に分ける場合（1回あたり）</div><div class="val">' + rangeHtml(r.gLo / 2, r.gHi / 2, 0, 'g') + '</div></div>' +
          '</div>' +
          '<p class="note">おやつを与える場合は、1日の総カロリーの10%以内を目安にし、その分フードを減らします。</p>';
      };
      species.addEventListener('change', () => { fillStages(); render(); });
      rootEl.addEventListener('input', render);
      fillStages(); render();
    }
  };

  document.querySelectorAll('[data-tool]').forEach(el => { const fn = tools[el.dataset.tool]; if (fn) fn(el); });
})();
