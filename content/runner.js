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
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
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

    // 3. Fallback: button whose text starts with any known file type (PDF, PNG, JPG, PPTX, etc.)
    const typeRegex = /^(pdf|png|jpg|jpeg|svg|mp4|gif|pptx|microsoft powerpoint)\b/i;
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

  // ─── PPTX option inside the open file-type listbox ─────────────────────────
  function findPptxOption(triggerEl) {
    const want = S.pptxOption.map(norm);

    // Filter elements that are visible and contain 'pptx' or 'powerpoint'
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
  function clickOption(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    press(el);
    const innerText = [...el.querySelectorAll('*')].find((c) => {
      const t = norm(c.textContent);
      return t === 'pptx' || t.startsWith('pptx') || t.includes('powerpoint');
    });
    if (innerText && innerText !== el) {
      press(innerText);
    }
  }

  // ─── Purple Download button at the bottom of the panel ─────────────────────
  function findFinalDownload() {
    const want = S.finalDownload.map(norm);
    const allButtons = [...document.querySelectorAll('button, [role="button"]')].filter(visible);

    const downloadButtons = allButtons.filter((b) => {
      const txt = norm(b.textContent);
      const aria = norm(b.getAttribute('aria-label') || '');
      if (txt.includes('pay and download') || txt.includes('download with canva pro')) return false;
      return want.includes(txt) || want.includes(aria);
    });

    if (downloadButtons.length) {
      return downloadButtons.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    }

    return allButtons.find((b) => {
      const txt = norm(b.textContent);
      if (txt.includes('pay and download') || txt.includes('download with canva pro')) return false;
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

  // Check if an open modal dialog asks for Canva Pro or payment
  function hasProDialog() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(visible);
    return dialogs.some((d) => {
      const txt = norm(d.innerText || d.textContent);
      return S.proSigns.some((w) => txt.includes(w));
    });
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

  function isPro() {
    return hasProDialog() || Boolean(findProTemplateCta()) || hasPremiumInDownloadPanel();
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

  async function run(jobId, afterUse) {
    const step = (name) => send({ type: 'STEP', jobId, step: name });
    const result = (kind, error) => send({ type: 'RESULT', jobId, kind, error });
    const notFound = (what) => {
      const p = problem();
      if (p) return result(...p);
      if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');
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

    // ── Step 1: Open template / editor ──────────────────────────────────────
    if (S.editorPath.test(location.pathname)) {
      await step('editor-opened');
    } else {
      if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');

      const use = await waitFor(() => findByText(S.useTemplate), T * 2);
      if (!use) {
        if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');
        return notFound(S.useTemplate[0]);
      }

      await step('use-template');
      const anchor = use.tagName === 'A' ? use : use.closest('a');
      const href = anchor && anchor.getAttribute('href');
      if (href && href.includes('/design/')) {
        send({ type: 'NAVIGATE_JOB', jobId, url: href });
      } else {
        press(use);
        const inner = use.querySelector('span, div, p');
        if (inner && inner !== use) press(inner);
      }

      // Check if clicking triggered an upgrade paywall dialog
      const proHit = await waitFor(() => (hasProDialog() || findProTemplateCta() ? true : null), 3);
      if (proHit) return result('skip', 'Needs Canva Pro / Premium template');

      // If the editor opens in the same tab, wait briefly for navigation
      const inSameTab = await waitFor(() => (S.editorPath.test(location.pathname) ? true : null), 6);
      if (inSameTab) {
        await step('editor-opened');
      } else {
        // Canva is opening the editor in a new tab. The background worker will
        // follow the new tab and close this template tab. Wait quietly.
        await sleep(30000);
        return;
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

    // ── Step 3: Select Microsoft PowerPoint Document (.pptx) ────────────────
    if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');

    let typeMenu = await waitFor(findFileTypeMenu, T);
    if (!typeMenu) {
      if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');
      return notFound('File type dropdown');
    }

    const isPptxSelected = () => {
      const m = findFileTypeMenu();
      if (!m) return false;
      const t = norm(m.textContent);
      const aria = norm(m.getAttribute('aria-label') || '');
      return S.pptxSelected.test(t) || S.pptxSelected.test(aria);
    };

    let selected = isPptxSelected();

    // Loop up to 6 rounds to ensure PPTX is genuinely selected
    for (let round = 1; round <= 6 && !selected; round++) {
      typeMenu = findFileTypeMenu();
      if (!typeMenu) break;

      // 1. If PPTX is not currently visible, open the dropdown
      let option = findPptxOption(typeMenu);
      if (!option) {
        press(typeMenu);
        await step('file-type-opened');
        option = await waitFor(() => findPptxOption(typeMenu), 2.5);
      }

      // 2. Click the PPTX option
      if (option) {
        clickOption(option);
        await sleep(600);
      }

      // 3. Verify if dropdown button now reflects PPTX
      await waitFor(() => (isPptxSelected() ? true : null), 2);
      selected = isPptxSelected();
      if (selected) break;
      await sleep(400);
    }

    // CRITICAL: Never proceed to download if PPTX was not selected!
    if (!selected) {
      const current = typeMenu ? norm(typeMenu.textContent) : 'unknown';
      return result('retry', `Could not select PPTX in dropdown (current: "${current}"). Stopped to prevent downloading wrong format.`);
    }

    await step('pptx-selected');
    await sleep(600);

    // ── Step 4: Click the purple Download button ────────────────────────────
    if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');

    const finalButton = await waitFor(findFinalDownload, T);
    if (!finalButton) {
      if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');
      return notFound('Download button');
    }
    await step('download-clicked');
    press(finalButton);

    const proImmediate = await waitFor(() => (isPro() ? true : null), 4);
    if (proImmediate) return result('skip', 'Needs Canva Pro / Premium template');

    // Keep watchdog refreshed while Canva compiles the PPTX on its servers
    for (let i = 0; i < 25; i++) {
      await sleep(3000);
      if (isPro()) return result('skip', 'Needs Canva Pro / Premium template');
      await step('download-clicked');

      const btn = findFinalDownload();
      if (btn && !btn.disabled) {
        const body = norm(document.body.innerText).slice(0, 200000);
        const preparing = /preparing|generating|processing|creating your file|downloading/.test(body);
        if (!preparing) {
          press(btn);
        }
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'RUN' || msg.jobId === runningJob) return;
    runningJob = msg.jobId;
    run(msg.jobId, msg.afterUse).catch((e) =>
      send({ type: 'RESULT', jobId: msg.jobId, kind: 'retry', error: `Runner error: ${e.message}` })
    );
  });
})();
