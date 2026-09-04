'use strict';

/**
 * Проверки сайта документации: страницы существуют, скрипты каркаса
 * исполняются без ошибок, внутренние ссылки никуда не «протухли».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const DOCS = path.join(__dirname, '..', 'docs');

const PAGES = fs
  .readdirSync(DOCS)
  .filter((file) => file.endsWith('.html'))
  .sort();

test('в docs/ лежат все страницы документации', () => {
  const expected = [
    'api.html',
    'architecture.html',
    'changelog.html',
    'data-model.html',
    'faq.html',
    'frontend-auth.html',
    'frontend-index.html',
    'frontend-page2.html',
    'index.html',
    'security.html',
    'server.html',
    'setup.html',
    'skills-store.html',
    'testing.html',
  ];
  assert.deepEqual(PAGES, expected);
});

test('каждая страница подключает общие стили и движок', () => {
  PAGES.forEach((page) => {
    const html = fs.readFileSync(path.join(DOCS, page), 'utf8');
    assert.ok(html.includes('assets/docs.css'), `${page}: нет docs.css`);
    assert.ok(html.includes('assets/docs.js'), `${page}: нет docs.js`);
    assert.ok(/<main class="content">/.test(html), `${page}: нет контейнера .content`);
    assert.ok(/<h1>/.test(html), `${page}: нет заголовка h1`);
  });
});

test('внутренние ссылки ведут на существующие файлы', () => {
  const broken = [];

  PAGES.forEach((page) => {
    const html = fs.readFileSync(path.join(DOCS, page), 'utf8');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    links
      .filter((href) => !/^(https?:|mailto:|#)/.test(href))
      .forEach((href) => {
        const target = href.split('#')[0];
        if (!target) return;
        if (!fs.existsSync(path.resolve(DOCS, target))) broken.push(`${page} → ${href}`);
      });
  });

  assert.deepEqual(broken, [], 'битые ссылки');
});

test('все пункты меню в docs.js существуют как файлы', () => {
  const js = fs.readFileSync(path.join(DOCS, 'assets', 'docs.js'), 'utf8');
  const files = [...js.matchAll(/file: '([^']+)'/g)].map((match) => match[1]);

  assert.ok(files.length >= 14, 'в навигации меньше страниц, чем ожидалось');
  files.forEach((file) => {
    assert.ok(fs.existsSync(path.join(DOCS, file)), `нет файла ${file} из навигации`);
  });
});

test('каркас документации собирается без ошибок JS', async () => {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(String(error)));

  const dom = new JSDOM(fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8'), {
    url: 'http://localhost/docs/index.html',
    runScripts: 'outside-only',
    virtualConsole,
  });

  const { window } = dom;
  window.fetch = () => Promise.resolve({ text: async () => '<html></html>' });
  window.eval(fs.readFileSync(path.join(DOCS, 'assets', 'docs.js'), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(errors, [], 'ошибки при сборке каркаса');
  assert.ok(window.document.querySelector('.topbar'), 'не отрисована шапка');
  assert.ok(window.document.querySelectorAll('.sidebar__link').length >= 14, 'меню неполное');
  assert.ok(window.document.querySelector('.codeblock'), 'блоки кода не оформлены');
  assert.ok(window.document.querySelectorAll('#tocLinks a').length > 0, 'не построено оглавление');
  assert.ok(window.document.querySelector('.pager'), 'нет навигации между страницами');
  assert.match(window.document.title, /Solo Leveling/);
});

test('подсветка кода не ломает разметку примеров', async () => {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(String(error)));

  const dom = new JSDOM(fs.readFileSync(path.join(DOCS, 'server.html'), 'utf8'), {
    url: 'http://localhost/docs/server.html',
    runScripts: 'outside-only',
    virtualConsole,
  });

  const { window } = dom;
  window.fetch = () => Promise.resolve({ text: async () => '<html></html>' });
  window.eval(fs.readFileSync(path.join(DOCS, 'assets', 'docs.js'), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

  const blocks = window.document.querySelectorAll('.codeblock pre code');
  assert.ok(blocks.length >= 5, 'примеров кода меньше, чем ожидалось');

  // Внутри примеров не должно остаться служебных плейсхолдеров подсветки.
  blocks.forEach((block) => {
    assert.equal(block.textContent.includes('\u0000'), false, 'остался маркер токенизации');
  });

  assert.deepEqual(errors, []);
});
