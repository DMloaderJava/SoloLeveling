/**
 * Общее хранилище навыков и заданий.
 *
 * Раньше главная страница (index.html) и тренажёр памяти (page2.html)
 * писали в разные ключи localStorage, поэтому опыт из тренажёра
 * не попадал в навыки. Теперь обе страницы работают через этот модуль.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'levelUpData';
  const EXP_PER_LEVEL = 5;

  function generateId() {
    return global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : '_' + Math.random().toString(36).slice(2, 11);
  }

  function createDefaultSkill() {
    return {
      id: generateId(),
      name: 'Default Skill',
      level: 1,
      exp: 0,
      desc: 'Это дефолтный навык. Нажмите для прокачки.',
      default: true,
    };
  }

  /** Приводит данные к валидной структуре — защищает от битого localStorage. */
  function normalize(data) {
    const safe = data && typeof data === 'object' ? data : {};
    const skills = Array.isArray(safe.skills) ? safe.skills : [];
    const tasks = Array.isArray(safe.tasks) ? safe.tasks : [];

    if (!skills.some((skill) => skill && skill.default)) {
      skills.push(createDefaultSkill());
    }

    skills.forEach((skill) => {
      skill.id = skill.id || generateId();
      skill.level = Number.isFinite(skill.level) && skill.level >= 1 ? skill.level : 1;
      skill.exp = Number.isFinite(skill.exp) && skill.exp >= 0 ? skill.exp : 0;
    });

    return { skills, tasks };
  }

  function load() {
    try {
      return normalize(JSON.parse(global.localStorage.getItem(STORAGE_KEY)));
    } catch (error) {
      console.error('Не удалось прочитать сохранённые данные:', error);
      return normalize(null);
    }
  }

  function save(data) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Не удалось сохранить данные:', error);
    }
  }

  /**
   * Повышает уровень столько раз, сколько позволяет накопленный опыт.
   * Прежняя реализация использовала `if`, поэтому награда в 20 XP
   * давала только один уровень, а остаток опыта терялся.
   *
   * @returns {number} количество полученных уровней
   */
  function applyLevelUps(skill) {
    let gained = 0;
    while (skill.exp >= EXP_PER_LEVEL) {
      skill.exp -= EXP_PER_LEVEL;
      skill.level += 1;
      gained += 1;
    }
    return gained;
  }

  /**
   * Начисляет опыт навыку (по id, либо первому доступному) и сохраняет данные.
   * @returns {{skill: object, levelsGained: number}|null}
   */
  function awardXp(amount, skillId) {
    const xp = Number(amount);
    if (!Number.isFinite(xp) || xp <= 0) return null;

    const data = load();
    const skill = data.skills.find((item) => item.id === skillId) || data.skills[0];
    if (!skill) return null;

    skill.exp += xp;
    const levelsGained = applyLevelUps(skill);
    save(data);

    return { skill, levelsGained };
  }

  global.SkillsStore = {
    STORAGE_KEY,
    EXP_PER_LEVEL,
    generateId,
    createDefaultSkill,
    normalize,
    load,
    save,
    applyLevelUps,
    awardXp,
  };
})(window);
