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
5. Deploy qiling. Loglarda `Server 3000-portda ishga tushdi` va har 5 daqiqada `Self-ping muvaffaqiyatli` yozuvini ko'rasiz.

## 3. Barcha buyruqlar

| Buyruq | Kim ishlata oladi | Vazifasi |
|---|---|---|
| `/start` | hamma | Botni ishga tushirish, salomlashish |
| `/all` | faqat guruh adminlari | Bot eslab qolgan **barcha** a'zolarni tag qiladi |
| `/here` | faqat guruh adminlari | Faqat so'nggi **10 daqiqada** yozgan a'zolarni tag qiladi |
| `/call [sabab]` | faqat guruh adminlari | Har bir a'zoni o'zining shaxsiy stikeri (agar o'rnatgan bo'lsa) + ismi bilan chaqiradi. Sabab ixtiyoriy: `/call ertalabki majlis` kabi yozilsa, har bir xabarga qo'shiladi |
| `/somecall <ism/@username>` yoki xabarga reply | hamma | Bitta odamni aniq ism va username orqali chaqiradi |
| `/notag` | hamma | O'zini tag qilinishdan chiqaradi yoki qaytadan yoqadi (toggle) |
| `/setsticker` | hamma | Stikerga reply qilib yuborilsa, o'sha stikerni sizning "chaqiruv stikeri"ngiz qilib saqlaydi |
| `/stats` | hamma | Guruh bo'yicha statistika: jami eslab qolinganlar, so'nggi 10 daqiqada faollar, notag qilganlar, stikerli a'zolar soni |

### Muhim tafsilotlar

- **Cheklov:** Telegram Bot API guruhning to'liq a'zolar ro'yxatini bermaydi — bot faqat **guruhda haqiqatan yozgan** kishilarni "eslab qoladi". Bu Telegramning o'zi qo'ygan cheklov.
- **Cooldown:** `/all`, `/here`, `/call` — har birini bir guruhda faqat **1 daqiqada bir marta** ishlatish mumkin (spamning oldini olish uchun).
- **Shaffoflik:** `/call` stikerni ismi bilan birga yuboradi — kim kimni chaqirayotgani har doim ko'rinib turadi, "yashirin" chaqiriq yo'q.
- **`/setsticker` qanday ishlatiladi:** avval guruhga istalgan stikerni yuboring, keyin o'sha stiker xabariga **javob (reply)** qilib `/setsticker` deb yozing.
- **`/somecall` qanday ishlatiladi:** kimningdir xabariga reply qilib `/somecall` yozing, yoki `/somecall Ali` yoki `/somecall @username` kabi yozing.
- Ma'lumotlar (`users.json`) serverda saqlanadi; Render'da qayta deploy qilinganda tozalanishi mumkin.

## Keyingi qadamlar

Agar yana funksiyalar kerak bo'lsa (masalan `/all`ni hammaga ochish, xush kelibsiz xabari, admin sozlamalari), ayting — qo'shib beraman.