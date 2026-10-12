// Injects affiliate ad HTML into .ad-slot elements from ad-pool.json
// (client-side, random pick, no same-advertiser repeats on one page).
// Disabled until the site owner sets window.ADS_ENABLED = true in layout.html
// (affiliate codes are registered per-site).
(async () => {
  if (window.ADS_ENABLED !== true) return;
  const slots = [...document.querySelectorAll('.ad-slot[data-ad]')];
  if (!slots.length) return;
  const self = document.currentScript && document.currentScript.src;
  const poolUrl = self ? self.replace(/ads\.js(\?.*)?$/, 'ad-pool.json') : 'assets/ad-pool.json';
  let pool;
  try { pool = await (await fetch(poolUrl)).json(); } catch { return; }
  const mobile = window.matchMedia('(max-width: 780px)').matches;
  const used = new Set();
  for (const el of slots) {
    const size = (mobile && el.dataset.adMobile) ? el.dataset.adMobile : el.dataset.ad;
    let cands = (pool[size] || []).filter(e => !used.has(e.advertiser));
    if (!cands.length) cands = pool[size] || [];
    if (!cands.length) continue;
    const pick = cands[Math.floor(Math.random() * cands.length)];
    used.add(pick.advertiser);
    el.innerHTML = pick.html;
    el.classList.add('ad-filled');
  }
})();
