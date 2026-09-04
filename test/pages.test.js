'use strict';

/**
 * Smoke-тесты страниц в jsdom: проверяем, что инлайновый JS
 * действительно исполняется без ошибок и базовая логика работает.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };

/** Отдаёт файлы проекта с диска и заглушает внешние CDN — тесты не ходят в сеть. */
const localFilesInterceptor = requestInterceptor((request) => {
  const url = new URL(request.url);

  if (url.hostname !== 'localhost') {
    return new Response('', { headers: { 'Content-Type': 'text/javascript' } });
  }

  const filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response('', { status: 404 });
  }

  return new Response(fs.readFileSync(filePath), {
    headers: { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' },
  });
});

/** Загружает страницу с исполнением скриптов и заглушками canvas/fetch. */
async function loadPage(file) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));

  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    url: `http://localhost/${file}`,
    runScripts: 'dangerously',
    resources: { interceptors: [localFilesInterceptor] },
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // Canvas и сетевые вызовы в jsdom не поддерживаются — подменяем заглушками.
      window.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect() {}, beginPath() {}, arc() {}, fill() {},
      });
      window.requestAnimationFrame = () => 0;
      window.fetch = () => Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
    },
  });

  const { window } = dom;

  if (window.document.readyState !== 'complete') {
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(errors.map(String), [], `Ошибки JS на странице ${file}`);
  return window;
}

test('index.html: скрипты исполняются, навык и опыт отрисованы', async () => {
  const window = await loadPage('index.html');

  assert.equal(String(window.document.getElementById('skillNameDisplay').innerText), 'Default Skill');
  assert.equal(String(window.document.getElementById('skillLevelDisplay').innerText), '1');
  assert.match(String(window.document.getElementById('skillExpText').innerText), /0 \/ 5 XP/);
  assert.equal(window.document.getElementById('guiSound'), null, 'мёртвая ссылка на звук удалена');
});

test('index.html: checkLevelUp повышает несколько уровней сразу', async () => {
  const window = await loadPage('index.html');

  const skill = { id: 'test-skill', name: 'Тест', level: 1, exp: 22, desc: '', default: false };
  window.checkLevelUp(skill);

  assert.equal(skill.level, 5, '22 XP = 4 уровня');
  assert.equal(skill.exp, 2, 'остаток опыта сохраняется');
});

test('index.html: задание начисляет XP навыку и отмечается выполненным', async () => {
  const window = await loadPage('index.html');

  window.document.getElementById('newTaskInput').value = 'Отжимания';
  window.document.getElementById('newTaskRewardInput').value = '7';
  window.addTask();

  const created = JSON.parse(window.localStorage.getItem('levelUpData'));
  const task = created.tasks.at(-1);
  assert.equal(task.name, 'Отжимания');
  assert.equal(task.xpSkill, created.skills[0].id, 'XP привязан к навыку из выпадающего списка');

  window.completeTask(task.id);

  const saved = JSON.parse(window.localStorage.getItem('levelUpData'));
  assert.equal(saved.tasks.at(-1).completed, true);
  assert.equal(saved.skills[0].level, 2, '7 XP = один уровень');
  assert.equal(saved.skills[0].exp, 2, 'остаток 2 XP');
});

test('index.html: менеджер навыков открывается и показывает список', async () => {
  const window = await loadPage('index.html');

  window.addNewSkill();
  window.openSkillsManager();

  const overlay = window.document.getElementById('skillsManagerOverlay');
  const rows = window.document.getElementById('skillsManagerList').children;
  const stored = JSON.parse(window.localStorage.getItem('levelUpData'));

  assert.equal(overlay.style.display, 'flex');
  assert.equal(rows.length, stored.skills.length);
  assert.ok(rows.length >= 2, 'новый навык появился в списке');

  window.closeSkillsManager();
  assert.equal(overlay.style.display, 'none');
});

test('index.html: в сайдбаре нет пустых ссылок href="#"', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(html.includes('href="#"'), false);
});

/** Проходит первый уровень тренажёра: показанный ответ берём из DOM. */
function solveFirstNode(window, transform = (value) => value) {
  const node = window.document.querySelector('.skill-node[data-level="1"]');
  assert.ok(node, 'первый узел дерева создан');

  window.startTraining(node);
  const shown = window.document.getElementById('numberDisplay').textContent;
  window.document.getElementById('numberInput').value = transform(shown);
  window.checkAnswer();

  return { node, shown };
}

test('page2.html: прогресс сохраняется и опыт уходит в общие навыки', async () => {
  const window = await loadPage('page2.html');

  const { node } = solveFirstNode(window);

  assert.ok(node.classList.contains('completed'), 'узел отмечен пройденным');

  const saved = JSON.parse(window.localStorage.getItem('memoryTrainerData'));
  assert.deepEqual(saved.completedLevels, [1], 'пройденный уровень сохранён');
  assert.ok(saved.xp > 0, 'опыт сохранён сразу, а не только при переходе на новый уровень');

  const shared = JSON.parse(window.localStorage.getItem('levelUpData'));
  const skill = shared.skills[0];
  assert.ok(skill.level > 1 || skill.exp > 0, 'XP из тренажёра попал в общие навыки');
});

test('page2.html: слова засчитываются без учёта регистра', async () => {
  const window = await loadPage('page2.html');

  const node = window.document.querySelector('.skill-node[data-level="1"]');
  node.setAttribute('data-type', 'word');

  window.startTraining(node);
  const shown = window.document.getElementById('numberDisplay').textContent;
  window.document.getElementById('numberInput').value = shown.toLowerCase();
  window.checkAnswer();

  const feedback = window.document.getElementById('feedback').textContent;
  assert.equal(/Неправильно/.test(feedback), false, `ответ в нижнем регистре не засчитан: ${feedback}`);
  assert.ok(node.classList.contains('completed'));
});

test('page2.html: пройденные уровни восстанавливаются после перезагрузки', async () => {
  const first = await loadPage('page2.html');
  solveFirstNode(first);
  const snapshot = first.localStorage.getItem('memoryTrainerData');

  const second = await loadPage('page2.html');
  second.localStorage.setItem('memoryTrainerData', snapshot);
  second.document.getElementById('skillTree').innerHTML = '';
  second.document.dispatchEvent(new second.Event('DOMContentLoaded', { bubbles: true }));

  const completed = second.document.querySelectorAll('.skill-node.completed');
  assert.equal(completed.length, 1, 'пройденный уровень остаётся пройденным');
});

test('userinfo.html выводит имя пользователя без innerHTML (защита от XSS)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'userinfo.html'), 'utf8');
  assert.equal(/\.innerHTML\s*=/.test(html), false, 'innerHTML не используется для вывода данных');
  assert.ok(html.includes('textContent'));
});

test('login.html не сохраняет пароль в localStorage', () => {
  const html = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
  assert.equal(/localStorage\.setItem/.test(html), false);
  assert.ok(html.includes('/api/login'));
  assert.ok(html.includes('/api/register'));
});
