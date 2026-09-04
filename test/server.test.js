'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Изолированное хранилище: тесты не должны трогать реальный users.json.
const tmpUsersFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-')), 'users.json');
process.env.USERS_FILE = tmpUsersFile;
process.env.SESSION_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';

const app = require('../server.js');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server?.close();
  fs.rmSync(path.dirname(tmpUsersFile), { recursive: true, force: true });
});

function api(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

test('пустой users.json не роняет сервер', async () => {
  fs.writeFileSync(tmpUsersFile, '');
  const res = await api('/api/me');
  assert.equal(res.status, 401);
});

test('регистрация создаёт пользователя и не возвращает пароль', async () => {
  const res = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'hunter', password: 'secret123' }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.user.username, 'hunter');
  assert.equal(body.user.password, undefined);
  assert.equal(body.user.passwordHash, undefined);
});

test('пароль хранится только в виде хеша', () => {
  const stored = JSON.parse(fs.readFileSync(tmpUsersFile, 'utf8'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].password, undefined);
  assert.match(stored[0].passwordHash, /^\$2[aby]\$/);
});

test('повторная регистрация того же логина отклоняется', async () => {
  const res = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'hunter', password: 'secret123' }),
  });
  assert.equal(res.status, 409);
});

test('слабые данные не проходят валидацию', async () => {
  const short = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'ab', password: 'secret123' }),
  });
  const weak = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'valid_user', password: '123' }),
  });
  const empty = await api('/api/register', { method: 'POST', body: JSON.stringify({}) });

  assert.equal(short.status, 400);
  assert.equal(weak.status, 400);
  assert.equal(empty.status, 400);
});

test('вход с неверным паролем возвращает 401', async () => {
  const res = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'hunter', password: 'wrong-password' }),
  });
  assert.equal(res.status, 401);
});

test('вход выдаёт сессию, /api/me её читает, /api/logout закрывает', async () => {
  const login = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'hunter', password: 'secret123' }),
  });
  assert.equal(login.status, 200);

  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.match(cookie, /sl\.sid=/);

  const me = await api('/api/me', { headers: { cookie } });
  const meBody = await me.json();
  assert.equal(me.status, 200);
  assert.equal(meBody.user.username, 'hunter');

  const logout = await api('/api/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logout.status, 200);

  const after = await api('/api/me', { headers: { cookie } });
  assert.equal(after.status, 401);
});

test('профиль сохраняется только авторизованному пользователю', async () => {
  const anon = await api('/api/me/profile', {
    method: 'PUT',
    body: JSON.stringify({ level: 2, xp: 10, skills: [] }),
  });
  assert.equal(anon.status, 401);

  const login = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'hunter', password: 'secret123' }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  const saved = await api('/api/me/profile', {
    method: 'PUT',
    headers: { cookie },
    body: JSON.stringify({ level: 3, xp: 42, skills: ['Память'] }),
  });
  const body = await saved.json();
  assert.equal(saved.status, 200);
  assert.deepEqual(body.user.profile, { level: 3, xp: 42, skills: ['Память'] });

  const bad = await api('/api/me/profile', {
    method: 'PUT',
    headers: { cookie },
    body: JSON.stringify({ level: 0, xp: -5, skills: 'нет' }),
  });
  assert.equal(bad.status, 400);
});

test('несуществующий метод API отдаёт JSON 404', async () => {
  const res = await api('/api/unknown');
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.success, false);
});
