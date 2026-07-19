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
const COOLDOWN_MS = 60 * 1000; // 1 daqiqa

function checkCooldown(chatId, command) {
  const key = `${chatId}:${command}`;
  const last = cooldowns.get(key) || 0;
  const now = Date.now();
  if (now - last < COOLDOWN_MS) {
    return Math.ceil((COOLDOWN_MS - (now - last)) / 1000); // qolgan soniya
  }
  cooldowns.set(key, now);
  return 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------- /start -------
bot.onText(/^\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Salom! Bot ishga tushdi ✅');
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

// ------- /notag — tag qilinishdan bosh tortish (toggle) -------
bot.onText(/^\/notag/, (msg) => {
  if (msg.chat.type === 'private') {
    return bot.sendMessage(msg.chat.id, 'Bu buyruq faqat guruhda ishlaydi.');
  }
  const optedOut = toggleOptOut(msg.chat.id, msg.from.id);
  if (optedOut === null) {
    return bot.sendMessage(
      msg.chat.id,
      'Avval guruhda birror xabar yozing, keyin bu buyruqni ishlating.'
    );
  }
  bot.sendMessage(
    msg.chat.id,
    optedOut
      ? `${mentionHtml(msg.from)}, endi sizni tag qilishmaydi.`
      : `${mentionHtml(msg.from)}, endi sizni yana tag qilish mumkin.`,
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
    `📊 Statistika:\n` +
      `Jami eslab qolingan: ${s.total}\n` +
      `So'nggi 10 daqiqada faol: ${s.activeLast10Min}\n` +
      `Tag qilinishdan bosh tortganlar: ${s.optedOut}\n` +
      `Stiker o'rnatganlar: ${s.withSticker}`
  );
});

// ------- /setsticker — o'z chaqiruv stikeringizni o'rnatish -------
bot.onText(/^\/setsticker/, (msg) => {
  if (msg.chat.type === 'private') {
    return bot.sendMessage(msg.chat.id, 'Bu buyruq faqat guruhda ishlaydi.');
  }
  if (!msg.reply_to_message || !msg.reply_to_message.sticker) {
    return bot.sendMessage(
      msg.chat.id,
      'Avval guruhga biror stiker yuboring, keyin o\'sha stikerga javob (reply) tariqasida /setsticker deb yozing.'
    );
  }
  const ok = setSticker(msg.chat.id, msg.from.id, msg.reply_to_message.sticker.file_id);
  if (!ok) {
    return bot.sendMessage(
      msg.chat.id,
      'Avval guruhda oddiy matnli xabar yozing, keyin qayta urinib ko\'ring.'
    );
  }
  bot.sendMessage(msg.chat.id, `${mentionHtml(msg.from)} uchun chaqiruv stikeri o'rnatildi ✅`, {
    parse_mode: 'HTML',
  });
});

// ------- /all va /here uchun stiker ostiga yashirincha tag qilish funksiyasi -------
async function sendStickerMentions(chatId, users) {
  if (users.length === 0) {
    return bot.sendMessage(chatId, 'Tag qilinadigan kishi yo\'q.');
  }

  // Standart stiker ID (Agar /setsticker ishlatilmagan bo'lsa shuni yuboradi)
  const DEFAULT_STICKER = "CAACAgIAAxkBAAEExxxxxx..."; 
  const INVISIBLE_CHAR = "‌"; // Nol kenglikdagi bo'shliq
  const CALL_GROUP_SIZE = 5;  // Har bir stikerga 5 tadan odam yashiriladi

  for (let i = 0; i < users.length; i += CALL_GROUP_SIZE) {
    const group = users.slice(i, i + CALL_GROUP_SIZE);
    
    let hiddenMentions = '';
    for (const user of group) {
      hiddenMentions += `<a href="tg://user?id=${user.id}">${INVISIBLE_CHAR}</a>`;
    }

    try {
      // Guruh yoki guruhdagi oxirgi foydalanuvchining shaxsiy stikeri borligini tekshirish mantig'i
      // Agar storage'da guruh uchun stiker saqlangan bo'lsa uni yuklash mumkin, hozircha defolt:
      await bot.sendSticker(chatId, DEFAULT_STICKER, {
        caption: hiddenMentions,
        parse_mode: 'HTML'
      });
      
      // Telegram spam filtri (FloodWait) ga tushmaslik uchun 1 soniya kutish
      if (i + CALL_GROUP_SIZE < users.length) {
        await sleep(1000);
      }
    } catch (err) {
      console.error('Stiker yuborishda xatolik:', err.message);
    }
  }
}

// ------- /all — hamma a'zolarni stiker ostiga yashirib chaqirish (faqat adminlar) -------
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
    return bot.sendMessage(chatId, `Iltimos, ${waitSec} soniyadan keyin qayta urinib ko'ring.`);
  }

  const users = getUsers(chatId).filter((u) => !u.optOut);
  await sendStickerMentions(chatId, users);
});

