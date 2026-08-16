import { query, queryAll } from '../db/pool.js';
import logger from '../logger.js';

/**
 * Chats the bot has heard from.
 *
 * The chat id is the one piece of Telegram configuration nobody can look up:
 * it exists only after a conversation. Remembering whoever writes to the bot
 * turns "find your id with another bot" into "pick it from a list".
 */

/**
 * @param {object} chat Telegram's `chat` object
 */
export async function rememberChat(chat) {
    if (!chat?.id) return;

    // A private chat has a first name and no title; a group has a title. Either
    // way what the console shows is a name a human recognises.
    const title = chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || null);

    try {
        await query(
            `INSERT INTO telegram_chats (chat_id, type, title, username, first_seen_at, last_seen_at)
             VALUES (@chatId, @type, @title, @username, now(), now())
             ON CONFLICT (chat_id) DO UPDATE SET
                type = excluded.type,
                title = excluded.title,
                username = excluded.username,
                last_seen_at = now()`,
            {
                chatId: String(chat.id),
                type: chat.type ?? null,
                title,
                username: chat.username ?? null,
            }
        );
    } catch (err) {
        // Remembering is a convenience; failing to must not break a callback.
        logger.warn({ err, chatId: chat.id }, 'Could not remember the Telegram chat');
    }
}

/** Most recently heard from first — the one somebody just messaged is the one they want. */
export async function listChats(limit = 20) {
    return await queryAll(
        `SELECT chat_id, type, title, username, first_seen_at, last_seen_at
         FROM telegram_chats ORDER BY last_seen_at DESC LIMIT @limit`,
        { limit }
    );
}
