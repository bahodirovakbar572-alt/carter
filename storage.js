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

// Guruhda yozgan foydalanuvchini eslab qolish
function rememberUser(chatId, user) {
  if (!user || user.is_bot) return;
  const chatKey = String(chatId);
  if (!data[chatKey]) data[chatKey] = {};
  data[chatKey][String(user.id)] = {
    id: user.id,
    first_name: user.first_name || '',
    username: user.username || null,
  };
  saveData();
}

// Shu chat uchun eslab qolingan barcha foydalanuvchilarni olish
function getUsers(chatId) {
  const chatKey = String(chatId);
  return data[chatKey] ? Object.values(data[chatKey]) : [];
}

module.exports = { rememberUser, getUsers };