// ------- /here — faqat faollarni stiker ostiga yashirib chaqirish (faqat adminlar) -------
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
    return bot.sendMessage(chatId, `Iltimos, ${waitSec} soniyadan keyin qayta urinib ko'ring.`);
  }

  const users = getActiveUsers(chatId, 10 * 60 * 1000).filter((u) => !u.optOut);
  await sendStickerMentions(chatId, users);
});

// ------- /call — stiker yordamida ommaviy chaqiruv buyrug'i -------
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
    return bot.sendMessage(chatId, `Iltimos, ${waitSec} soniyadan keyin qayta urinib ko'ring.`);
  }

  const users = getUsers(chatId).filter((u) => !u.optOut);
  await sendStickerMentions(chatId, users);
});

// ------- /somecall — bitta odamni yashirincha stiker bilan chaqirish -------
bot.onText(/^\/somecall(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    return bot.sendMessage(chatId, 'Bu buyruq faqat guruhlarda ishlaydi.');
  }

  let target = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    const replyUser = msg.reply_to_message.from;
    target = getUsers(chatId).find((u) => u.id === replyUser.id);
  } else if (match && match[1]) {
    const query = match[1].trim().replace(/^@/, '').toLowerCase();
    const candidates = getUsers(chatId).filter(
      (u) =>
        (u.username && u.username.toLowerCase() === query) ||
        (u.first_name && u.first_name.toLowerCase().includes(query))
    );
    if (candidates.length > 1) {
      return bot.sendMessage(
        chatId,
        `Bir nechta mos kishi topildi, aniqroq yozing yoki xabarga javob (reply) qiling:\n` +
          candidates.map((u) => `- ${u.first_name}${u.username ? ' (@' + u.username + ')' : ''}`).join('\n')
      );
    }
    target = candidates[0];
  } else {
    return bot.sendMessage(
      chatId,
      'Foydalanish: kimningdir xabariga javob (reply) qilib /somecall yozing, yoki /somecall <ism yoki @username>'
    );
  }

  if (!target) {
    return bot.sendMessage(chatId, 'Bu foydalanuvchi topilmadi.');
  }
  if (target.optOut) {
    return bot.sendMessage(chatId, 'Bu foydalanuvchi tag qilinishdan bosh tortgan.');
  }

  const DEFAULT_STICKER = "CAACAgIAAxkBAAEExxxxxx...";
  const INVISIBLE_CHAR = "‌";
  
  try {
    // Agar foydalanuvchi o'ziga shaxsiy stiker o'rnatgan bo'lsa, o'shani ishlatamiz
    const userSticker = target.stickerId || DEFAULT_STICKER;
    
    await bot.sendSticker(chatId, userSticker, {
      caption: `<a href="tg://user?id=${target.id}">${INVISIBLE_CHAR}</a>`,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('somecall xatolik:', err.message);
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling xatosi:', err.message);
});

// ------- Express server -------
const app = express();

app.get('/', (req, res) => {
  res.send('Bot ishlayapti ✅ | ' + new Date().toISOString());
});

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});

// ------- Self-ping tizimi -------
const FIVE_MINUTES = 5 * 60 * 1000;

function selfPing() {
  if (!SELF_URL) {
    console.warn('SELF_URL berilmagan — self-ping o\'tkazib yuborildi.');
    return;
  }
  fetch(`${SELF_URL}/ping`)
    .then((res) => res.json())
    .then((data) => console.log('Self-ping muvaffaqiyatli:', data.time))
    .catch((err) => console.error('Self-ping xatosi:', err.message));
}

setInterval(selfPing, FIVE_MINUTES);
console.log('Self-ping tizimi ishga tushdi.');