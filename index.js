require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const {
  rememberUser,
  getUsers,
  getActiveUsers,
  toggleOptOut,
  setSticker,
  getStats,
} = require('./storage');

// ------- Sozlamalar (.env fayldan olinadi) -------
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;

if (!BOT_TOKEN) {
  console.error('XATOLIK: BOT_TOKEN topilmadi. .env faylga BOT_TOKEN qo\'shing.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ------- Yordamchi funksiyalar -------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mentionHtml(user) {
  return `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name || 'user')}</a>`;
}

async function isAdmin(chatId, userId) {
  try {
    const admins = await bot.getChatAdministrators(chatId);
    return admins.some((a) => a.user.id === userId);
  } catch (err) {
    console.error('Admin tekshirishda xatolik:', err.message);
    return false;
  }
}

// Har bir chat + buyruq uchun cooldown (spamning oldini olish)
const cooldowns = new Map();
const COOLDOWN_MS = 10 * 1000; // Sinov uchun 10 soniyaga tushirildi

function checkCooldown(chatId, command) {
  const key = `${chatId}:${command}`;
  const last = cooldowns.get(key) || 0;
  const now = Date.now();
  if (now - last < COOLDOWN_MS) {
    return Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
  }
  cooldowns.set(key, now);
  return 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------- /start -------
bot.onText(/^\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Salom! Bot ishga tushdi va guruhlarni kuzatishga tayyor ✅');
});

// ------- Har bir guruh xabarini kuzatib, yuboruvchini eslab qolish -------
bot.on('message', (msg) => {
  if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && msg.from) {
    rememberUser(msg.chat.id, msg.from);
  }
});

// ------- Shaxsiy chatda oddiy echo -------
bot.on('message', (msg) => {
  if (msg.chat.type === 'private' && msg.text && !msg.text.startsWith('/')) {
    bot.sendMessage(msg.chat.id, `Siz yozdingiz: ${msg.text}`);
  }
});

// ------- /notag — tag qilinishdan bosh tortish -------
bot.onText(/^\/notag/, (msg) => {
  if (msg.chat.type === 'private') {
    return bot.sendMessage(msg.chat.id, 'Bu buyruq faqat guruhda ishlaydi.');
  }
  const optedOut = toggleOptOut(msg.chat.id, msg.from.id);
  if (optedOut === null) {
    return bot.sendMessage(msg.chat.id, 'Avval guruhda biror xabar yozing.');
  }
  bot.sendMessage(
    msg.chat.id,
    optedOut
      ? `${mentionHtml(msg.from)}, endi sizni ommaviy chaqirishganda notif bormaydi.`
      : `${mentionHtml(msg.from)}, siz yana ro'yxatga qo'shildingiz.`,
    { parse_mode: 'HTML' }
  );
});

// ------- /stats — statistika -------
bot.onText(/^\/stats/, (msg) => {
  if (msg.chat.type === 'private') {
    return bot.sendMessage(msg.chat.id, 'Bu buyruq faqat guruhda ishlaydi.');
  }
  const s = getStats(msg.chat.id);
  bot.sendMessage(
    msg.chat.id,
    `📊 Guruh statistikasi:\n` +
      `Jami eslab qolingan faollar: ${s.total}\n` +
      `So'nggi 10 daqiqada faol: ${s.activeLast10Min}\n` +
      `Chaqirilishni istamaganlar: ${s.optedOut}`
  );
});

