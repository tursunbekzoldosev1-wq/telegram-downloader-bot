const TelegramBot = require('node-telegram-bot-api');

// Токен бота будет считываться из безопасных переменных среды хостинга
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Критическая ошибка: Токен TELEGRAM_BOT_TOKEN не установлен в настройках сервера!");
  process.exit(1);
}

// Запускаем бота в режиме Long Polling (для бесплатного круглосуточного сервера)
const bot = new TelegramBot(token, { polling: true });

// Список бесплатных рабочих серверов Cobalt API (без водяных знаков)
const COBALT_ENDPOINTS = [
  "https://api.cobalt.tools/api/json",
  "https://co.wuk.sh/api/json"
];

console.log("🚀 Бот успешно запущен в облаке и слушает сообщения 24/7...");

// Функция определения платформы по ссылке
function getPlatform(url) {
  const norm = url.toLowerCase();
  if (norm.includes("tiktok.com")) return "TikTok";
  if (norm.includes("instagram.com") || norm.includes("instagr.am")) return "Instagram";
  if (norm.includes("youtube.com") || norm.includes("youtu.be")) return "YouTube";
  if (norm.includes("spotify.com")) return "Spotify";
  return "Unknown";
}

// Сервис для скачивания Spotify в формате MP3
async function downloadSpotify(url) {
  const trackIdMatch = url.match(/track\/([a-zA-Z0-9]+)/);
  if (!trackIdMatch) {
    throw new Error("Неверная ссылка Spotify. Поддерживаются только прямые треки формата /track/ID");
  }
  const trackId = trackIdMatch[1];
  const response = await fetch(`https://api.spotifydown.com/download/${trackId}`, {
    method: "GET",
    headers: {
      "Origin": "https://spotifydown.com",
      "Referer": "https://spotifydown.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  if (!response.ok) throw new Error("Сервер раздачи Spotify занят");
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Ошибка парсинга Spotify");
  return {
    url: data.link,
    title: `${data.metadata?.artists || 'Unknown'} - ${data.metadata?.title || 'Track'}`
  };
}

// Универсальный метод скачивания с Cobalt API (видео/аудио)
async function downloadWithCobalt(url, isAudioOnly = false) {
  let lastError = "";
  for (const endpoint of COBALT_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          url: url,
          vQuality: "720",
          isAudioOnly: isAudioOnly,
          isNoTTWatermark: true,
          filenamePattern: "pretty"
        })
      });

      if (!response.ok) continue;
      const data = await response.json();
      if (data.status === "error") {
        lastError = data.text;
        continue;
      }
      return data;
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError || "Все зеркала Cobalt сейчас перегружены, попробуйте позже.");
}

// Обработка текстовых команд бота
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : "";

  if (!text) return;

  // Ответ на команду /start и приветствие
  if (text.startsWith('/start') || text.startsWith('/help')) {
    const userName = msg.from?.first_name || 'друг';
    return bot.sendMessage(chatId, 
      `👋 *Привет, ${userName}!* Я умный бот для скачивания медиа без водяных знаков! 🚀\n\n` +
      `*Я поддерживаю:* \n` +
      `• *TikTok* (видео, слайдшоу, музыка)\n` +
      `• *Instagram* (Insta reels, посты с фото/видео)\n` +
      `• *YouTube* (видео и аудио)\n` +
      `• *Spotify* (скачивание треков прямо в MP3 форматы!)\n\n` +
      `🤖 *Как пользоваться:* Просто пришли мне ссылку на нужное медиа, я автоматически его подготовлю!`, 
      { parse_mode: "Markdown" }
    );
  }

  // Извлечение URL
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const match = text.match(urlRegex);

  if (!match) {
    return bot.sendMessage(chatId, "❌ Пожалуйста, пришлите корректную ссылку на контент.");
  }

  const url = match[1];
  const platform = getPlatform(url);

  // Оповещаем пользователя, что процесс начался
  const processingMsg = await bot.sendMessage(chatId, `⏳ *Обрабатываю ссылку с ${platform}...* Пожалуйста, подождите.`);

  try {
    // Включение индикатора загрузки в Telegram («записывает видео» или «отправляет аудио»)
    const chatActionType = platform === "Spotify" ? "upload_voice" : "upload_video";
    bot.sendChatAction(chatId, chatActionType).catch(() => {});

    if (platform === "Spotify") {
      // Скачивание Spotify в MP3
      const result = await downloadSpotify(url);
      await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      
      await bot.sendAudio(chatId, result.url, {
        title: result.title,
        caption: `🎵 *${result.title}*\nСкачано без ограничений! 🚀`
      });
    } else {
      // Использование Cobalt для видео контента
      const data = await downloadWithCobalt(url);

      await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});

      if (data.status === "picker") {
        // Если это слайд-шоу картинок (например в TikTok)
        await bot.sendMessage(chatId, `📸 *Слайдшоу: "${data.text || 'Медиа'}"*\nОтправляю фотографии:`);
        for (const photo of data.picker) {
          await bot.sendPhoto(chatId, photo.url);
        }
      } else if (data.status === "audio" || data.url.includes("audio")) {
        // Аудиофайл (MP3)
        await bot.sendAudio(chatId, data.url, {
          caption: `🎵 *${data.text || 'Аудио без ватермарки'}*\n\nСкачано бесплатно в 24/7 боте!`
        });
      } else {
        // Видеофайл (TikTok/Insta/YT Reels)
        try {
          await bot.sendVideo(chatId, data.url, {
            caption: `📹 *${data.text || 'Видео без ватермарки'}*\n\nСкачано без логотипов! 🔥`
          });
        } catch (videoError) {
          // Если файл превышает ограничения Telegram (50МБ для ботов), выдаем прямую быструю ссылку
          await bot.sendMessage(chatId, `📹 *${data.text || 'Видео'}*\n\n⚠️ Файл слишком большой для отправки напрямую в чат. Вы можете скачать его напрямую по этой ссылке:\n👉 [Скачать файл](${data.url})`, { parse_mode: "Markdown" });
        }
      }
    }
  } catch (error) {
    console.error(error);
    await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, `❌ *Произошла ошибка при скачивании!*\n\nНе удалось получить медиа по этой ссылке.\n⚠️ _Причина: ${error.message || "Сервер временно недоступен"}_`, { parse_mode: "Markdown" });
  }
});
