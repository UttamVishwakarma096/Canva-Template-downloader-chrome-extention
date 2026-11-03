// Runs only inside tabs the extension opened. Clicks the buttons a person
// would click, and reports each step to the service worker.
(() => {
  if (self.__canvaRunnerLoaded) return;
  self.__canvaRunnerLoaded = true;

  const S = self.CANVA_SELECTORS;
  let runningJob = null;

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const labelOf = (el) => norm(el.getAttribute('aria-label') || el.textContent);

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]') && !el.disabled;
  }

  function findByText(words) {
    const els = [...document.querySelectorAll(S.clickable)].filter(visible);
    const want = words.map(norm);
    for (const w of want) {
      const hit = els.find((el) => labelOf(el) === w);
      if (hit) return hit;
    }
    for (const w of want) {
      const hit = els.find((el) => labelOf(el).startsWith(w));
      if (hit) return hit;
    }
    return null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Single clean click sequence that works with Canva's React pointer and mouse event listeners.
  function press(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      screenX: (window.screenX || 0) + r.left + r.width / 2,
      screenY: (window.screenY || 0) + r.top + r.height / 2,
      button: 0,
      buttons: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
    el.click();
  }

  // ─── File-type dropdown button in Canva's Download panel ──────────────────
  function findFileTypeMenu() {
    const labels = S.fileTypeLabel.map(norm);

    // 1. Check for element with aria-label containing "file type"
    const buttons = [...document.querySelectorAll('button, [role="button"], [role="combobox"]')].filter(visible);
    let hit = buttons.find((el) => {
      const aria = norm(el.getAttribute('aria-label') || '');
      return labels.some((l) => aria.includes(l));
    });
    if (hit) return hit;

    // 2. Find the "File type" label header, then find the interactive element directly below it
    const labelHeaders = [...document.querySelectorAll('label, p, span, div, h2, h3, h4, legend')].filter(visible);
    const fileTypeHeader = labelHeaders.find((el) => {
      const txt = norm(el.textContent);
      return labels.includes(txt);
    });

    if (fileTypeHeader) {
      const labelRect = fileTypeHeader.getBoundingClientRect();
      const below = buttons.find((b) => {
        const r = b.getBoundingClientRect();
        return r.top >= labelRect.top && r.top <= labelRect.bottom + 90 && r.height >= 25 && r.height <= 80 && r.width >= 100;
      });
      if (below) return below;

      const allDivs = [...document.querySelectorAll('div[role], div[tabindex], div[aria-haspopup], [role="combobox"]')].filter(visible);
      const divBelow = allDivs.find((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= labelRect.top && r.top <= labelRect.bottom + 90 && r.height >= 25 && r.height <= 80 && r.width >= 100;
      });
      if (divBelow) return divBelow;
    }

    // 3. Fallback: button whose text starts with any known file type (PDF, PNG, JPG, PPTX, XLSX, etc.)
    const typeRegex = /^(pdf|png|jpg|jpeg|svg|mp4|gif|pptx|microsoft powerpoint|xlsx|microsoft excel|excel)\b/i;
    hit = buttons.find((b) => {
      const r = b.getBoundingClientRect();
      if (r.height < 25 || r.height > 80 || r.width < 100) return false;
      const txt = norm(b.textContent);
      const aria = norm(b.getAttribute('aria-label') || '');
      if (txt === 'download' || aria === 'download') return false;
      if (txt === 'digital' || txt === 'print') return false;
      return typeRegex.test(txt) || typeRegex.test(aria);
    });
    return hit || null;
  }

  // ─── Format option inside the open file-type listbox (PPTX or XLSX) ────────
  function findFormatOption(triggerEl, format = 'pptx') {
    const want = (format === 'xlsx' ? S.xlsxOption : S.pptxOption).map(norm);

    // Filter elements that are visible and contain the format words
    const matching = [...document.querySelectorAll('*')].filter((el) => {
      if (!visible(el)) return false;
      if (triggerEl && (triggerEl === el || triggerEl.contains(el))) return false;
      const r = el.getBoundingClientRect();
      if (r.width > 600 || r.height > 150 || r.width < 50 || r.height < 15) return false;
      const txt = norm(el.textContent);
      return want.some((w) => txt.includes(w));
    });

    if (!matching.length) return null;

    // 1. Match element with role="option", role="menuitem", etc.
    const roleMatch = matching.find((el) => {
      const role = el.getAttribute('role');
      return ['option', 'menuitem', 'menuitemradio', 'listitem', 'button'].includes(role) || el.tagName === 'BUTTON' || el.tagName === 'LI';
    });
    if (roleMatch) return roleMatch;

    // 2. Match element inside an option role container
    const insideOption = matching.find((el) => el.closest('[role="option"], [role="menuitem"], [role="listitem"]'));
    if (insideOption) {
      return insideOption.closest('[role="option"], [role="menuitem"], [role="listitem"]');
    }

    // 3. Match row container with height 30-85px
    const rowMatch = matching.find((el) => {
      const r = el.getBoundingClientRect();
      return r.height >= 30 && r.height <= 85 && r.width >= 120;
    });
    if (rowMatch) return rowMatch;

    // Fallback: smallest matching element
    return matching.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length)[0];
  }

  // Clicks an option row and any inner text element to ensure full React event triggering
  function clickOption(el, format = 'pptx') {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    press(el);
    const regex = format === 'xlsx' ? /xlsx|excel/i : /pptx|powerpoint/i;
    const innerText = [...el.querySelectorAll('*')].find((c) => {
      const t = norm(c.textContent);
      return regex.test(t);
    });
    if (innerText && innerText !== el) {
      press(innerText);
    }
  }

  // ─── Download button at the bottom of the panel ───────────────────────────
  function findFinalDownload(hasPremiumAccount = false) {
    const want = S.finalDownload.map(norm);
    const allButtons = [...document.querySelectorAll('button, [role="button"]')].filter(visible);

    const downloadButtons = allButtons.filter((b) => {
      const txt = norm(b.textContent);
      const aria = norm(b.getAttribute('aria-label') || '');
      if (txt.includes('pay and download')) return false;
      if (!hasPremiumAccount && txt.includes('download with canva pro')) return false;
      return want.includes(txt) || want.includes(aria) || (hasPremiumAccount && (txt.includes('download with canva pro') || aria.includes('download with canva pro')));
    });

    if (downloadButtons.length) {
      return downloadButtons.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    }

    return allButtons.find((b) => {
      const txt = norm(b.textContent);
      if (txt.includes('pay and download')) return false;
      if (!hasPremiumAccount && txt.includes('download with canva pro')) return false;
      return txt.startsWith('download') && b.getBoundingClientRect().width > 100;
    }) || null;
  }

  // Waits until check() returns truthy, watching DOM mutations
  function waitFor(check, seconds) {
    return new Promise((resolve) => {
      const first = check();
      if (first) return resolve(first);
      const obs = new MutationObserver(() => {
        const hit = check();
        if (hit) {
          obs.disconnect();
          clearTimeout(timer);
          resolve(hit);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const timer = setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, seconds * 1000);
    });
  }

  // Check if this template is marked as Canva Pro or Paid in Canva's embedded page data
  function isProFromPageData() {
    const m = location.pathname.match(/\/(EA[A-Za-z0-9_-]{6,})/);
    const templateId = m ? m[1] : '';
    if (!templateId) return false;

    // Canva encodes template license in JSON state as: "DI":"<id>",...,"DL":"canva_pro" or "DL":"paid"
    const regex = new RegExp(
      `"${templateId}"[\\s\\S]{0,350}"DL"\\s*:\\s*"(canva_pro|paid|canva:paid|canva:pro)"|"DL"\\s*:\\s*"(canva_pro|paid|canva:paid|canva:pro)"[\\s\\S]{0,350}"${templateId}"`
    );
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      if (s.textContent && regex.test(s.textContent)) return true;
    }
    if (regex.test(document.documentElement.innerHTML.slice(0, 600000))) return true;
    return false;
  }

  // Check for crown icons, pro badges or aria-labels in the main template container
  function hasProBadge() {
    const main = document.querySelector('main, [role="main"], [role="dialog"]') || document.body;
    const elements = [...main.querySelectorAll('*')].filter(visible);
    return elements.some((el) => {
      if (el.closest('header, nav, [role="banner"], [role="navigation"], [aria-label*="navigation" i]')) return false;

      const aria = norm(el.getAttribute('aria-label') || '');
      const title = norm(el.getAttribute('title') || '');
      const testId = norm(el.getAttribute('data-testid') || '');
      const dataIcon = norm(el.getAttribute('data-icon') || '');
      const cls = norm(typeof el.className === 'string' ? el.className : '');

      if (aria === 'pro' || aria === 'canva pro' || title === 'pro' || title === 'canva pro') return true;
      if (aria.includes('crown') || title.includes('crown') || testId.includes('crown') || dataIcon.includes('crown')) return true;
      if (testId.includes('pro-badge') || testId.includes('premium-badge') || cls.includes('probadge') || cls.includes('crown')) return true;

      // Small badge pill with visible text "Pro" or "PRO"
      if (el.children.length === 0) {
        const text = (el.textContent || '').trim();
        if (text === 'Pro' || text === 'PRO') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 120 && rect.height > 0 && rect.height < 60) {
            return true;
          }
        }
      }

      // Check SVG crown icons
      if (el.tagName && el.tagName.toLowerCase() === 'svg') {
        if (cls.includes('crown') || dataIcon.includes('crown')) return true;
        const paths = el.querySelectorAll('path');
        for (const p of paths) {
          const pId = norm(p.getAttribute('id') || '');
          const pCls = norm(p.getAttribute('class') || '');
          if (pId.includes('crown') || pCls.includes('crown')) return true;
        }
      }

      return false;
    });
  }

  // Check if a specific button is marked with Pro / Crown indicators
  function isButtonPro(btn) {
    if (!btn) return false;
    const txt = norm(btn.textContent || '');
    const aria = norm(btn.getAttribute('aria-label') || '');
    if ((S.proCtaButtons || []).some((w) => txt.includes(norm(w)) || aria.includes(norm(w)))) return true;
    if ((S.proSigns || []).some((w) => txt.includes(norm(w)) || aria.includes(norm(w)))) return true;

    const icons = btn.querySelectorAll('svg, [data-icon="crown"], [aria-label*="crown" i], [aria-label*="pro" i]');
    for (const icon of icons) {
      const sAria = norm(icon.getAttribute('aria-label') || '');
      const sIcon = norm(icon.getAttribute('data-icon') || '');
      if (sAria.includes('crown') || sAria.includes('pro') || sIcon.includes('crown')) return true;
    }
    for (const child of btn.querySelectorAll('*')) {
      if (child.children.length === 0 && (child.textContent || '').trim().toUpperCase() === 'PRO') return true;
    }
    return false;
  }

  // Check if an open modal dialog or overlay asks for Canva Pro or payment
  function hasProDialog() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-modal="true"], div[class*="modal" i]')].filter(visible);
    return dialogs.some((d) => {
      const txt = norm(d.innerText || d.textContent);
      return S.proSigns.some((w) => txt.includes(w));
    });
  }

  // Check visible text across overlays or main body (excluding global top nav) for Pro paywall signs
  function hasProText() {
    const overlays = [...document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [data-modal="true"], [class*="modal" i], [class*="dialog" i], [class*="overlay" i], [class*="sheet" i], [class*="drawer" i], [class*="popup" i]'
    )].filter(visible);

    for (const o of overlays) {
      const txt = norm(o.innerText || o.textContent);
      if (S.proSigns.some((w) => txt.includes(w))) return true;
    }

    const main = document.querySelector('main, [role="main"]') || document.body;
    if (main) {
      const clone = main.cloneNode(true);
      for (const el of clone.querySelectorAll('header, nav, [role="banner"], [role="navigation"], [aria-label*="navigation" i]')) {
        el.remove();
      }
      const txt = norm(clone.textContent || '');
      const templateProSigns = [
        'try canva pro',
        'upgrade to canva pro',
        'get canva pro',
        'unlock with canva pro',
        'unlock this template',
        'start free trial',
        'start your free trial',
        'try it free for 30 days',
        'included with canva pro',
        'canva pro template',
        'premium template',
        'cancel anytime',
        'switch to canva pro',
        'go pro',
      ];
      if (templateProSigns.some((w) => txt.includes(w))) return true;
    }

    return false;
  }

  // Check if a paywall overlay/modal is visible with trial or upgrade CTA
  function isPaywallVisible() {
    const paywallWords = [
      'try it free for 30 days',
      'try canva pro for free',
      'start your free trial',
      'start free trial',
      'start 30-day free trial',
      'start trial',
      'upgrade to canva pro',
      'upgrade to pro',
      'try canva pro',
      'try pro',
      'get canva pro',
      'unlock with canva pro',
      'unlock this template',
      'canva pro template',
      'premium template',
      'cancel anytime',
      'switch to canva pro',
      'subscribe to canva pro',
    ];

    const overlays = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-modal="true"], div[class*="modal" i], div[class*="dialog" i], div[class*="overlay" i], div[class*="popup" i]')].filter(visible);
    for (const o of overlays) {
      const txt = norm(o.innerText || o.textContent);
      if (paywallWords.some((w) => txt.includes(w))) return true;
    }
    return false;
  }

  // Check if the template landing page CTA button is an "Upgrade / Pro" button
  function findProTemplateCta() {
    const proWords = (S.proCtaButtons || []).map(norm);
    const els = [...document.querySelectorAll(S.clickable)].filter(visible);
    // Ignore top global navigation bar and header elements
    const mainEls = els.filter((el) => !el.closest('header, nav, [role="banner"], [aria-label*="navigation" i]'));
    for (const w of proWords) {
      const hit = mainEls.find((el) => {
        const l = labelOf(el);
        return l === w || l.startsWith(w);
      });
      if (hit) return hit;
    }
    return null;
  }

  // Check if the Download panel indicates premium / paid items
  function hasPremiumInDownloadPanel() {
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
    const premiumBtn = buttons.some((b) => {
      const txt = norm(b.textContent);
      const aria = norm(b.getAttribute('aria-label') || '');
      return (
        txt.includes('pay and download') ||
        txt.includes('download with canva pro') ||
        aria.includes('pay and download') ||
        aria.includes('download with canva pro')
      );
    });
    if (premiumBtn) return true;

    const panels = [...document.querySelectorAll('[role="dialog"], [role="region"], [aria-label*="download" i]')].filter(visible);
    const terms = ['pay and download', 'download with canva pro', 'contains premium', 'premium image', 'premium elements', 'pay for images'];
    return panels.some((p) => {
      const txt = norm(p.innerText || p.textContent);
      return terms.some((t) => txt.includes(t));
    });
  }

  // Checks if this template has Pro/Premium indicators in metadata or page markup
  function isTemplatePro() {
    return (
      isProFromPageData() ||
      hasProBadge() ||
      Boolean(findProTemplateCta())
    );
  }

  // Checks if download is blocked by a paywall
  function isBlockedByPaywall(hasPremiumAccount = false) {
    if (!hasPremiumAccount) {
      return (
        isTemplatePro() ||
        hasProDialog() ||
        hasProText() ||
        isPaywallVisible() ||
        hasPremiumInDownloadPanel()
      );
    }
    // For users with Canva Pro account, Pro templates are allowed.
    // Only block if an actual paywall dialog/overlay is actively showing.
    return hasProDialog() || isPaywallVisible();
  }

  function isPro() {
    return isBlockedByPaywall(false);
  }

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  const pageHas = (words) => {
    const text = norm(document.body && document.body.innerText).slice(0, 300000);
    return words.some((w) => text.includes(w));
  };

  function problem() {
    if (S.loginPath.test(location.pathname)) return ['stop', 'Logged out of Canva'];
    if (pageHas(S.captchaSigns)) return ['stop', 'Canva asks you to verify you are human'];
    if (pageHas(S.slowDownSigns)) return ['stop', 'Canva says too many requests, slow down'];
    return null;
  }

  async function run(jobId, afterUse, opts = {}) {
    const format = ((opts && opts.format) || 'pptx').toLowerCase();
    const hasPremiumAccount = Boolean(opts && opts.hasPremiumAccount);
    const onlyPremium = Boolean(opts && opts.onlyPremium);

    const step = (name) => send({ type: 'STEP', jobId, step: name });
    const result = (kind, error) => send({ type: 'RESULT', jobId, kind, error });
    const notFound = (what) => {
      const p = problem();
      if (p) return result(...p);
      if (isBlockedByPaywall(hasPremiumAccount)) {
        return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
      }
      const seen = [
        ...new Set(
          [...document.querySelectorAll(S.clickable)].filter(visible).map(labelOf).filter(Boolean)
        ),
      ]
        .slice(0, 30)
        .join(' | ')
        .slice(0, 400);
      return result(
        'retry',
        `Could not find "${what}" on ${location.pathname}. Buttons on the page: ${seen || 'none'}`,
      );
    };
    const T = S.stepTimeoutSec;

    const p = problem();
    if (p) return result(...p);

    // If onlyPremium mode is enabled, skip free templates!
    if (onlyPremium && !isTemplatePro()) {
      return result('skip', 'Skipped: Not a premium template (Premium-only mode enabled)');
    }

    // ── Step 1: Open template / editor ──────────────────────────────────────
    if (S.editorPath.test(location.pathname)) {
      await step('editor-opened');
    } else {
      // Check if blocked by paywall before clicking
      if (isBlockedByPaywall(hasPremiumAccount)) {
        return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
      }

      const use = await waitFor(() => findByText(S.useTemplate), T * 2);
      if (!use) {
        if (isBlockedByPaywall(hasPremiumAccount)) {
          return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
        }
        return notFound(S.useTemplate[0]);
      }

      // Check again right before clicking
      if (isBlockedByPaywall(hasPremiumAccount) || (!hasPremiumAccount && isButtonPro(use))) {
        return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
      }

      await step('use-template');
      const anchor = use.tagName === 'A' ? use : use.closest('a');
      const href = anchor && anchor.getAttribute('href');
      if (href && href.includes('/design/')) {
        send({ type: 'NAVIGATE_JOB', jobId, url: href });
      } else {
        const inner = use.querySelector('span, div, p');
        if (inner && inner !== use) press(inner);
        press(use);
        if (anchor && anchor !== use) press(anchor);
      }

      // Actively watch for paywall modal, Pro badges, or editor navigation
      for (let sec = 0; sec < 18; sec++) {
        await sleep(1000);
        if (isBlockedByPaywall(hasPremiumAccount)) {
          return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
        }
        if (S.editorPath.test(location.pathname)) {
          await step('editor-opened');
          break;
        }
      }

      if (!S.editorPath.test(location.pathname)) {
        if (isBlockedByPaywall(hasPremiumAccount)) {
          return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
        }

        const status = await send({ type: 'GET_JOB_STATUS', jobId });
        if (status && status.switchedTab) {
          // Editor opened in a new tab; background worker took over
          return;
        }

        return result('skip', hasPremiumAccount ? 'Could not open editor (timeout or paywall)' : 'Needs Canva Pro / Premium template');
      }
    }

    // ── Step 2: Open Share Menu → Click Download ────────────────────────────
    const share = await waitFor(() => findByText(S.share), S.editorLoadSec);
    if (!share) return notFound('Share');
    await step('share');
    press(share);
    await sleep(600);

    const menuItem = await waitFor(() => findByText(S.download), T);
    if (!menuItem) return notFound('Download in Share menu');
    await step('download-menu');
    press(menuItem);
    await sleep(600);

    // ── Step 3: Select Requested Format (PPTX or XLSX) ──────────────────────
    if (isBlockedByPaywall(hasPremiumAccount)) {
      return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
    }

    let typeMenu = await waitFor(findFileTypeMenu, T);
    if (!typeMenu) {
      if (isBlockedByPaywall(hasPremiumAccount)) {
        return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
      }
      return notFound('File type dropdown');
    }

    const isFormatSelected = () => {
      const m = findFileTypeMenu();
      if (!m) return false;
      const t = norm(m.textContent);
      const aria = norm(m.getAttribute('aria-label') || '');
      const regex = format === 'xlsx' ? S.xlsxSelected : S.pptxSelected;
      return regex.test(t) || regex.test(aria);
    };

    let selected = isFormatSelected();

    // Loop up to 6 rounds to ensure requested format is genuinely selected
    for (let round = 1; round <= 6 && !selected; round++) {
      typeMenu = findFileTypeMenu();
      if (!typeMenu) break;

      // 1. If format is not currently visible, open the dropdown
      let option = findFormatOption(typeMenu, format);
      if (!option) {
        press(typeMenu);
        await step('file-type-opened');
        option = await waitFor(() => findFormatOption(typeMenu, format), 2.5);
      }

      // 2. Click the format option
      if (option) {
        clickOption(option, format);
        await sleep(600);
      }

      // 3. Verify if dropdown button now reflects requested format
      await waitFor(() => (isFormatSelected() ? true : null), 2);
      selected = isFormatSelected();
      if (selected) break;
      await sleep(400);
    }

    const fmtLabel = format.toUpperCase();
    if (!selected) {
      const current = typeMenu ? norm(typeMenu.textContent) : 'unknown';
      return result('retry', `Could not select ${fmtLabel} in dropdown (current: "${current}"). Stopped to prevent downloading wrong format.`);
    }

    await step(`${format}-selected`);
    await sleep(600);

    // ── Step 4: Click the Download button ───────────────────────────────────
    if (isBlockedByPaywall(hasPremiumAccount)) {
      return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
    }

    const finalButton = await waitFor(() => findFinalDownload(hasPremiumAccount), T);
    if (!finalButton) {
      if (isBlockedByPaywall(hasPremiumAccount)) {
        return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
      }
      return notFound('Download button');
    }
    await step('download-clicked');
    press(finalButton);

    const paywallImmediate = await waitFor(() => (isBlockedByPaywall(hasPremiumAccount) ? true : null), 4);
    if (paywallImmediate) {
      return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
    }

    // Keep watchdog refreshed while Canva compiles the file on its servers
    for (let i = 0; i < 25; i++) {
      await sleep(3000);
      if (isBlockedByPaywall(hasPremiumAccount)) {
        return result('skip', hasPremiumAccount ? 'Paywall encountered on Pro account' : 'Needs Canva Pro / Premium template');
      }
      await step('download-clicked');

      const btn = findFinalDownload(hasPremiumAccount);
      if (btn && !btn.disabled) {
        const body = norm(document.body.innerText).slice(0, 200000);
        const preparing = /preparing|generating|processing|creating your file|downloading/.test(body);
        if (!preparing) {
          press(btn);
        }
      }
    }
  }

  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === '__CANVA_OPEN_URL__' && ev.data.url && runningJob) {
      send({ type: 'NAVIGATE_JOB', jobId: runningJob, url: ev.data.url });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'RUN' || msg.jobId === runningJob) return;
    runningJob = msg.jobId;
    run(msg.jobId, msg.afterUse, {
      format: msg.format,
      hasPremiumAccount: msg.hasPremiumAccount,
      onlyPremium: msg.onlyPremium,
    }).catch((e) =>
      send({ type: 'RESULT', jobId: msg.jobId, kind: 'retry', error: `Runner error: ${e.message}` })
    );
  });
})();
