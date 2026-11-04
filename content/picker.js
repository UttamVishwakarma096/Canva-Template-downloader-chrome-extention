// Runs on Canva template list, search and template pages. Adds a checkbox to
// each template card and a small panel to add the ticked ones to the queue.
// It never scrolls, opens pages or downloads anything by itself.
(() => {
  if (self.__canvaPickerLoaded) return;
  self.__canvaPickerLoaded = true;

  const S = self.CANVA_SELECTORS;
  const ticked = new Map(); // url -> title

  // Turns any link to a Canva template into https://www.canva.com/templates/<id>/
  function templateUrl(href) {
    try {
      const u = new URL(href, location.href);
      if (!/(^|\.)canva\.com$/.test(u.hostname)) return null;
      if (/^\/design\//.test(u.pathname)) return null;
      // Match /templates/<id> or /templates/<id>-<slug>
      const m = u.pathname.match(/\/templates\/([A-Za-z0-9_]{6,16})(?:-[^/?#]+)?(?:\/|$)/i);
      if (m) {
        return `https://www.canva.com/templates/${m[1]}/`;
      }
      if (S.templatePath.test(u.pathname)) {
        return `https://www.canva.com${u.pathname.endsWith('/') ? u.pathname : u.pathname + '/'}`;
      }
      const mPath = S.templateIdInPath.exec(u.pathname.replace(/\/$/, '') + '/');
      if (mPath) return `https://www.canva.com/templates/${mPath[1]}/`;
      for (const key of S.templateIdInQuery) {
        const id = u.searchParams.get(key);
        if (id && /^[A-Za-z0-9_]{6,16}$/.test(id)) return `https://www.canva.com/templates/${id}/`;
      }
      return null;
    } catch {
      return null;
    }
  }

  function titleOf(card) {
    const img = card.querySelector('img[alt]');
    const t = (img && img.alt) || card.getAttribute('aria-label') || card.textContent || '';
    return t.replace(/^Preview,\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  // Checks if an element contains multiple template items (e.g. is a grid/section wrapper)
  function isMultiCardContainer(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    try {
      if (el.querySelectorAll('.cbq-box').length > 1) return true;
      if (el.querySelectorAll('img[src*="canva.com"]').length > 1) return true;
      if (el.querySelectorAll('a[href*="/templates/"]').length > 1) return true;
    } catch (_) {}
    return false;
  }

  // Finds the outer template card container for any element (checkbox, link, or image)
  function getCardContainer(el) {
    if (!el) return null;
    let cur = el;
    let best = el;
    for (let i = 0; cur && i < 8; i++) {
      cur = cur.parentElement;
      if (!cur || cur === document.body || cur === document.documentElement) break;
      if (isMultiCardContainer(cur)) break;
      const role = (cur.getAttribute('role') || '').toLowerCase();
      const testid = (cur.getAttribute('data-testid') || '').toLowerCase();
      const aria = (cur.getAttribute('aria-label') || '').toLowerCase();
      if (cur.tagName === 'ARTICLE' || role === 'listitem' || aria.startsWith('preview') || /card|template|result/i.test(testid)) {
        best = cur;
        break;
      }
      const r = cur.getBoundingClientRect();
      if (r.width >= 100 && r.width <= 700 && r.height >= 80 && r.height <= 950) {
        best = cur;
      }
    }
    // If the immediate parent is also a single card element (not a multi-card wrapper), expand to it
    if (best && best.parentElement && !isMultiCardContainer(best.parentElement)) {
      const pRole = (best.parentElement.getAttribute('role') || '').toLowerCase();
      const pTestid = (best.parentElement.getAttribute('data-testid') || '').toLowerCase();
      if (best.parentElement.tagName === 'ARTICLE' || pRole === 'listitem' || /card|template|result/i.test(pTestid)) {
        best = best.parentElement;
      }
    }
    return best;
  }

  // Checks script tags for license info near a template ID
  function isProInPageData(templateId) {
    if (!templateId) return false;
    const id = templateId.trim();
    if (!id) return false;
    const patterns = [
      new RegExp(`"${id}"[\\s\\S]{0,600}?(?:"DL"|"license"|"pricing_type"|"type")\\s*:\\s*"(canva_pro|paid|canva:paid|canva:pro|pro)"`, 'i'),
      new RegExp(`(?:"DL"|"license"|"pricing_type"|"type")\\s*:\\s*"(canva_pro|paid|canva:paid|canva:pro|pro)"[\\s\\S]{0,600}?"${id}"`, 'i'),
      new RegExp(`"${id}"[\\s\\S]{0,600}?(?:"is_pro"|"isPro"|"isPremium"|"is_premium")\\s*:\\s*true`, 'i'),
      new RegExp(`(?:"is_pro"|"isPro"|"isPremium"|"is_premium")\\s*:\\s*true[\\s\\S]{0,600}?"${id}"`, 'i'),
    ];
    for (const s of document.querySelectorAll('script')) {
      const txt = s.textContent;
      if (!txt || !txt.includes(id)) continue;
      for (const p of patterns) {
        if (p.test(txt)) return true;
      }
    }
    return false;
  }

  // Tests if a text strictly represents a Canva Pro badge (not matching titles like "Project" or "Professional")
  function isProBadgeText(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim().toLowerCase();
    if (!s) return false;
    // Disallow false-positive words unless accompanied by "canva pro" or "crown"
    const hasCanvaPro = s.includes('canva pro') || s.includes('crown');
    if (!hasCanvaPro && /\b(project|professional|profile|product|promise|program|progress|property|protocol|provide|process|resume|portfolio|presentation)\b/i.test(s)) {
      return false;
    }
    // Strict exact badge texts
    if (s === 'pro' || s === 'canva pro' || s === 'crown' || s === 'paid' || s === 'premium') return true;
    if (s === '👑 pro' || s === '👑' || s === '⭐ pro' || s === '⭐' || s === 'pro ⭐') return true;
    // Crown variations
    if (/^crown(\s+(icon|badge|symbol))?$/i.test(s)) return true;
    // Strict phrases
    if (/^(canva\s+pro|pro)\s*(template|badge|icon|item|element|design|only|member|feature)?$/i.test(s)) return true;
    if (/^included (with|in) (canva\s+pro|pro)$/i.test(s)) return true;
    if (/^(upgrade to|unlock with|try|get|requires?)\s*(canva\s+pro|pro)$/i.test(s)) return true;
    if (/^(paid|premium)\s*(template|content|element|item)?$/i.test(s)) return true;
    if (s === 'unlock this template' || s === 'contains paid elements') return true;
    return false;
  }

  // Detects if a card element on Canva has Canva Pro / Premium indicators
  function isCardPremium(card, url) {
    if (!card) return false;
    const root = getCardContainer(card) || card;

    // 1. Check template ID against embedded JSON state in script tags
    const mId = (url || '').match(/\/templates\/([A-Za-z0-9_]{6,16})/i) || (url || '').match(/\b([EDt][A-Za-z0-9_]{8,15}|[A-Za-z0-9_]{11})\b/);
    const tId = mId ? mId[1] : '';
    if (tId && isProInPageData(tId)) return true;

    // Determine scopes to check: the root card container, and its direct parent if within the same single card
    const scopes = [root];
    if (root.parentElement && root.parentElement !== document.body && !isMultiCardContainer(root.parentElement)) {
      scopes.push(root.parentElement);
    }

    for (const scope of scopes) {
      // 2. Check all elements inside the scope with identifying attributes
      const tagged = scope.querySelectorAll('[aria-label], [title], [data-icon], [data-testid], [data-tooltip]');
      for (const el of tagged) {
        if (el === scope) continue;
        // Skip the main preview image alt/title (contains template title)
        if (el.tagName === 'IMG' && ((el.src && el.src.includes('canva.com')) || el.getBoundingClientRect().width > 80)) {
          continue;
        }
        if (
          isProBadgeText(el.getAttribute('aria-label')) ||
          isProBadgeText(el.getAttribute('title')) ||
          isProBadgeText(el.getAttribute('data-tooltip')) ||
          isProBadgeText(el.getAttribute('data-icon'))
        ) {
          return true;
        }
        const icon = (el.getAttribute('data-icon') || '').toLowerCase();
        if (icon === 'crown' || icon === 'canva-pro' || icon === 'pro') return true;

        const tid = (el.getAttribute('data-testid') || '').toLowerCase();
        if (/pro-?badge|crown-?icon|premium-?badge|pro-?icon/i.test(tid)) return true;
      }

      // 3. Check SVGs and their paths/classes
      for (const svg of scope.querySelectorAll('svg')) {
        if (isProBadgeText(svg.getAttribute('aria-label')) || isProBadgeText(svg.getAttribute('title'))) return true;
        const sCls = (typeof svg.className === 'string' ? svg.className : (svg.getAttribute('class') || '')).toLowerCase();
        if (/\bcrown\b/i.test(sCls) || /pro-?badge/i.test(sCls) || /premium-?badge/i.test(sCls)) return true;

        const titleEl = svg.querySelector('title');
        if (titleEl && isProBadgeText(titleEl.textContent)) return true;

        if (svg.parentElement && (isProBadgeText(svg.parentElement.getAttribute('aria-label')) || isProBadgeText(svg.parentElement.getAttribute('title')))) {
          return true;
        }

        for (const p of svg.querySelectorAll('path, use, polygon, g')) {
          const pId = (p.getAttribute('id') || '').toLowerCase();
          const pCls = (p.getAttribute('class') || '').toLowerCase();
          const pHref = (p.getAttribute('href') || p.getAttribute('xlink:href') || '').toLowerCase();
          if (pId.includes('crown') || pCls.includes('crown') || pHref.includes('crown')) return true;

          const d = p.getAttribute('d') || '';
          // Canva Pro crown SVG path coordinates
          if (
            d.includes('M3.5 17.5') ||
            d.includes('14.7 9.87') ||
            d.includes('8.3 9.76') ||
            d.includes('M2.5 6.09') ||
            d.includes('M5 16L3 5') ||
            d.includes('M5 16') ||
            (d.includes('5 16') && (d.includes('3 5') || d.includes('21 5') || d.includes('19 16') || d.includes('12 4')))
          ) {
            return true;
          }
        }
      }

      // 4. Check visible text badges (small pill or tag with exact "Pro" or "PRO")
      for (const el of scope.querySelectorAll('span, div, p, b, strong, em, button')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.width <= 110 && r.height > 0 && r.height <= 50) {
          const txt = (el.textContent || '').trim();
          if (isProBadgeText(txt)) return true;
        }
      }

      // 5. Check for Pro CTA buttons inside the card
      for (const btn of scope.querySelectorAll('button, [role="button"], a')) {
        const txt = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        if (S.proCtaButtons.some((cta) => txt.includes(cta) || aria.includes(cta))) return true;
      }
    }

    return false;
  }

  // Detects if the current single template page is Canva Pro
  function isSinglePagePremium() {
    const main = document.querySelector('main, [role="main"], [role="dialog"]') || document.body;
    if (isCardPremium(main, location.href)) return true;
    for (const btn of main.querySelectorAll('button, a, [role="button"]')) {
      const txt = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
      if (S.proCtaButtons.some((cta) => txt.includes(cta) || aria.includes(cta))) return true;
    }
    const pageText = (main.textContent || '').toLowerCase();
    for (const sign of S.proSigns) {
      if (pageText.includes(sign)) return true;
    }
    return false;
  }

  // ---------- checkboxes on cards ----------

  // card: the element to put the checkbox on, url: its template link
  function decorate(card, url) {
    if (card.dataset.cbqDone) return;
    card.dataset.cbqDone = '1';

    const cardContainer = getCardContainer(card) || card;
    const isPrem = isCardPremium(cardContainer, url);
    card.dataset.cbqPremium = isPrem ? '1' : '0';
    if (cardContainer !== card) cardContainer.dataset.cbqPremium = isPrem ? '1' : '0';

    const host = card.tagName === 'A' ? card.parentElement || card : card;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cbq-box' + (isPrem ? ' cbq-box-pro' : '');
    box.title = isPrem ? '⭐ Canva Pro template (click to add)' : 'Add to download queue';
    box.dataset.url = url;
    box.dataset.premium = isPrem ? '1' : '0';
    box.checked = ticked.has(url);
    for (const ev of ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup']) {
      box.addEventListener(ev, (e) => e.stopPropagation(), true);
    }
    box.addEventListener('change', () => {
      const livePrem = box.dataset.premium === '1' || isCardPremium(getCardContainer(box), url);
      if (box.checked) ticked.set(url, { title: titleOf(cardContainer), isPremium: livePrem });
      else ticked.delete(url);
      render();
    });
    host.appendChild(box);
  }

  // Way 1: links to a template.
  function fromLink(a) {
    if (a.dataset.cbqDone) return;
    const url = templateUrl(a.href);
    if (!url) return;
    const r = a.getBoundingClientRect(); // only picture cards, not small text links
    if (!a.querySelector('img, picture, video, canvas') && (r.width < 60 || r.height < 40)) return;
    decorate(a, url);
  }

  // Way 2: picture cards. On Canva's search page (/s/templates) the cards are
  // not always links, but pictures come from template.canva.com/<template id>/...
  // or media-graph.canva.com, or have template ids in attributes.
  const ID_IN_TEXT = /\b([EDt][A-Za-z0-9_-]{8,15}|[A-Za-z0-9_-]{11})\b/;
  const ID_IN_IMAGE = /(?:template(?:-images)?|media-(?:graph|public))\.canva\.com\/([A-Za-z0-9_-]{8,16})\//i;

  function findCardForPicture(img) {
    let el = img;
    let candidate = img.parentElement;
    for (let i = 0; el && i < 8; i++) {
      el = el.parentElement;
      if (!el || el === document.body || el === document.documentElement) break;
      if (isMultiCardContainer(el)) break;
      if (el.matches && el.matches(S.cardSelector)) return el;
      candidate = el;
    }
    return candidate;
  }

  function fromPicture(img) {
    if (img.closest('[data-cbq-done], .cbq-panel')) return;
    const r = img.getBoundingClientRect();
    if (r.width < 80 || r.height < 50) return;
    const imgSrc = img.currentSrc || img.src || img.getAttribute('src') || img.dataset.src || img.srcset || '';
    const m = ID_IN_IMAGE.exec(imgSrc);
    if (m) {
      const card = findCardForPicture(img) || img.parentElement;
      return decorate(card, `https://www.canva.com/templates/${m[1]}/`);
    }
    // Other pages: the template id may sit in an attribute of the card.
    let el = img.parentElement;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      if (isMultiCardContainer(el)) break;
      for (const attr of el.attributes) {
        if (attr.name === 'class' || attr.name === 'style') continue;
        const hit = ID_IN_TEXT.exec(attr.value);
        if (hit) return decorate(el, `https://www.canva.com/templates/${hit[1]}/`);
      }
    }
  }

  let scanQueued = false;
  function scan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      document.querySelectorAll('a[href]').forEach(fromLink);
      document.querySelectorAll('img').forEach(fromPicture);
      render();
    }, 300);
  }

  // Facts about the page, so the extension can be fixed when Canva changes.
  function debugInfo() {
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    const ids = new Set();
    document.querySelectorAll('*').forEach((el) => {
      for (const attr of el.attributes) {
        const m = ID_IN_TEXT.exec(attr.value);
        if (m) ids.add(`${el.tagName.toLowerCase()}[${attr.name}]=${attr.value.slice(0, 80)}`);
      }
    });
    const bigImgs = [...document.querySelectorAll('img')].filter((i) => i.getBoundingClientRect().width >= 80);
    const sample = bigImgs.slice(0, 3).map((img) => {
      const path = [];
      let el = img;
      for (let i = 0; el && i < 8; i++, el = el.parentElement) {
        const attrs = [...el.attributes]
          .filter((x) => x.name !== 'class' && x.name !== 'style' && x.name !== 'src' && x.name !== 'srcset')
          .map((x) => `${x.name}="${x.value.slice(0, 60)}"`)
          .join(' ');
        path.push(`<${el.tagName.toLowerCase()} ${attrs}>`);
      }
      return path.join('\n  ');
    });
    const boxes = document.querySelectorAll('.cbq-box');
    const premCount = [...boxes].filter((b) => b.dataset.premium === '1' || isCardPremium(getCardContainer(b), b.dataset.url)).length;
    return [
      `Extension version: ${chrome.runtime.getManifest().version}`,
      `Page: ${location.href}`,
      `Checkboxes: ${boxes.length}`,
      `Premium detected: ${premCount}`,
      `Links: ${links.length}, template links: ${links.filter((h) => templateUrl(h)).length}`,
      `Big pictures: ${bigImgs.length}`,
      `Links with "template": ${links.filter((h) => /templat/i.test(h)).slice(0, 15).join(' | ')}`,
      `Attributes with a template id (${ids.size}): ${[...ids].slice(0, 15).join(' | ')}`,
      `First pictures and their parents:\n${sample.join('\n---\n')}`,
    ].join('\n');
  }

  // ---------- panel ----------

  const panel = document.createElement('div');
  panel.className = 'cbq-panel';
  panel.innerHTML = `
    <div class="cbq-title">Bulk Downloader</div>
    <div class="cbq-found"></div>
    <button type="button" data-act="this">Add this template</button>
    <button type="button" data-act="all">Tick all on this page</button>
    <button type="button" data-act="premium" class="cbq-pro-btn">⭐ Tick Premium only</button>
    <button type="button" data-act="none">Clear ticks</button>
    <button type="button" data-act="add" class="cbq-main">Add ticked (0)</button>
    <button type="button" data-act="debug">Copy debug info</button>
    <div class="cbq-msg" aria-live="polite"></div>`;

  const msg = panel.querySelector('.cbq-msg');
  const say = (text) => {
    msg.textContent = text;
    clearTimeout(say.t);
    say.t = setTimeout(() => (msg.textContent = ''), 6000);
  };

  function render() {
    const add = panel.querySelector('[data-act="add"]');
    const label = `Add ticked (${ticked.size})`;
    if (add.textContent !== label) add.textContent = label; // avoid waking our own observer
    panel.querySelector('[data-act="this"]').hidden = !templateUrl(location.href);
    const n = document.querySelectorAll('.cbq-box').length;
    const found = n
      ? `Templates found on this page: ${n}`
      : 'No templates found here. Open a Canva templates page, or reload this page.';
    const foundEl = panel.querySelector('.cbq-found');
    if (foundEl.textContent !== found) foundEl.textContent = found; // avoid waking our own observer
  }

  async function send(items) {
    if (!items.length) return say('Nothing ticked yet.');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ADD_MANY', items });
      say(`Added ${res.added}. Skipped ${res.skipped} (already in queue or not a template).`);
      return res;
    } catch (e) {
      say(
        /context invalidated/i.test(e.message)
          ? 'The extension was updated or reloaded. Press F5 to reload this page, then try again.'
          : `Could not add: ${e.message}`,
      );
    }
  }

  panel.addEventListener('click', async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'this') {
      const h1 = document.querySelector('h1');
      const isPrem = isSinglePagePremium();
      send([{ url: location.href, title: (h1 && h1.textContent.trim()) || document.title, isPremium: isPrem }]);
    } else if (act === 'premium') {
      document.querySelectorAll('a[href]').forEach(fromLink);
      document.querySelectorAll('img').forEach(fromPicture);
      let count = 0;
      const allBoxes = document.querySelectorAll('.cbq-box');
      allBoxes.forEach((b) => {
        const url = b.dataset.url;
        const cardContainer = getCardContainer(b) || b.parentElement;
        const isPrem = isCardPremium(cardContainer, url);
        if (isPrem) {
          b.checked = true;
          b.dataset.premium = '1';
          b.classList.add('cbq-box-pro');
          b.title = '⭐ Canva Pro template';
          ticked.set(url, { title: titleOf(cardContainer), isPremium: true });
          count++;
        } else {
          b.checked = false;
          b.dataset.premium = '0';
          b.classList.remove('cbq-box-pro');
          ticked.delete(url);
        }
      });
      render();
      if (count > 0) {
        say(`Ticked ${count} premium template(s) of ${allBoxes.length}.`);
      } else {
        say(`No premium templates detected out of ${allBoxes.length} templates on this page.`);
      }
    } else if (act === 'all') {
      document.querySelectorAll('a[href]').forEach(fromLink);
      document.querySelectorAll('img').forEach(fromPicture);
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then((st) => {
        const onlyPrem = Boolean(st && st.onlyPremium);
        let count = 0;
        document.querySelectorAll('.cbq-box').forEach((b) => {
          const url = b.dataset.url;
          const cardContainer = getCardContainer(b) || b.parentElement;
          const isPrem = isCardPremium(cardContainer, url);
          if (!onlyPrem || isPrem) {
            b.checked = true;
            if (isPrem) {
              b.dataset.premium = '1';
              b.classList.add('cbq-box-pro');
            }
            ticked.set(url, { title: titleOf(cardContainer), isPremium: isPrem });
            count++;
          } else {
            b.checked = false;
            ticked.delete(url);
          }
        });
        render();
        say(onlyPrem ? `Ticked ${count} premium templates (Premium-only mode).` : `Ticked ${count} templates.`);
      }).catch(() => {
        document.querySelectorAll('.cbq-box').forEach((b) => {
          const url = b.dataset.url;
          const cardContainer = getCardContainer(b) || b.parentElement;
          const isPrem = isCardPremium(cardContainer, url);
          b.checked = true;
          ticked.set(url, { title: titleOf(cardContainer), isPremium: isPrem });
        });
        render();
      });
    } else if (act === 'none') {
      ticked.clear();
      document.querySelectorAll('.cbq-box').forEach((b) => (b.checked = false));
      render();
    } else if (act === 'debug') {
      try {
        await navigator.clipboard.writeText(debugInfo());
        say('Debug info copied. Paste it in your message to Claude.');
      } catch (err) {
        say(`Could not copy: ${err.message}`);
      }
    } else if (act === 'add') {
      const items = [...ticked].map(([url, info]) => {
        const title = typeof info === 'object' ? info.title : info;
        const isPremium = typeof info === 'object' ? Boolean(info.isPremium) : false;
        return { url, title, isPremium };
      });
      const res = await send(items);
      if (res) {
        ticked.clear();
        document.querySelectorAll('.cbq-box').forEach((b) => (b.checked = false));
        render();
      }
    }
  });

  document.documentElement.appendChild(panel);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
