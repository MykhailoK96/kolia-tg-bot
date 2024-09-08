const TelegramBot = require("node-telegram-bot-api");

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const token = "7357801251:AAFmyD_JSEblhbx1Y3x_RCrr18WBHmErCKo";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://kolia-tg-bot-default-rtdb.firebaseio.com/",
});

const db = admin.firestore();

const bot = new TelegramBot(token, { polling: true });

bot.setMyCommands([{ command: "/menu", description: "Менюшка" }]);

const userStates = {};

async function getAvailableBooks() {
  const booksRef = db.collection("books");
  const snapshot = await booksRef.where("isAvailable", "==", true).get();

  if (snapshot.empty) {
    return [];
  }

  let books = [];
  snapshot.forEach((doc) => {
    books.push({ id: doc.id, ...doc.data() });
  });

  return books;
}

async function bookBook(bookId, userId) {
  const bookRef = db.collection("books").doc(bookId);
  const doc = await bookRef.get();

  if (!doc.exists) {
    throw new Error("Книга не знайдена");
  }

  await bookRef.update({ isAvailable: false, bookedBy: userId });
}

async function getUserBooking(userId) {
  const booksRef = db.collection("books");
  const snapshot = await booksRef.where("bookedBy", "==", userId).get();

  if (snapshot.empty) {
    return null;
  }

  let booking = null;
  snapshot.forEach((doc) => {
    booking = { id: doc.id, ...doc.data() };
  });

  return booking;
}

async function cancelBooking(userId) {
  const booksRef = db.collection("books");
  const snapshot = await booksRef.where("bookedBy", "==", userId).get();

  if (snapshot.empty) {
    throw new Error("Немає активних бронювань");
  }

  let bookId = null;
  snapshot.forEach((doc) => {
    bookId = doc.id;
  });

  await booksRef.doc(bookId).update({
    isAvailable: true,
    bookedBy: admin.firestore.FieldValue.delete(),
  });
}

async function isBookAvailable(bookId) {
  const bookRef = db.collection("books").doc(bookId);
  const doc = await bookRef.get();

  if (!doc.exists) {
    throw new Error("Книга не знайдена");
  }

  return doc.data().isAvailable;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const response = {
    text: `
      Приветствую всех смотрящих, ну и тебе, ${msg.from.first_name}! 👋
      
      Тест функционала внизу. Работаем братья
    `,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Переглянути доступні книги", callback_data: "list_books" }],
        [{ text: "Забронювати книгу", callback_data: "book_book" }],
        [
          {
            text: "Переглянути своє бронювання",
            callback_data: "view_booking",
          },
        ],
        [{ text: "Відмінити бронювання", callback_data: "cancel_booking" }],
      ],
    },
  };
  bot.sendMessage(chatId, response.text, {
    reply_markup: response.reply_markup,
  });
});

bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;
  const response = {
    text: "Оберіть команду:",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Переглянути доступні книги", callback_data: "list_books" }],
        [{ text: "Забронювати книгу", callback_data: "book_book" }],
        [
          {
            text: "Переглянути своє бронювання",
            callback_data: "view_booking",
          },
        ],
        [{ text: "Відмінити бронювання", callback_data: "cancel_booking" }],
      ],
    },
  };
  bot.sendMessage(chatId, response.text, {
    reply_markup: response.reply_markup,
  });
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  switch (action) {
    case "list_books":
      const books = await getAvailableBooks();
      let response = "Доступні книги:\n\n";
      books.forEach((book) => {
        response += `${book.id}: ${book.author} - "${book.title}"  \n`;
      });
      if (books.length === 0) response = "Немає доступних книг для бронювання.";
      const res = {
        text: response,
        reply_markup: {
          inline_keyboard: [
            [{ text: "Забронювати книгу", callback_data: "book_book" }],
          ],
        },
      };
      bot.sendMessage(chatId, res.text, {
        reply_markup: res.reply_markup,
      });
      break;

    case "book_book":
      const userBooking = await getUserBooking(query.from.id);
      if (userBooking) {
        const res = {
          text: "У вас вже є заброньована книга.",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Відмінити бронювання",
                  callback_data: "cancel_booking",
                },
              ],
            ],
          },
        };
        bot.sendMessage(chatId, res.text, {
          reply_markup: res.reply_markup,
        });
      } else {
        userStates[chatId] = "waiting_for_book_id";
        bot.sendMessage(chatId, "Введіть номер книги для бронювання.");
      }
      break;

    case "view_booking":
      const booking = await getUserBooking(query.from.id);
      if (booking) {
        bot.sendMessage(
          chatId,
          `Ваша заброньована книга: ${booking.title} - ${booking.author}`
        );
      } else {
        bot.sendMessage(chatId, "У вас немає заброньованих книг.");
      }
      break;

    case "cancel_booking":
      try {
        await cancelBooking(query.from.id);
        bot.sendMessage(chatId, "Ваше бронювання успішно відмінено.");
      } catch (error) {
        bot.sendMessage(
          chatId,
          `Помилка при відміні бронювання: ${error.message}`
        );
      }
      break;

    case "sosav":
      bot.sendMessage(chatId, "Хаха, признався, молодець");

      break;

    default:
      bot.sendMessage(
        chatId,
        "Невідома команда. Введіть /menu для перегляду доступних команд."
      );
      break;
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (userStates[chatId] === "waiting_for_book_id") {
    const bookId = text;
    try {
      const available = await isBookAvailable(bookId);
      if (!available) {
        const response = {
          text: "Старина, а нашо чужу книжку хочеш забронювати? Сосав?",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Да",
                  callback_data: "sosav",
                },
              ],
              [
                {
                  text: "Було діло",
                  callback_data: "sosav",
                },
              ],
              [
                {
                  text: "Ну да, і шо?",
                  callback_data: "sosav",
                },
              ],
            ],
          },
        };
        bot.sendMessage(
          chatId,
          response.text,
          {
            reply_markup: response.reply_markup,
          }
          //   "Старина, а нашо чужу книжку хочеш забронювати? Сосав?"
        );
        delete userStates[chatId];
        return;
      }

      await bookBook(bookId, msg.from.id);
      bot.sendMessage(
        chatId,
        `Книга з номером ${bookId} успішно заброньована.`
      );
    } catch (error) {
      bot.sendMessage(chatId, `Помилка при бронюванні книги: ${error.message}`);
    }
    delete userStates[chatId];
    return;
  }

  if (!["/start", "/menu"].includes(text)) {
    bot.sendMessage(chatId, "Невідома команда");
  }
});
