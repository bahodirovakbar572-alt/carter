const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'users.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('users.json o\'qishda xatolik:', err.message);
  }
  return {};
}

let data = loadData();
let saveTimer = null;

function saveData() {
  // Bir nechta chaqiruvni birlashtirib, disk yozishni kamaytiramiz
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), (err) => {
      if (err) console.error('users.json yozishda xatolik:', err.message);
    });
    saveTimer = null;
  }, 1000);
}

function ensureChat(chatId) {
  const chatKey = String(chatId);
  if (!data[chatKey]) data[chatKey] = {};
  return chatKey;
}

// Guruhda yozgan foydalanuvchini eslab qolish (va oxirgi faollik vaqtini yangilash)
function rememberUser(chatId, user) {
  if (!user || user.is_bot) return;
  const chatKey = ensureChat(chatId);
  const key = String(user.id);
  const existing = data[chatKey][key] || {};
  data[chatKey][key] = {
    id: user.id,
    first_name: user.first_name || existing.first_name || '',
    username: user.username || existing.username || null,
    lastSeen: Date.now(),
    optOut: existing.optOut || false,
    sticker: existing.sticker || null,
  };
  saveData();
}

// Shu chat uchun eslab qolingan barcha foydalanuvchilarni olish
function getUsers(chatId) {
  const chatKey = String(chatId);
  return data[chatKey] ? Object.values(data[chatKey]) : [];
}

// Faqat so'nggi X millisekund ichida yozganlarni olish
function getActiveUsers(chatId, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  return getUsers(chatId).filter((u) => u.lastSeen && u.lastSeen >= cutoff);
}

// Tag qilinishdan bosh tortish holatini almashtirish (toggle)
function toggleOptOut(chatId, userId) {
  const chatKey = ensureChat(chatId);
  const key = String(userId);
  if (!data[chatKey][key]) return null;
  data[chatKey][key].optOut = !data[chatKey][key].optOut;
  saveData();
  return data[chatKey][key].optOut;
}

// Foydalanuvchining shaxsiy "chaqiruv stikeri"ni saqlash
function setSticker(chatId, userId, fileId) {
  const chatKey = ensureChat(chatId);
  const key = String(userId);
  if (!data[chatKey][key]) return false;
  data[chatKey][key].sticker = fileId;
  saveData();
  return true;
}

// Shu chat uchun statistika
function getStats(chatId) {
  const users = getUsers(chatId);
  const optedOut = users.filter((u) => u.optOut).length;
  const activeLast10Min = getActiveUsers(chatId, 10 * 60 * 1000).length;
  const withSticker = users.filter((u) => u.sticker).length;
  return { total: users.length, optedOut, activeLast10Min, withSticker };
}

module.exports = {
  rememberUser,
  getUsers,
  getActiveUsers,
  toggleOptOut,
  setSticker,
  getStats,
};