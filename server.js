'use strict';

/**
 * Solo Leveling — HTTP-сервер.
 *
 * Отдаёт статические страницы приложения и предоставляет REST API
 * для регистрации/авторизации пользователей.
 *
 * Пароли никогда не хранятся и не передаются в открытом виде:
 * на диск попадает только bcrypt-хеш, а клиенту отдаётся объект
 * пользователя без поля passwordHash.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'users.json');
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

const USERNAME_RE = /^[A-Za-zА-Яа-яЁё0-9_.-]{3,32}$/u;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

const app = express();

// ---------------------------------------------------------------------------
// Работа с «базой» пользователей (JSON-файл)
// ---------------------------------------------------------------------------

/**
 * Читает пользователей из файла.
 * Устойчива к отсутствующему, пустому и повреждённому файлу —
 * раньше пустой users.json ронял сервер на JSON.parse('').
 */
function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8').trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];

    console.error(`Не удалось прочитать ${USERS_FILE}:`, error.message);
    return [];
  }
}

/** Атомарная запись: сначала во временный файл, затем rename. */
function writeUsers(users) {
  const tmpFile = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmpFile, USERS_FILE);
}

/** Публичное представление пользователя — без хеша пароля. */
function publicUser(user) {
  return { username: user.username, profile: user.profile, createdAt: user.createdAt };
}

function createProfile() {
  return { level: 1, xp: 0, skills: [] };
}

function findUser(users, username) {
  const normalized = String(username).toLowerCase();
  return users.find((user) => String(user.username).toLowerCase() === normalized);
}

/**
 * Проверяет тело запроса. Возвращает строку с ошибкой либо null.
 */
function validateCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!username || !password) {
    return 'Укажите логин и пароль.';
  }
  if (!USERNAME_RE.test(username)) {
    return 'Логин: 3–32 символа, буквы, цифры и символы _ . -';
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return `Пароль должен быть от ${MIN_PASSWORD_LENGTH} до ${MAX_PASSWORD_LENGTH} символов.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.disable('x-powered-by');

app.use(
  helmet({
    // Страницы подключают Tailwind/Font Awesome с CDN, а сам сайт может
    // открываться во встроенном превью — поэтому CSP и frameguard выключены.
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

app.use(express.json({ limit: '16kb' }));

app.use(
  session({
    name: 'sl.sid',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 дней
    },
  })
);

// Ограничение на попытки входа/регистрации: защита от перебора паролей.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Слишком много попыток. Повторите позже.' },
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function registerHandler(req, res, next) {
  try {
    const error = validateCredentials(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const username = req.body.username.trim();
    const users = readUsers();

    if (findUser(users, username)) {
      return res
        .status(409)
        .json({ success: false, message: 'Пользователь с таким логином уже существует.' });
    }

    const user = {
      username,
      passwordHash: await bcrypt.hash(req.body.password, BCRYPT_ROUNDS),
      profile: createProfile(),
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    writeUsers(users);

    req.session.username = user.username;
    return res.status(201).json({ success: true, message: 'Регистрация успешна', user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
}

async function loginHandler(req, res, next) {
  try {
    const error = validateCredentials(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const users = readUsers();
    const user = findUser(users, req.body.username.trim());

    // Одинаковый ответ для «нет пользователя» и «неверный пароль»,
    // чтобы нельзя было перебором узнать существующие логины.
    const ok = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль.' });
    }

    req.session.username = user.username;
    return res.json({ success: true, message: 'Вход выполнен', user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
}

app.post('/api/register', authLimiter, registerHandler);
app.post('/api/login', authLimiter, loginHandler);

app.get('/api/me', (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  const user = findUser(readUsers(), req.session.username);
  if (!user) {
    return req.session.destroy(() =>
      res.status(401).json({ success: false, message: 'Не авторизован' })
    );
  }

  return res.json({ success: true, user: publicUser(user) });
});

/** Сохранение игрового профиля (уровень, XP, навыки) авторизованного игрока. */
app.put('/api/me/profile', (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  const { level, xp, skills } = req.body ?? {};
  if (!Number.isFinite(level) || level < 1 || !Number.isFinite(xp) || xp < 0 || !Array.isArray(skills)) {
    return res.status(400).json({ success: false, message: 'Некорректный профиль.' });
  }

  const users = readUsers();
  const user = findUser(users, req.session.username);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  user.profile = { level, xp, skills: skills.slice(0, 200) };
  writeUsers(users);

  return res.json({ success: true, user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sl.sid');
    res.json({ success: true, message: 'Выход выполнен' });
  });
});

// Совместимость со старым клиентом: /register вёл себя как «войти или создать».
app.post('/register', authLimiter, (req, res, next) => {
  const exists = Boolean(findUser(readUsers(), req.body?.username ?? ''));
  return exists ? loginHandler(req, res, next) : registerHandler(req, res, next);
});

// ---------------------------------------------------------------------------
// Статика и обработка ошибок
// ---------------------------------------------------------------------------

app.use(express.static(__dirname, { extensions: ['html'] }));

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'Метод не найден' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Необработанная ошибка:', err);
  res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
  });
}

module.exports = app;