// ------- Rasmli/Yashirin chaqiruv funksiyasi (Asosiy Logika) -------
async function sendHiddenMentions(chatId, users) {
  if (users.length === 0) {
    return bot.sendMessage(chatId, 'Tag qilinadigan kishi yo\'q.');
  }

  // Bu ochiq internetdagi 1x1 pikselli butunlay shaffof (transparent) rasm linki.
  // Guruhda deyarli sezilmaydi, lekin ostiga HTML yashirishga yordam beradi.
  // Agar xohlasangiz, istalgan boshqa rasm URL manzilini qo'yishingiz mumkin.
  const TRANSPARENT_PHOTO = "https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png"; 
  const INVISIBLE_CHAR = "‌"; // Nol kenglikdagi ko'rinmas bo'shliq simvoli
  const CALL_GROUP_SIZE = 5;  // Telegram limitidan oshmaslik uchun 5 tadan bo'lib tag qilamiz

  for (let i = 0; i < users.length; i += CALL_GROUP_SIZE) {
    const group = users.slice(i, i + CALL_GROUP_SIZE);
    
    let hiddenMentions = '';
    for (const user of group) {
      hiddenMentions += `<a href="tg://user?id=${user.id}">${INVISIBLE_CHAR}</a>`;
    }

    try {
      // sendPhoto funksiyasi tarkibida caption va HTML formati 100% ishlaydi
      await bot.sendPhoto(chatId, TRANSPARENT_PHOTO, {
        caption: hiddenMentions,
        parse_mode: 'HTML'
      });
      
      // Spam-filtr (FloodWait) cheklovini aylanib o'tish
      if (i + CALL_GROUP_SIZE < users.length) {
        await sleep(1000);
      }
    } catch (err) {
      console.error('Chaqiruv xabari yuborishda xatolik:', err.message);
    }
  }
}

// ------- /all — Hamma a'zolarni yashirincha chaqirish (Adminlar uchun) -------
bot.onText(/^\/all/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return bot.sendMessage(chatId, 'Bu buyruq faqat guruhlarda ishlaydi.');
  }
  if (!(await isAdmin(chatId, msg.from.id))) {
    return bot.sendMessage(chatId, 'Bu buyruqni faqat guruh adminlari ishlata oladi.');
  }
  const waitSec = checkCooldown(chatId, 'all');
  if (waitSec > 0) {
    return bot.sendMessage(chatId, `Sekinroq yozing! ${waitSec} soniyadan keyin qayta urining.`);
  }

  const users = getUsers(chatId).filter((u) => !u.optOut);
  await sendHiddenMentions(chatId, users);
});

// ------- /here — Faol a'zolarni yashirincha chaqirish (Adminlar uchun) -------
bot.onText(/^\/here/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return bot.sendMessage(chatId, 'Bu buyruq faqat guruhlarda ishlaydi.');
  }
  if (!(await isAdmin(chatId, msg.from.id))) {
    return bot.sendMessage(chatId, 'Bu buyruqni faqat guruh adminlari ishlata oladi.');
  }
  const waitSec = checkCooldown(chatId, 'here');
  if (waitSec > 0) {
    return bot.sendMessage(chatId, `Sekinroq yozing! ${waitSec} soniyadan keyin qayta urining.`);
  }

  const users = getActiveUsers(chatId, 10 * 60 * 1000).filter((u) => !u.optOut);
  await sendHiddenMentions(chatId, users);
});

// ------- /call — Standart ommaviy chaqiruv buyrug'i -------
bot.onText(/^\/call/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return bot.sendMessage(chatId, 'Bu buyruq faqat guruhlarda ishlaydi.');
  }
  if (!(await isAdmin(chatId, msg.from.id))) {
    return bot.sendMessage(chatId, 'Bu buyruqni faqat guruh adminlari ishlata oladi.');
  }
  const waitSec = checkCooldown(chatId, 'call');
  if (waitSec > 0) {
    return bot.sendMessage(chatId, `Iltimos, ${waitSec} soniya kuting.`);
  }

  const users = getUsers(chatId).filter((u) => !u.optOut);
  await sendHiddenMentions(chatId, users);
});

bot.on('polling_error', (err) => {
  console.error('Polling xatosi:', err.message);
});

// ------- Express server -------
const app = express();

app.get('/', (req, res) => {
  res.send('Bot status: OK ✅');
});

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ------- Self-ping tizimi -------
const FIVE_MINUTES = 5 * 60 * 1000;
function selfPing() {
  if (!SELF_URL) return;
  fetch(`${SELF_URL}/ping`)
    .then((res) => res.json())
    .catch((err) => console.error('Self-ping error:', err.message));
}
setInterval(selfPing, FIVE_MINUTES);