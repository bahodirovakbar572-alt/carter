require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const { rememberUser, getUsers } = require('./storage');

// ------- Sozlamalar (.env fayldan olinadi) -------
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
// Render sizga avtomatik shu o'zgaruvchini beradi (masalan: https://my-bot.onrender.com)
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;

if (!BOT_TOKEN) {
  console.error('XATOLIK: BOT_TOKEN topilmadi. .env faylga BOT_TOKEN qo\'shing.');
  process.exit(1);
}

// ------- Telegram bot (polling rejimida) -------
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Salom! Bot ishga tushdi ✅');
});

// Guruhda yozgan har bir foydalanuvchini eslab qolamiz (keyin /all uchun kerak bo'ladi)
bot.on('message', (msg) => {
  if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && msg.from) {
    rememberUser(msg.chat.id, msg.from);
  }
});

// Oddiy echo — faqat shaxsiy chatda (guruhda spam bo'lmasligi uchun)
bot.on('message', (msg) => {
  if (msg.chat.type === 'private' && msg.text && !msg.text.startsWith('/')) {
    bot.sendMessage(msg.chat.id, `Siz yozdingiz: ${msg.text}`);
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// /all — guruhda bot "ko'rgan" (yozgan) barcha a'zolarni tag qiladi.
// Faqat guruh adminlari ishlata oladi — spamning oldini olish uchun.
bot.onText(/^\/all/, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return bot.sendMessage(chatId, 'Bu buyruq faqat guruhlarda ishlaydi.');
  }

  try {
    const admins = await bot.getChatAdministrators(chatId);
    const isAdmin = admins.some((a) => a.user.id === msg.from.id);
    if (!isAdmin) {
      return bot.sendMessage(chatId, 'Bu buyruqni faqat guruh adminlari ishlata oladi.');
    }
  } catch (err) {
    console.error('Admin tekshirishda xatolik:', err.message);
    return bot.sendMessage(chatId, 'Adminlarni tekshirib bo\'lmadi, birozdan so\'ng qayta urinib ko\'ring.');
  }

  const users = getUsers(chatId);
  if (users.length === 0) {
    return bot.sendMessage(chatId, 'Hozircha hech kim yozmagan, tag qiladigan kishi yo\'q.');
  }

  const mentions = users.map(
    (u) => `<a href="tg://user?id=${u.id}">${escapeHtml(u.first_name || 'user')}</a>`
  );

  // Telegram xabar uzunligi cheklovi (4096 belgi) — kerak bo'lsa bo'lib yuboramiz
  const CHUNK_LIMIT = 3800;
  let chunk = '';
  for (const mention of mentions) {
    if ((chunk + ' ' + mention).length > CHUNK_LIMIT) {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      chunk = '';
    }
    chunk += (chunk ? ' ' : '') + mention;
  }
  if (chunk) {
    await bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling xatosi:', err.message);
});

// ------- Express server (Render "port ochiq" bo'lishini talab qiladi) -------
const app = express();

app.get('/', (req, res) => {
  res.send('Bot ishlayapti ✅ | ' + new Date().toISOString());
});

// Self-ping shu manzilga uriladi — bot "uxlab qolmasligi" uchun
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});

// ------- O'z-o'ziga har 5 daqiqada so'rov (self-ping) -------
const FIVE_MINUTES = 5 * 60 * 1000;

function selfPing() {
  if (!SELF_URL) {
    console.warn('SELF_URL/RENDER_EXTERNAL_URL berilmagan — self-ping o\'tkazib yuborildi.');
    return;
  }
  fetch(`${SELF_URL}/ping`)
    .then((res) => res.json())
    .then((data) => console.log('Self-ping muvaffaqiyatli:', data.time))
    .catch((err) => console.error('Self-ping xatosi:', err.message));
}

setInterval(selfPing, FIVE_MINUTES);
console.log('Self-ping tizimi ishga tushdi: har 5 daqiqada so\'rov yuboriladi.');
