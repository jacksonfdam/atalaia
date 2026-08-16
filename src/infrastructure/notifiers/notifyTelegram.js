import axios from 'axios';
import logger from '../logger.js';
import { resolveTelegramConfig } from './telegramConfig.js';
import { shortVersion } from './shortVersion.js';

/**
 * Telegram alerts.
 *
 * HTML rather than MarkdownV2: CVE titles are full of underscores, brackets and
 * dots, and MarkdownV2 requires every one of them escaped — one missed
 * character and Telegram rejects the whole message. HTML needs three
 * substitutions and nothing else.
 *
 * Buttons are inline keyboards carrying `ack:CVE-…` / `resolve:CVE-…`, which is
 * what comes back to the webhook. Telegram caps callback data at 64 bytes; a
 * CVE id is far inside that.
 */

const TIMEOUT_MS = 10_000;

/** Telegram refuses anything over 4096 characters, and counts in UTF-16. */
const MESSAGE_LIMIT = 4096;

export function apiUrl(botToken, method) {
    return `https://api.telegram.org/bot${botToken}/${method}`;
}

/** The three characters HTML mode reserves. */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function truncate(text, limit) {
    const value = String(text ?? '');
    return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

const HEADER = {
    exploited: '🚨 <b>EXPLOITED VULNERABILITY</b>',
    critical: '🔴 <b>CRITICAL VULNERABILITY</b>',
    default: '⚠️ <b>New vulnerability</b>',
};

/**
 * @param {Vulnerability} vuln
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 * @returns {{ text: string, reply_markup?: object }}
 */
export function buildVulnerabilityMessage(vuln, correlation = {}) {
    const header = vuln.exploited
        ? HEADER.exploited
        : vuln.severity?.toUpperCase() === 'CRITICAL'
            ? HEADER.critical
            : HEADER.default;

    const lines = [header, '', `<b>${escapeHtml(vuln.title ?? vuln.cveId)}</b>`, ''];

    const cve = vuln.link
        ? `<a href="${escapeHtml(vuln.link)}">${escapeHtml(vuln.cveId ?? 'Advisory')}</a>`
        : escapeHtml(vuln.cveId ?? 'N/A');

    lines.push(`<b>CVE:</b> ${cve}`);
    lines.push(`<b>Severity:</b> ${escapeHtml(vuln.severity)} (${escapeHtml(vuln.cvssScore ?? 'N/A')})`);
    lines.push(`<b>Source:</b> ${escapeHtml(vuln.source)}`);

    const technologies = (vuln.affectedTechnologies ?? []).join(', ');
    if (technologies) lines.push(`<b>Technologies:</b> ${escapeHtml(technologies)}`);

    // The heading names the source: a model's paragraph and the advisory's own
    // words read alike, and only one of them is authoritative.
    const short = shortVersion(vuln);
    if (short) {
        lines.push(
            '',
            `<b>What this means:</b> <i>${escapeHtml(short.source)}</i>`,
            escapeHtml(truncate(short.text, 700))
        );
    }

    // What of ours it touches — the difference between "a CVE exists" and "a
    // CVE is in something you ship".
    const repositories = correlation.affectedRepositories ?? [];
    if (repositories.length > 0) {
        const names = repositories
            .slice(0, 5)
            .map(repo =>
                repo.url
                    ? `<a href="${escapeHtml(repo.url)}">${escapeHtml(repo.name)}</a>`
                    : escapeHtml(repo.name)
            )
            .join(', ');
        const rest = repositories.length > 5 ? ` and ${repositories.length - 5} more` : '';
        lines.push('', `<b>Affected repositories:</b> ${names}${rest}`);
    }

    const owners = correlation.owners ?? [];
    if (owners.length > 0) {
        lines.push(`<b>Owners:</b> ${escapeHtml(owners.map(o => o.name ?? o.email).join(', '))}`);
    }

    if (vuln.exploited) {
        lines.push('', '⚠️ <i>Known exploited — immediate action recommended</i>');
    }

    const message = { text: truncate(lines.join('\n'), MESSAGE_LIMIT) };

    if (vuln.cveId) {
        message.reply_markup = {
            inline_keyboard: [
                [
                    { text: '✅ Acknowledge', callback_data: `ack:${vuln.cveId}` },
                    { text: '🔒 Resolve', callback_data: `resolve:${vuln.cveId}` },
                ],
            ],
        };
    }

    return message;
}

/**
 * One Bot API call.
 *
 * Telegram answers 200 with ok:false for a rejected message, so the status line
 * alone would report a silent drop as a success — same trap as Slack's
 * chat.postMessage.
 */
export async function callTelegram(botToken, method, payload) {
    const { data } = await axios.post(apiUrl(botToken, method), payload, {
        timeout: TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        // Telegram's own reason lives in the body of a 4xx, so it is read
        // rather than thrown away by axios.
        validateStatus: () => true,
    });

    if (!data?.ok) {
        throw new Error(`Telegram rejected ${method}: ${data?.description ?? 'unknown error'}`);
    }

    return data.result;
}

/**
 * Send a message to one chat.
 *
 * @param {object} config Resolved Telegram configuration
 * @param {{ text: string, reply_markup?: object }} message
 * @param {string} [chatId] Overrides the configured destination
 */
export async function deliver(config, message, chatId) {
    const target = chatId ?? config.chatId;
    if (!target) throw new Error('No chat id to send to');

    return await callTelegram(config.botToken, 'sendMessage', {
        chat_id: target,
        parse_mode: 'HTML',
        // A dozen previews for a dozen advisories is noise, not context.
        link_preview_options: { is_disabled: true },
        ...message,
    });
}

/**
 * Send a vulnerability alert to Telegram.
 *
 * @param {Vulnerability} vuln
 * @param {boolean} _highlight Kept for the notifier signature; Telegram has no @channel
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 */
export async function notifyTelegram(vuln, _highlight = false, correlation = {}) {
    const config = await resolveTelegramConfig();

    if (!config.ready) {
        logger.debug({ cveId: vuln.cveId, reason: config.reason }, 'Telegram alert skipped');
        return;
    }

    const message = buildVulnerabilityMessage(vuln, correlation);

    try {
        await deliver(config, message);
        logger.info({ cveId: vuln.cveId }, 'Sent Telegram alert');
    } catch (err) {
        logger.error({ err, cveId: vuln.cveId }, 'Failed to send the Telegram message');
        return;
    }

    // And the people responsible, in their own chat, when asked for. Only those
    // who have started a conversation with the bot have a chat id at all.
    if (!config.notifyOwners) return;

    for (const owner of (correlation.owners ?? []).filter(o => o.telegram_chat_id)) {
        try {
            await deliver(config, message, owner.telegram_chat_id);
            logger.info({ cveId: vuln.cveId, owner: owner.email }, 'Sent Telegram DM to owner');
        } catch (err) {
            logger.warn({ err, owner: owner.email }, 'Could not message the owner on Telegram');
        }
    }
}

/**
 * Post a real message to the configured chat, so the console can prove the
 * token and the chat id belong together — the two ways this is set up wrong.
 *
 * @returns {Promise<{ ok: boolean, error?: string, chat?: string }>}
 */
export async function sendTelegramTestMessage() {
    const config = await resolveTelegramConfig();
    if (!config.ready) return { ok: false, error: config.reason ?? 'Telegram is not configured' };

    try {
        const result = await deliver(config, {
            text: '✅ <b>Atalaia is connected</b>\nVulnerability alerts will arrive in this chat.',
        });

        return { ok: true, chat: result?.chat?.title ?? result?.chat?.username ?? config.chatId };
    } catch (err) {
        logger.warn({ err }, 'Telegram test message failed');
        return { ok: false, error: err.message, hint: hintFor(err.message, config.chatId) };
    }
}

/**
 * What "chat not found" usually means, given what the chat id looks like.
 *
 * Telegram returns the same sentence whether the bot was never spoken to, was
 * never added to the group, or the id is simply wrong — and the shape of the id
 * is enough to tell which is likely.
 */
export function hintFor(message, chatId) {
    if (!/chat not found/i.test(message ?? '')) {
        if (/bot can't initiate conversation/i.test(message ?? '')) {
            return 'Send /start to the bot from that account first — a bot cannot open a conversation.';
        }
        return undefined;
    }

    const id = String(chatId ?? '').trim();

    if (id.startsWith('@')) {
        return `${id} works only for a public channel, and the bot has to be an administrator of it. For a person or a group, use the numeric id — message the bot and it replies with the chat's id.`;
    }

    if (id.startsWith('-100')) {
        return 'That is a group id, so the bot has to be a member of the group. Add it, then try again.';
    }

    if (/^-/.test(id)) {
        return 'A supergroup id starts with -100. Re-check it: message the bot in that group and it replies with the id to use.';
    }

    return 'For a private chat, send /start to the bot from that account first — Telegram reports a chat the bot has never spoken to as "not found". The bot answers with the id to paste here.';
}

export default notifyTelegram;
