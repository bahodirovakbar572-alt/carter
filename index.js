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

// Xabarlarni Telegram uzunlik chegarasiga (4096) qarab bo'lib yuborish
async function sendChunkedMentions(chatId, mentions, emptyText) {
  if (mentions.length === 0) {
    return bot.sendMessage(chatId, emptyText);
  }
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
      ? `${mentionHtml(msg.from)}, endi /all, /here va /call sizni tag qilmaydi.`
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
// Foydalanish: avval biror stikerni yuboring, o'sha xabarga javob (reply) qilib /setsticker deb yozing
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

// ------- /all — bot eslab qolgan barcha a'zolarni tag qilish (faqat adminlar) -------
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
  const mentions = users.map(mentionHtml);
  await sendChunkedMentions(chatId, mentions, 'Tag qilinadigan kishi yo\'q.');
});

// ------- /here — faqat so'nggi 10 daqiqada faol bo'lganlarni tag qilish (faqat adminlar) -------
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
  const mentions = users.map(mentionHtml);
  await sendChunkedMentions(chatId, mentions, 'So\'nggi 10 daqiqada hech kim yozmadi.');
});

// ------- /call [sabab] — bir nechta odamni bitta xabarda, sababi bilan birga chaqirish -------
// Masalan: /call ertalabki majlis boshlanadi
const CALL_GROUP_SIZE = 5; // bitta xabarda nechta odam tag qilinishi

bot.onText(/^\/call(?:\s+(.+))?/, async (msg, match) => {
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

  const reason = match && match[1] ? match[1].trim() : null;
  const reasonLine = reason ? `\n📝 ${escapeHtml(reason)}` : '';

  const users = getUsers(chatId).filter((u) => !u.optOut);
  if (users.length === 0) {
    return bot.sendMessage(chatId, 'Tag qilinadigan kishi yo\'q.');
  }

  // Har bir xabarda CALL_GROUP_SIZE tadan odam + sababi birga chiqadi
  for (let i = 0; i < users.length; i += CALL_GROUP_SIZE) {
    const group = users.slice(i, i + CALL_GROUP_SIZE);
    const mentions = group.map(mentionHtml).join(' ');
    await bot.sendMessage(chatId, `${mentions}${reasonLine}`, { parse_mode: 'HTML' });
    if (i + CALL_GROUP_SIZE < users.length) {
      await sleep(300); // Telegram limitiga tegib qolmaslik uchun kichik pauza
    }
  }
});

// ------- /somecall — bitta odamni ism/username orqali aniq chaqirish -------
// Foydalanish: shu odamning xabariga javob (reply) qilib /somecall yozing,
// yoki /somecall <ism yoki @username>
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
    return bot.sendMessage(chatId, 'Bu foydalanuvchi topilmadi (u hali guruhda yozmagan bo\'lishi mumkin).');
  }
  if (target.optOut) {
    return bot.sendMessage(chatId, 'Bu foydalanuvchi tag qilinishdan bosh tortgan.');
  }

  const usernamePart = target.username ? ` (@${escapeHtml(target.username)})` : '';
  await bot.sendMessage(chatId, `📣 ${mentionHtml(target)}${usernamePart}`, { parse_mode: 'HTML' });
});

bot.on('polling_error', (err) => {
  console.error('Polling xatosi:', err.message);
});

// ------- Express server (Render "port ochiq" bo'lishini talab qiladi) -------
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