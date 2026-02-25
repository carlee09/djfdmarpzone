// Telegram Bot API 클라이언트

const API = (token) => `https://api.telegram.org/bot${token}`;

export async function sendMessage(token, chatId, text) {
  const ids = String(chatId).split(',').map(s => s.trim());
  return Promise.all(ids.map(id =>
    tgPost(token, 'sendMessage', { chat_id: id, text, parse_mode: 'HTML' })
  ));
}

// 인라인 버튼 포함 메시지 전송
export async function sendMessageWithButtons(token, chatId, text, buttons) {
  const ids = String(chatId).split(',').map(s => s.trim());
  return Promise.all(ids.map(id =>
    tgPost(token, 'sendMessage', {
      chat_id: id,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    })
  ));
}

// 버튼 클릭 응답 (로딩 스피너 해제)
export async function answerCallbackQuery(token, callbackQueryId, text = '') {
  return tgPost(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

// 기존 메시지 수정
export async function editMessage(token, chatId, messageId, text) {
  return tgPost(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  });
}

async function tgPost(token, method, body) {
  const res = await fetch(`${API(token)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Telegram ${method} error: ${err}`);
    return null;
  }
  return res.json();
}
