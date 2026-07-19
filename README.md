# Telegram Bot (Node.js) — Render uchun self-ping bilan

Bu bot Express serverga ega (Render "portni tinglash" talab qiladi) va o'zini "uxlab qolishdan" saqlash uchun har 5 daqiqada o'ziga so'rov yuboradi.

## 1. Lokal sozlash

```bash
npm install
cp .env.example .env
```

`.env` faylni oching va:
- `BOT_TOKEN` — @BotFather'dan olingan tokenni qo'ying
- `SELF_URL` — lokal test uchun bo'sh qoldirsangiz ham bo'ladi

Ishga tushirish:

```bash
npm start
```

## 2. Render'ga joylash (deploy)

1. Loyihani GitHub'ga yuklang.
2. [render.com](https://render.com) da **New +** → **Web Service** tanlang, repo'ni ulang.
3. Sozlamalar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Environment** bo'limida quyidagini qo'shing:
   - `BOT_TOKEN` = sizning tokeningiz
   - (RENDER_EXTERNAL_URL Render tomonidan avtomatik beriladi, qo'shimcha qo'shish shart emas)
5. Deploy qiling. Loglarda `Server 3000-portda ishga tushdi` va har 5 daqiqada `Self-ping muvaffaqiyatli` yozuvini ko'rasiz.

## 3. Botni sinash

Telegram'da botingizni toping, `/start` yuboring — javob qaytishi kerak. Shaxsiy chatda istalgan matn yuborsangiz, bot uni qaytarib beradi (echo).

## 4. `/all` — guruh a'zolarini tag qilish

- Botni guruhga qo'shing.
- Bot faqat **guruhda yozgan** foydalanuvchilarni "eslab qoladi" (Telegram Bot API to'liq a'zolar ro'yxatini avtomatik bermaydi — bu cheklov, aylanib o'tib bo'lmaydi).
- Guruh **adminlaridan biri** `/all` yozsa, bot eslab qolingan barcha a'zolarni tag qiladi.
- Oddiy a'zolar `/all` yozsa, bot rad etadi — bu spamning oldini olish uchun qilingan.
- Eslab qolingan foydalanuvchilar `users.json` faylida saqlanadi (Render'da deploy qilinganda bu fayl serverni qayta ishga tushirgunga qadar saqlanadi).

## Keyingi qadamlar

Agar botga qo'shimcha funksiyalar (masalan `/all` ni hammaga ochiq qilish, reklama xabarlarini avtomatik yuborish, buyruqlar ro'yxati, inline tugmalar) kerak bo'lsa, ayting — qo'shib beraman.
# carter
