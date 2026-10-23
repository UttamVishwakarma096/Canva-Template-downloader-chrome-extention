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
      if (S.templatePath.test(u.pathname)) {
        return `https://www.canva.com${u.pathname.endsWith('/') ? u.pathname : u.pathname + '/'}`;
      }
      if (/^\/design\//.test(u.pathname)) return null;
      const m = S.templateIdInPath.exec(u.pathname.replace(/\/$/, '') + '/');
      if (m) return `https://www.canva.com/templates/${m[1]}/`;
      for (const key of S.templateIdInQuery) {
        const id = u.searchParams.get(key);
        if (id && /^EA[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.canva.com/templates/${id}/`;
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

  // ---------- checkboxes on cards ----------

  // card: the element to put the checkbox on, url: its template link
  function decorate(card, url) {
    if (card.dataset.cbqDone) return;
    card.dataset.cbqDone = '1';
    const host = card.tagName === 'A' ? card.parentElement || card : card;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cbq-box';
    box.title = 'Add to download queue';
    box.dataset.url = url;
    box.checked = ticked.has(url);
    for (const ev of ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup']) {
      box.addEventListener(ev, (e) => e.stopPropagation(), true);
    }
    box.addEventListener('change', () => {
      if (box.checked) ticked.set(url, titleOf(card));
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
  // not links, but each picture comes from template.canva.com/<template id>/...
  const ID_IN_TEXT = /\b(EA[A-Za-z0-9_-]{9})\b/;
  const ID_IN_IMAGE = /^https:\/\/template\.canva\.com\/(EA[A-Za-z0-9_-]{9})\//;
  function fromPicture(img) {
    if (img.closest('[data-cbq-done], .cbq-panel')) return;
    const r = img.getBoundingClientRect();
    if (r.width < 80 || r.height < 50) return;
    const m = ID_IN_IMAGE.exec(img.currentSrc || img.src || '');
    if (m) {
      const card = img.closest(S.cardSelector) || img.parentElement;
      return decorate(card, `https://www.canva.com/templates/${m[1]}/`);
    }
    // Other pages: the template id may sit in an attribute of the card.
    let el = img.parentElement;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
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
    return [
      `Extension version: ${chrome.runtime.getManifest().version}`,
      `Page: ${location.href}`,
      `Checkboxes: ${document.querySelectorAll('.cbq-box').length}`,
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
    <div class="cbq-title">Bulk PPTX download</div>
    <div class="cbq-found"></div>
    <button type="button" data-act="this">Add this template</button>
    <button type="button" data-act="all">Tick all on this page</button>
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
      send([{ url: location.href, title: (h1 && h1.textContent.trim()) || document.title }]);
    } else if (act === 'all') {
      document.querySelectorAll('.cbq-box').forEach((b) => {
        if (!b.checked) {
          b.checked = true;
          b.dispatchEvent(new Event('change'));
        }
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
      const items = [...ticked].map(([url, title]) => ({ url, title }));
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
