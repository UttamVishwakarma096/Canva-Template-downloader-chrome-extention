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
      // Match /templates/<id> or /templates/<id>-<slug>, or international: /plantillas/, /modeles/, /vorlagen/
      const m = u.pathname.match(/\/(?:templates|plantillas|modeles|vorlagen)(?:\/preview)?\/([A-Za-z0-9_]{6,16})(?:-[^/?#]+)?(?:\/|$)/i);
      if (m) {
        return `https://www.canva.com/templates/${m[1]}/`;
      }
      for (const key of ['template', 'templateId', 'template_id', 'designTemplateId', 'design_template_id']) {
        const id = u.searchParams.get(key);
        if (id && /^[A-Za-z0-9_]{6,16}$/.test(id)) return `https://www.canva.com/templates/${id}/`;
      }
      if (/^\/design\//.test(u.pathname)) return null;
      if (S.templatePath.test(u.pathname)) {
        return `https://www.canva.com${u.pathname.endsWith('/') ? u.pathname : u.pathname + '/'}`;
      }
      const mPath = S.templateIdInPath.exec(u.pathname.replace(/\/$/, '') + '/');
      if (mPath) return `https://www.canva.com/templates/${mPath[1]}/`;
      return null;
    } catch {
      return null;
    }
  }

  function titleOf(card) {
    if (!card) return '';
    const img = card.querySelector('img[alt]:not([alt=""]):not([alt*="avatar" i])');
    const t = (img && img.alt) || card.getAttribute('aria-label') || card.getAttribute('title') || card.textContent || '';
    return t
      .replace(/^Preview,\s*/i, '')
      .replace(/[,\-—]\s*(?:canva\s+)?pro\s*$/i, '')
      .replace(/\s*\((?:canva\s+)?pro\)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  // Checks if an element is part of Canva's sidebars, navigation, headers, drawers, or menus
  function isSidebarOrNav(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    // 1. Check closest semantic, role, aria-label, testid, and class selectors
    const side = el.closest(
      'header, nav, aside, [role="navigation"], [role="banner"], [role="menu"], [role="menubar"], [role="tablist"], ' +
      '[aria-label*="navigation" i], [aria-label*="sidebar" i], [aria-label*="side nav" i], ' +
      '[aria-label*="nav rail" i], [aria-label*="primary navigation" i], [aria-label*="main navigation" i], ' +
      '[data-testid*="sidebar" i], [data-testid*="navigation" i], [data-testid*="nav-rail" i], ' +
      '[data-testid*="nav_rail" i], [data-testid*="side-panel" i], [data-testid*="left-nav" i], ' +
      '[data-testid*="drawer" i], [data-testid*="filter" i], ' +
      '[class*="sidebar" i], [class*="side-nav" i], [class*="sidenav" i], [class*="side_nav" i], ' +
      '[class*="nav-rail" i], [class*="navRail" i], ' +
      '.cbq-panel'
    );
    if (side) return true;

    // 2. Walk up parents to check attributes on any wrapper
    let cur = el;
    for (let i = 0; cur && i < 8; i++) {
      if (cur === document.body || cur === document.documentElement) break;
      const tag = cur.tagName;
      if (tag === 'NAV' || tag === 'ASIDE' || tag === 'HEADER') return true;
      const role = (cur.getAttribute('role') || '').toLowerCase();
      if (role === 'navigation' || role === 'banner' || role === 'menu' || role === 'menubar') return true;
      const aria = (cur.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('sidebar') || aria.includes('side nav') || aria.includes('navigation') || aria.includes('nav rail')) return true;
      const testid = (cur.getAttribute('data-testid') || '').toLowerCase();
      if (testid.includes('sidebar') || testid.includes('side-nav') || testid.includes('navigation') || testid.includes('nav-rail')) return true;
      cur = cur.parentElement;
    }

    return false;
  }

  // Checks if an element contains multiple template items (e.g. is a grid/section wrapper)
  function isMultiCardContainer(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    try {
      // 1. Multiple checkboxes with DIFFERENT template URLs
      const boxes = el.querySelectorAll('.cbq-box');
      if (boxes.length > 1) {
        const urls = new Set([...boxes].map((b) => b.dataset.url).filter(Boolean));
        if (urls.size > 1) return true;
      }
      // 2. Multiple template links with DIFFERENT template URLs
      const links = el.querySelectorAll('a[href*="/templates/"], a[href*="/plantillas/"], a[href*="/modeles/"], a[href*="/vorlagen/"]');
      if (links.length > 1) {
        const urls = new Set([...links].map((a) => templateUrl(a.href)).filter(Boolean));
        if (urls.size > 1) return true;
      }
      // 3. Multiple distinct article or listitem elements
      if (el.querySelectorAll('article, [role="listitem"]').length > 1) return true;
      // 4. Grid or list roles with multiple immediate children
      const role = (el.getAttribute('role') || '').toLowerCase();
      if ((role === 'grid' || role === 'feed' || role === 'list') && el.children.length > 1) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Finds the outer template card container for any element (checkbox, link, or image)
  function getCardContainer(el) {
    if (!el) return null;
    let best = el;

    // Fast path: find closest semantic card container
    const candidate = el.closest(
      'article, [role="listitem"], [role="group"], [data-testid*="card" i], [data-testid*="template" i], [data-testid*="search-result" i], [data-testid*="grid-item" i], li'
    );
    if (candidate && candidate !== document.body && candidate !== document.documentElement && !isMultiCardContainer(candidate)) {
      best = candidate;
    }

    // Walk up to find the topmost valid single card container
    let cur = best;
    for (let i = 0; cur && i < 10; i++) {
      const parent = cur.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      if (isMultiCardContainer(parent) || isSidebarOrNav(parent)) break;
      const role = (parent.getAttribute('role') || '').toLowerCase();
      const testid = (parent.getAttribute('data-testid') || '').toLowerCase();
      const aria = (parent.getAttribute('aria-label') || '').toLowerCase();
      if (parent.tagName === 'ARTICLE' || role === 'listitem' || role === 'group' || aria.startsWith('preview') || /card|template|result/i.test(testid)) {
        best = parent;
      } else {
        const r = parent.getBoundingClientRect();
        if ((r.width >= 80 && r.width <= 800 && r.height >= 80 && r.height <= 1000) || (r.width === 0 && r.height === 0)) {
          best = parent;
        }
      }
      cur = parent;
    }
    return best;
  }

  // Checks script tags for license info near a template ID
  function isProInPageData(templateId) {
    if (!templateId) return false;
    const id = templateId.trim();
    if (!id) return false;
    const patterns = [
      new RegExp(`"${id}"[\\s\\S]{0,600}?(?:"DL"|"license"|"pricing_type"|"priceTier"|"pricingTier"|"tier"|"plan"|"billingType"|"accessLevel"|"badge"|"type")\\s*:\\s*"(canva_pro|paid|canva:paid|canva:pro|pro|crown)"`, 'i'),
      new RegExp(`(?:"DL"|"license"|"pricing_type"|"priceTier"|"pricingTier"|"tier"|"plan"|"billingType"|"accessLevel"|"badge"|"type")\\s*:\\s*"(canva_pro|paid|canva:paid|canva:pro|pro|crown)"[\\s\\S]{0,600}?"${id}"`, 'i'),
      new RegExp(`"${id}"[\\s\\S]{0,600}?(?:"is_pro"|"isPro"|"isPremium"|"is_premium"|"isPaid"|"is_paid"|"hasPaidElements"|"is_locked")\\s*:\\s*true`, 'i'),
      new RegExp(`(?:"is_pro"|"isPro"|"isPremium"|"is_premium"|"isPaid"|"is_paid"|"hasPaidElements"|"is_locked")\\s*:\\s*true[\\s\\S]{0,600}?"${id}"`, 'i'),
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

  function isCrownPath(d) {
    if (!d || typeof d !== 'string') return false;
    return (
      d.includes('M5 16') ||
      d.includes('M3 17') ||
      d.includes('3 17h18') ||
      d.includes('14.7 9.87') ||
      d.includes('8.3 9.76') ||
      d.includes('M3.5 17.5') ||
      d.includes('M2.5 6.09') ||
      d.includes('M4 13.5') ||
      d.includes('19 16') ||
      d.includes('18 20') ||
      d.includes('5 19') ||
      d.includes('12 4') ||
      d.includes('15.5 10') ||
      d.includes('8.5 10') ||
      d.includes('6.5 8') ||
      d.includes('12 7') ||
      (d.includes('5 16') && (d.includes('3 5') || d.includes('21 5') || d.includes('19 16') || d.includes('12 4')))
    );
  }

  // Tests if a text strictly represents a Canva Pro badge (not matching titles like "Project" or "Professional")
  function isProBadgeText(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim().toLowerCase();
    if (!s || s.length > 70) return false;

    // Disallow false-positive words unless accompanied by "canva pro" or "crown"
    const hasCanvaPro = s.includes('canva pro') || s.includes('crown');
    if (!hasCanvaPro && /\b(project|professional|profile|product|promise|program|progress|property|protocol|provide|process|resume|portfolio|presentation)\b/i.test(s)) {
      return false;
    }
    // Strict exact badge texts
    if (s === 'pro' || s === 'canva pro' || s === 'crown' || s === 'paid' || s === 'premium') return true;
    if (s === '👑 pro' || s === '👑' || s === '⭐ pro' || s === '⭐' || s === 'pro ⭐' || s === 'pro 👑') return true;
    // Crown variations
    if (/^crown(\s+(icon|badge|symbol))?$/i.test(s)) return true;
    // Strict phrases
    if (/^(canva\s+pro|pro)\s*(template|badge|icon|item|element|design|only|member|feature)?$/i.test(s)) return true;
    if (/^included (with|in) (canva\s+pro|pro)(\s+subscription)?$/i.test(s)) return true;
    if (/^(upgrade to|unlock with|try|get|requires?)\s*(canva\s+pro|pro)(\s+(free|trial))?$/i.test(s)) return true;
    if (/^(paid|premium)\s*(template|content|element|item)?$/i.test(s)) return true;
    if (s === 'unlock this template' || s === 'contains paid elements' || s === 'contains paid content') return true;
    if (s.includes('canva pro') && (s.includes('trial') || s.includes('upgrade') || s.includes('unlock') || s.includes('subscribe'))) return true;
    return false;
  }

  // Helper to check if a text string has pro/crown markers (e.g. "..., Pro", "Canva Pro", "👑")
  function hasProMarker(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim().toLowerCase();
    if (!s) return false;
    if (isProBadgeText(s)) return true;
    if (/\bcanva\s+pro\b/i.test(s)) return true;
    if (/\bcrown\b/i.test(s)) return true;
    if (/(?:,\s*|\s+-\s+|\s*\(\s*)pro(?:\s*\)|$)/i.test(s)) return true;
    if (/[👑⭐]/.test(s) && /\bpro\b/i.test(s)) return true;
    if (/\b(paid|premium)\s*(template|content|element|item)?\b/i.test(s)) return true;
    return false;
  }

  // Detects if a card element on Canva has Canva Pro / Premium indicators
  function isCardPremium(card, url) {
    if (!card) return false;
    if (card.dataset && (card.dataset.cbqPremium === '1' || card.dataset.premium === '1')) return true;

    const root = getCardContainer(card) || card;
    if (root.dataset && (root.dataset.cbqPremium === '1' || root.dataset.premium === '1')) return true;

    // 1. Check template ID against embedded JSON state in script tags
    const targetUrl = url || card.dataset?.url || root.querySelector('a[href]')?.getAttribute('href') || '';
    const mId = targetUrl.match(/\/templates\/([A-Za-z0-9_]{6,16})/i) || targetUrl.match(/\b([EDt][A-Za-z0-9_]{8,15}|[A-Za-z0-9_]{11})\b/);
    const tId = mId ? mId[1] : '';
    if (tId && isProInPageData(tId)) return true;

    // Determine scopes to check: the root card container, card itself, and its direct parent if within the same single card
    const scopes = [root];
    if (card !== root) scopes.push(card);
    if (root.parentElement && root.parentElement !== document.body && !isMultiCardContainer(root.parentElement)) {
      scopes.push(root.parentElement);
    }

    for (const scope of scopes) {
      // 2. Check scope's own accessibility and data attributes
      const scopeAria = scope.getAttribute('aria-label') || '';
      const scopeTitle = scope.getAttribute('title') || '';
      const scopeTestId = (scope.getAttribute('data-testid') || '').toLowerCase();
      const scopeCls = (typeof scope.className === 'string' ? scope.className : '').toLowerCase();

      if (hasProMarker(scopeAria) || hasProMarker(scopeTitle)) return true;
      if (scope.getAttribute('data-is-pro') === 'true' || scope.getAttribute('data-is-premium') === 'true') return true;
      if (/pro-?badge|crown-?icon|premium-?badge|pro-?icon|paid-?badge/i.test(scopeTestId)) return true;
      if (/\bcrown\b|pro-?badge|premium-?badge/i.test(scopeCls)) return true;

      // 3. Check all elements inside the scope with identifying attributes
      const tagged = scope.querySelectorAll('[aria-label], [title], [data-icon], [data-testid], [data-tooltip], [data-is-pro], [data-is-premium]');
      for (const el of tagged) {
        if (el === scope) continue;
        if (el.getAttribute('data-is-pro') === 'true' || el.getAttribute('data-is-premium') === 'true') return true;

        const icon = (el.getAttribute('data-icon') || '').toLowerCase();
        if (icon === 'crown' || icon === 'canva-pro' || icon === 'pro') return true;

        const tid = (el.getAttribute('data-testid') || '').toLowerCase();
        if (/pro-?badge|crown-?icon|premium-?badge|pro-?icon|paid-?badge/i.test(tid)) return true;

        // For IMG elements: check if alt text ends with ", Pro" or contains "Canva Pro"
        if (el.tagName === 'IMG') {
          const alt = el.getAttribute('alt') || '';
          if (hasProMarker(alt)) return true;
          continue;
        }

        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const tooltip = el.getAttribute('data-tooltip') || '';
        if (isProBadgeText(aria) || isProBadgeText(title) || isProBadgeText(tooltip)) return true;
      }

      // 4. Check SVGs and their paths/classes
      for (const svg of scope.querySelectorAll('svg')) {
        const sAria = svg.getAttribute('aria-label') || '';
        const sTitle = svg.getAttribute('title') || '';
        if (hasProMarker(sAria) || hasProMarker(sTitle)) return true;

        const sCls = (typeof svg.className === 'string' ? svg.className : (svg.getAttribute('class') || '')).toLowerCase();
        if (/\bcrown\b/i.test(sCls) || /pro-?badge/i.test(sCls) || /premium-?badge/i.test(sCls)) return true;

        const titleEl = svg.querySelector('title');
        if (titleEl && hasProMarker(titleEl.textContent)) return true;

        if (svg.parentElement) {
          const pAria = svg.parentElement.getAttribute('aria-label') || '';
          const pTitle = svg.parentElement.getAttribute('title') || '';
          if (hasProMarker(pAria) || hasProMarker(pTitle)) return true;
        }

        for (const p of svg.querySelectorAll('path, use, polygon, g')) {
          const pId = (p.getAttribute('id') || '').toLowerCase();
          const pCls = (p.getAttribute('class') || '').toLowerCase();
          const pHref = (p.getAttribute('href') || p.getAttribute('xlink:href') || '').toLowerCase();
          if (pId.includes('crown') || pCls.includes('crown') || pHref.includes('crown') || pHref.includes('pro')) return true;

          const d = p.getAttribute('d') || '';
          if (isCrownPath(d)) return true;
        }
      }

      // 5. Check visible text badges (small pill or tag with exact "Pro" or "PRO")
      for (const el of scope.querySelectorAll('span, div, p, b, strong, em, button, label')) {
        if (el.children.length === 0 || el.children.length === 1) {
          const txt = (el.textContent || '').trim();
          if (txt && isProBadgeText(txt)) return true;
        }
      }

      // 6. Check for Pro CTA buttons inside the card
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
    if (isSidebarOrNav(card)) return;
    card.dataset.cbqDone = '1';

    const cardContainer = getCardContainer(card) || card;
    if (isSidebarOrNav(cardContainer)) return;
    const isPrem = isCardPremium(cardContainer, url);
    card.dataset.cbqPremium = isPrem ? '1' : '0';
    if (cardContainer !== card) cardContainer.dataset.cbqPremium = isPrem ? '1' : '0';

    const host = card.tagName === 'A' ? card.parentElement || card : card;
    if (isSidebarOrNav(host)) return;
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
      const container = getCardContainer(box) || cardContainer;
      const livePrem = box.dataset.premium === '1' || isCardPremium(container, url) || isCardPremium(box, url);
      if (box.checked) ticked.set(url, { title: titleOf(container), isPremium: livePrem });
      else ticked.delete(url);
      render();
    });
    host.appendChild(box);
  }

  // Way 1: links to a template.
  function fromLink(a) {
    if (a.dataset.cbqDone) return;
    if (isSidebarOrNav(a)) return;
    const url = templateUrl(a.href);
    if (!url) return;
    const r = a.getBoundingClientRect(); // only picture cards, not small text links
    if (!a.querySelector('img, picture, video, canvas') && ((r.width > 0 && r.width < 60) || (r.height > 0 && r.height < 40))) return;
    decorate(a, url);
  }

  // Way 2: picture cards. On Canva's search page (/s/templates) the cards are
  // not always links, but pictures come from template.canva.com/<template id>/...
  // or media-graph.canva.com, or have template ids in attributes.
  const ID_IN_TEXT = /\b([EDt][A-Za-z0-9_]{8,15}|[A-Za-z0-9]{11})\b/;
  const ID_IN_IMAGE = /(?:template(?:-images)?|media(?:-[a-z0-9]+)?|marketplace|static)\.canva\.com\/([A-Za-z0-9_-]{8,16})\//i;

  function findCardForPicture(img) {
    let el = img;
    let candidate = img.parentElement;
    for (let i = 0; el && i < 10; i++) {
      el = el.parentElement;
      if (!el || el === document.body || el === document.documentElement) break;
      if (isMultiCardContainer(el) || isSidebarOrNav(el)) break;
      if (el.matches && el.matches(S.cardSelector)) return el;
      candidate = el;
    }
    return candidate;
  }

  function fromPicture(img) {
    if (img.closest('[data-cbq-done], .cbq-panel')) return;
    if (isSidebarOrNav(img)) return;
    const imgSrc = img.currentSrc || img.src || img.getAttribute('src') || img.dataset.src || img.srcset || '';
    const m = ID_IN_IMAGE.exec(imgSrc);
    if (m) {
      const card = findCardForPicture(img) || img.parentElement;
      if (isSidebarOrNav(card)) return;
      return decorate(card, `https://www.canva.com/templates/${m[1]}/`);
    }
    const r = img.getBoundingClientRect();
    if ((r.width > 0 && r.width < 80) || (r.height > 0 && r.height < 50)) return;
    // Other pages: the template id may sit in an attribute of the card.
    let el = img.parentElement;
    for (let i = 0; el && i < 10; i++, el = el.parentElement) {
      if (isMultiCardContainer(el) || isSidebarOrNav(el)) break;
      for (const attr of el.attributes) {
        if (/^(class|style|role|data-testid|aria-)/i.test(attr.name)) continue;
        const hit = ID_IN_TEXT.exec(attr.value);
        if (hit) {
          if (!isSidebarOrNav(el)) decorate(el, `https://www.canva.com/templates/${hit[1]}/`);
          return;
        }
      }
    }
  }

  let scanQueued = false;
  function scan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      // Remove any checkboxes that were erroneously injected into sidebar or navigation
      document.querySelectorAll('.cbq-box').forEach((box) => {
        if (isSidebarOrNav(box)) {
          if (ticked.has(box.dataset.url)) ticked.delete(box.dataset.url);
          box.remove();
        }
      });
      document.querySelectorAll('a[href]').forEach(fromLink);
      document.querySelectorAll('img').forEach(fromPicture);
      // Re-scan existing valid boxes to catch Pro badges rendered asynchronously by Canva
      document.querySelectorAll('.cbq-box').forEach((b) => {
        if (isSidebarOrNav(b)) {
          b.remove();
          return;
        }
        if (b.dataset.premium !== '1') {
          const cardContainer = getCardContainer(b) || b.parentElement;
          if (isCardPremium(cardContainer, b.dataset.url) || isCardPremium(b, b.dataset.url)) {
            b.dataset.premium = '1';
            b.classList.add('cbq-box-pro');
            b.title = '⭐ Canva Pro template (click to add)';
            if (cardContainer && cardContainer.dataset) cardContainer.dataset.cbqPremium = '1';
          }
        }
      });
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
    const boxes = [...document.querySelectorAll('.cbq-box')].filter((b) => !isSidebarOrNav(b));
    const premCount = boxes.filter((b) => b.dataset.premium === '1' || isCardPremium(getCardContainer(b), b.dataset.url)).length;
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
    const n = [...document.querySelectorAll('.cbq-box')].filter((b) => !isSidebarOrNav(b)).length;
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
      const allBoxes = [...document.querySelectorAll('.cbq-box')].filter((b) => !isSidebarOrNav(b));
      allBoxes.forEach((b) => {
        const url = b.dataset.url;
        const cardContainer = getCardContainer(b) || b.parentElement;
        const isPrem = Boolean(b.dataset.premium === '1' || isCardPremium(cardContainer, url) || isCardPremium(b, url));
        if (isPrem) {
          b.checked = true;
          b.dataset.premium = '1';
          b.classList.add('cbq-box-pro');
          b.title = '⭐ Canva Pro template (click to add)';
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
      const allBoxes = [...document.querySelectorAll('.cbq-box')].filter((b) => !isSidebarOrNav(b));
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then((st) => {
        const onlyPrem = Boolean(st && st.onlyPremium);
        let count = 0;
        allBoxes.forEach((b) => {
          const url = b.dataset.url;
          const cardContainer = getCardContainer(b) || b.parentElement;
          const isPrem = Boolean(b.dataset.premium === '1' || isCardPremium(cardContainer, url) || isCardPremium(b, url));
          if (!onlyPrem || isPrem) {
            b.checked = true;
            if (isPrem) {
              b.dataset.premium = '1';
              b.classList.add('cbq-box-pro');
              b.title = '⭐ Canva Pro template (click to add)';
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
        allBoxes.forEach((b) => {
          const url = b.dataset.url;
          const cardContainer = getCardContainer(b) || b.parentElement;
          const isPrem = Boolean(b.dataset.premium === '1' || isCardPremium(cardContainer, url) || isCardPremium(b, url));
          b.checked = true;
          if (isPrem) {
            b.dataset.premium = '1';
            b.classList.add('cbq-box-pro');
            b.title = '⭐ Canva Pro template (click to add)';
          }
          ticked.set(url, { title: titleOf(cardContainer), isPremium: isPrem });
        });
        render();
      });
    } else if (act === 'none') {
      ticked.clear();
      document.querySelectorAll('.cbq-box').forEach((b) => {
        b.checked = false;
        if (isSidebarOrNav(b)) b.remove();
      });
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
