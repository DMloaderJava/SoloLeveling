/**
 * Движок документации Solo Leveling.
 *
 * Отвечает за общий каркас страниц (шапка, боковое меню, оглавление),
 * подсветку кода, кнопки копирования, переключение темы и поиск по всем
 * страницам. Разметку навигации хранит только этот файл — страницы
 * содержат лишь свой контент.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Карта документации
  // ---------------------------------------------------------------------

  const NAV = [
    {
      title: 'Начало',
      items: [
        { file: 'index.html', title: 'Обзор проекта', icon: '◈' },
        { file: 'setup.html', title: 'Установка и запуск', icon: '▶' },
        { file: 'architecture.html', title: 'Архитектура', icon: '⬡' },
        { file: 'data-model.html', title: 'Модель данных', icon: '▤' },
      ],
    },
    {
      title: 'Бэкенд',
      items: [
        { file: 'server.html', title: 'server.js построчно', icon: '⚙' },
        { file: 'api.html', title: 'Справочник REST API', icon: '⇄' },
        { file: 'security.html', title: 'Безопасность', icon: '⛨' },
      ],
    },
    {
      title: 'Фронтенд',
      items: [
        { file: 'frontend-index.html', title: 'index.html — главная', icon: '★' },
        { file: 'frontend-page2.html', title: 'page2.html — тренажёр', icon: '⌘' },
        { file: 'frontend-auth.html', title: 'Вход и профиль', icon: '⚿' },
        { file: 'skills-store.html', title: 'skills-store.js', icon: '◎' },
      ],
    },
    {
      title: 'Качество',
      items: [
        { file: 'testing.html', title: 'Тесты и CI', icon: '✓' },
        { file: 'changelog.html', title: 'Что изменилось', icon: '⟳' },
        { file: 'faq.html', title: 'FAQ и глоссарий', icon: '?' },
      ],
    },
  ];

  const FLAT = NAV.flatMap((group) => group.items);
  const CURRENT = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // ---------------------------------------------------------------------
  // Подсветка синтаксиса (минималистичная, без внешних зависимостей)
  // ---------------------------------------------------------------------

  const KEYWORDS = new RegExp(
    '\\b(const|let|var|function|return|if|else|for|while|of|in|new|class|extends|' +
      'async|await|try|catch|finally|throw|typeof|instanceof|delete|void|this|super|' +
      'import|export|default|from|null|undefined|true|false|break|continue|switch|case|do|yield|static|get|set)\\b',
    'g'
  );

  /** Экранирует HTML, чтобы код отображался как текст. */
  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Токенизирует исходник. Строки и комментарии вырезаются первыми и
   * заменяются плейсхолдерами, чтобы ключевые слова внутри них не красились.
   */
  function highlight(source, lang) {
    const slots = [];
    const stash = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let code = escapeHtml(source);

    if (lang === 'html' || lang === 'xml') {
      code = code
        .replace(/&lt;!--[\s\S]*?--&gt;/g, (m) => stash(`<span class="tok-com">${m}</span>`))
        .replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, (m, br, tag) => `${br}<span class="tok-tag">${tag}</span>`)
        .replace(/([a-zA-Z-]+)=(&quot;|")(.*?)\2/g, (m, attr, q, val) =>
          `<span class="tok-att">${attr}</span>=<span class="tok-str">${q}${val}${q}</span>`
        );
      return restore(code, slots);
    }

    if (lang === 'bash' || lang === 'shell') {
      code = code
        .replace(/#.*$/gm, (m) => stash(`<span class="tok-com">${m}</span>`))
        .replace(/("[^"]*"|'[^']*')/g, (m) => stash(`<span class="tok-str">${m}</span>`))
        .replace(/\b(npm|node|git|gh|curl|cd|mkdir|rm|export|sudo|echo|cat|npx)\b/g, '<span class="tok-key">$1</span>')
        .replace(/(--?[a-zA-Z][\w-]*)/g, '<span class="tok-att">$1</span>');
      return restore(code, slots);
    }

    // js / json / прочее
    code = code
      .replace(/\/\*[\s\S]*?\*\//g, (m) => stash(`<span class="tok-com">${m}</span>`))
      .replace(/(^|[^:\\])\/\/.*$/gm, (m, prefix) =>
        prefix + stash(`<span class="tok-com">${m.slice(prefix.length)}</span>`)
      )
      .replace(/(`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, (m) => stash(`<span class="tok-str">${m}</span>`))
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>')
      .replace(KEYWORDS, '<span class="tok-key">$1</span>')
      .replace(/\b([a-zA-Z_$][\w$]*)\s*\(/g, '<span class="tok-fn">$1</span>(');

    return restore(code, slots);
  }

  function restore(code, slots) {
    return code.replace(/\u0000(\d+)\u0000/g, (m, index) => slots[Number(index)]);
  }

  /** Оформляет все блоки <pre data-lang="..."> в готовые карточки кода. */
  function decorateCode() {
    document.querySelectorAll('pre[data-lang]').forEach((pre) => {
      const lang = pre.dataset.lang || 'js';
      const label = pre.dataset.file || lang;
      const raw = pre.textContent.replace(/^\n/, '').replace(/\s+$/, '');

      const wrap = document.createElement('div');
      wrap.className = 'codeblock';
      wrap.innerHTML =
        `<div class="codeblock__head"><span class="codeblock__lang">${lang}</span>` +
        `<span>${label === lang ? '' : label}</span>` +
        '<button class="codeblock__copy" type="button">Копировать</button></div>';

      const body = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.innerHTML = highlight(raw, lang);
      body.appendChild(codeEl);
      wrap.appendChild(body);

      pre.replaceWith(wrap);

      wrap.querySelector('.codeblock__copy').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(raw);
          button.textContent = 'Скопировано';
          button.classList.add('is-done');
        } catch (error) {
          button.textContent = 'Ошибка';
        }
        setTimeout(() => {
          button.textContent = 'Копировать';
          button.classList.remove('is-done');
        }, 1600);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Каркас страницы
  // ---------------------------------------------------------------------

  function buildChrome() {
    const content = document.querySelector('.content');
    const pageTitle = document.querySelector('h1')?.textContent || 'Документация';

    const topbar = document.createElement('header');
    topbar.className = 'topbar';
    topbar.innerHTML = `
      <button class="topbar__btn" id="menuToggle" type="button" aria-label="Меню">☰</button>
      <a class="topbar__brand" href="index.html">
        <span class="topbar__logo">SL</span> Solo Leveling
        <span class="topbar__tag">Документация кода</span>
      </a>
      <div class="topbar__spacer"></div>
      <button class="topbar__btn topbar__search" id="searchOpen" type="button">
        <span>🔍 Поиск по документации</span><kbd>Ctrl K</kbd>
      </button>
      <button class="topbar__btn" id="themeToggle" type="button" title="Сменить тему">◐</button>
      <a class="topbar__btn" href="../index.html">Открыть приложение ↗</a>
    `;

    const layout = document.createElement('div');
    layout.className = 'layout';

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.innerHTML = NAV.map(
      (group) => `
        <div class="sidebar__group">
          <p class="sidebar__title">${group.title}</p>
          ${group.items
            .map(
              (item) =>
                `<a class="sidebar__link${item.file === CURRENT ? ' is-active' : ''}" href="${item.file}">` +
                `<span class="sidebar__icon">${item.icon}</span>${item.title}</a>`
            )
            .join('')}
        </div>`
    ).join('');

    const toc = document.createElement('nav');
    toc.className = 'toc';
    toc.innerHTML = '<p class="toc__title">На этой странице</p><div id="tocLinks"></div>';

    content.parentNode.insertBefore(layout, content);
    layout.append(sidebar, content, toc);
    document.body.insertBefore(topbar, layout);

    document.title = `${pageTitle} — документация Solo Leveling`;

    document.getElementById('menuToggle').addEventListener('click', () => sidebar.classList.toggle('is-open'));
    sidebar.addEventListener('click', (event) => {
      if (event.target.closest('a')) sidebar.classList.remove('is-open');
    });
  }

  /** Хлебные крошки + ссылки «назад / дальше» по порядку страниц. */
  function buildPager() {
    const content = document.querySelector('.content');
    const index = FLAT.findIndex((item) => item.file === CURRENT);
    const current = FLAT[index];

    if (current && !content.querySelector('.breadcrumbs')) {
      const crumbs = document.createElement('div');
      crumbs.className = 'breadcrumbs';
      crumbs.innerHTML = `<a href="index.html">Документация</a> › ${current.title}`;
      content.insertBefore(crumbs, content.firstChild);
    }

    if (index === -1) return;

    const prev = FLAT[index - 1];
    const next = FLAT[index + 1];
    const pager = document.createElement('nav');
    pager.className = 'pager';
    pager.innerHTML =
      (prev ? `<a href="${prev.file}"><span>← Назад</span>${prev.title}</a>` : '<span style="flex:1"></span>') +
      (next ? `<a class="pager--next" href="${next.file}"><span>Дальше →</span>${next.title}</a>` : '');
    content.appendChild(pager);
  }

  /** Оглавление по заголовкам h2/h3 + подсветка активного раздела. */
  function buildToc() {
    const holder = document.getElementById('tocLinks');
    const headings = [...document.querySelectorAll('.content h2, .content h3')];
    if (!holder) return;

    headings.forEach((heading, i) => {
      if (!heading.id) {
        heading.id =
          heading.textContent
            .trim()
            .toLowerCase()
            .replace(/[^a-zа-я0-9]+/gi, '-')
            .replace(/^-|-$/g, '') || `section-${i}`;
      }
      const anchor = document.createElement('a');
      anchor.href = `#${heading.id}`;
      anchor.className = 'anchor';
      anchor.textContent = '#';
      heading.appendChild(anchor);

      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent.replace(/#$/, '');
      link.dataset.depth = heading.tagName === 'H3' ? '3' : '2';
      holder.appendChild(link);
    });

    const links = [...holder.querySelectorAll('a')];
    // IntersectionObserver есть не везде (например, в тестовой среде jsdom) —
    // без него оглавление просто не подсвечивает активный раздел.
    if (!links.length || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.remove('is-active'));
          const active = links.find((link) => link.getAttribute('href') === `#${entry.target.id}`);
          active?.classList.add('is-active');
        });
      },
      { rootMargin: '-80px 0px -70% 0px' }
    );

    headings.forEach((heading) => observer.observe(heading));
  }

  // ---------------------------------------------------------------------
  // Тема
  // ---------------------------------------------------------------------

  function initTheme() {
    const saved = localStorage.getItem('sl-docs-theme');
    if (saved) document.documentElement.dataset.theme = saved;

    document.getElementById('themeToggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('sl-docs-theme', next);
    });
  }

  // ---------------------------------------------------------------------
  // Поиск по всем страницам
  // ---------------------------------------------------------------------

  let searchIndex = null;

  /** Скачивает все страницы один раз и строит индекс «заголовок + абзац». */
  async function buildSearchIndex() {
    if (searchIndex) return searchIndex;

    const pages = await Promise.all(
      FLAT.map(async (item) => {
        try {
          const html = await (await fetch(item.file)).text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const blocks = [...doc.querySelectorAll('.content h2, .content h3, .content p, .content li, .content td')];

          let heading = item.title;
          let headingId = '';

          return blocks
            .map((node) => {
              if (node.tagName === 'H2' || node.tagName === 'H3') {
                heading = node.textContent.trim();
                headingId =
                  node.id ||
                  heading
                    .toLowerCase()
                    .replace(/[^a-zа-я0-9]+/gi, '-')
                    .replace(/^-|-$/g, '');
                return null;
              }
              const text = node.textContent.replace(/\s+/g, ' ').trim();
              if (text.length < 25) return null;
              return { file: item.file, page: item.title, heading, hash: headingId, text };
            })
            .filter(Boolean);
        } catch (error) {
          return [];
        }
      })
    );

    searchIndex = pages.flat();
    return searchIndex;
  }

  function initSearch() {
    const overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.innerHTML = `
      <div class="search-box">
        <input type="search" id="searchInput" placeholder="Искать по документации: API, bcrypt, XP, таймер…" autocomplete="off">
        <div class="search-results" id="searchResults">
          <div class="search-empty">Введите запрос — поиск идёт по всем ${FLAT.length} страницам.</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#searchInput');
    const results = overlay.querySelector('#searchResults');

    const open = async () => {
      overlay.classList.add('is-open');
      input.focus();
      input.select();
      await buildSearchIndex();
    };
    const close = () => overlay.classList.remove('is-open');

    document.getElementById('searchOpen').addEventListener('click', open);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        overlay.classList.contains('is-open') ? close() : open();
      }
      if (event.key === 'Escape') close();
    });

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      if (query.length < 2) {
        results.innerHTML = '<div class="search-empty">Введите минимум два символа.</div>';
        return;
      }

      const words = query.split(/\s+/);
      const found = (searchIndex || [])
        .map((entry) => {
          const haystack = `${entry.heading} ${entry.text}`.toLowerCase();
          const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
          return { entry, score };
        })
        .filter((item) => item.score === words.length)
        .slice(0, 24);

      if (!found.length) {
        results.innerHTML = '<div class="search-empty">Ничего не найдено.</div>';
        return;
      }

      const rx = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      results.innerHTML = found
        .map(({ entry }) => {
          const snippet = escapeHtml(entry.text.slice(0, 190)).replace(rx, '<mark>$1</mark>');
          const href = entry.hash ? `${entry.file}#${entry.hash}` : entry.file;
          return `<a href="${href}"><span class="sr-page">${entry.page} › ${escapeHtml(entry.heading)}</span>
            <span class="sr-text">${snippet}…</span></a>`;
        })
        .join('');
    });
  }

  // ---------------------------------------------------------------------
  // Старт
  // ---------------------------------------------------------------------

  function init() {
    // Защита от повторной инициализации: каркас должен собираться ровно один раз.
    if (document.querySelector('.topbar')) return;

    buildChrome();
    buildPager();
    decorateCode();
    buildToc();
    initTheme();
    initSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
