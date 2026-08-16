import crypto from 'node:crypto';
import express from 'express';
import logger from '../../infrastructure/logger.js';
import {
    buildRegistrationOptions,
    verifyRegistration,
    buildAuthenticationOptions,
    verifyAuthentication,
    fromBase64url,
} from '../../infrastructure/auth/webauthn.js';
import { issueChallenge, consumeChallenge } from '../../infrastructure/auth/challengeStore.js';
import {
    createUser,
    findUserById,
    findUserByUsername,
    addCredential,
    listCredentials,
    countCredentials,
    findCredentialWithUser,
    markCredentialUsed,
    deleteCredential,
    renameCredential,
    listUsers,
} from '../../infrastructure/auth/userStore.js';
import {
    createSession,
    revokeSession,
    revokeAllSessions,
    SCOPES,
} from '../../infrastructure/auth/sessionStore.js';
import {
    issueRecoveryCodes,
    consumeRecoveryCode,
    countUnusedRecoveryCodes,
} from '../../infrastructure/auth/recoveryCodes.js';
import { createInvite, consumeInvite, listInvites, revokeInvite } from '../../infrastructure/auth/inviteStore.js';
import { isBootstrapped, markBootstrapped } from '../../infrastructure/auth/authState.js';
import { AUTH_EVENTS, recordAuthEvent, clientIp } from '../../infrastructure/auth/auditLog.js';
import { attachSession, requireUser, requireFullSession, requireAdmin } from '../../middleware/session.js';
import { attempt, clearAttempts, tooManyAttempts } from '../../middleware/rateLimit.js';

/**
 * Sign-in, enrollment and account management.
 *
 * Mounted inside /api/v1, so every one of these already carries the API key:
 * the browser never reaches this service directly, it reaches the console,
 * which holds the key and the cookie. What these routes add is *who* — the API
 * key says which program is calling, a session says which person.
 *
 * Two rules run through the whole file.
 *
 *   A failed sign-in gives one answer. Unknown credential, bad signature,
 *   expired challenge and disabled account are the same status, the same body
 *   and, as far as it can be arranged, the same latency. Anything else is a
 *   way to ask this service which accounts exist.
 *
 *   Registration is never open. Before the first account it takes the setup
 *   password; after it, an invitation from an administrator.
 */

/** The one answer to a failed ceremony. */
const FAILED = { error: 'Authentication failed' };

/**
 * Hold every failed sign-in to the same floor.
 *
 * Rejecting an unknown credential costs one indexed lookup; rejecting a bad
 * signature costs a curve operation. Left alone, the difference is readable
 * from outside and tells an attacker which credential ids are real.
 */
const FAILURE_FLOOR_MS = 250;

async function padTo(startedAt) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= FAILURE_FLOOR_MS) return;
    await new Promise(resolve => setTimeout(resolve, FAILURE_FLOOR_MS - elapsed));
}

const QUARTER_HOUR = 15 * 60 * 1000;

/**
 * How often each thing may be tried.
 *
 * Bootstrap is the tightest: until the first account exists it is a password
 * prompt with no second factor, and it is the weakest surface in the system.
 * The rest are generous enough that nobody legitimate meets them.
 */
const LIMITS = {
    bootstrap: { max: 5, windowMs: QUARTER_HOUR },
    breakglass: { max: 5, windowMs: QUARTER_HOUR },
    recovery: { max: 5, windowMs: QUARTER_HOUR },
    assertion: { max: 15, windowMs: QUARTER_HOUR },
    invite: { max: 20, windowMs: QUARTER_HOUR },
    challenges: { max: 240, windowMs: 60 * 1000 },
};

/** The setup password, from either name. UI_PASSWORD is what existing installs have. */
function setupPassword() {
    return process.env.SETUP_PASSWORD || process.env.UI_PASSWORD || null;
}

function setupPasswordMatches(candidate) {
    const expected = setupPassword();
    if (!expected) return false;

    const a = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

function breakglassEnabled() {
    return process.env.AUTH_ALLOW_BREAKGLASS === 'true';
}

/** What the console is allowed to know about a credential. */
function publicCredential(row) {
    return {
        id: row.id,
        nickname: row.nickname,
        transports: row.transports ?? [],
        backedUp: row.backup_state,
        backupEligible: row.backup_eligible,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
    };
}

/**
 * The signature counter the authenticator reported, read straight from the
 * authenticator data: 32 bytes of rpIdHash, one of flags, then a big-endian
 * uint32.
 *
 * Read here rather than taken from the verification result because the counter
 * rule is ours to apply — see the note where it is used.
 */
function reportedCounter(response) {
    try {
        const data = fromBase64url(response?.response?.authenticatorData ?? '');
        if (data.length < 37) return null;
        return data.readUInt32BE(33);
    } catch {
        return null;
    }
}

/**
 * The user a registration ceremony is for.
 *
 * An account with no passkeys is an unfinished registration, not an account: if
 * a ceremony is abandoned the row stays behind, and the next attempt at the same
 * username picks it up rather than colliding with it. An account that does have
 * a passkey belongs to somebody, and the name is taken.
 */
async function userForRegistration({ username, displayName, isAdmin }) {
    const existing = await findUserByUsername(username);

    if (!existing) {
        return { user: await createUser({ username, displayName, isAdmin }) };
    }

    if ((await countCredentials(existing.id)) > 0) {
        return { conflict: true };
    }

    return { user: existing };
}

function normalizeUsername(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function createAuthRoutes() {
    const router = express.Router();

    router.use(attachSession);

    // ---------------------------------------------------------------- registration

    /**
     * Options for a registration ceremony, in one of four situations: an
     * authenticated user adding a passkey, the very first account, an invited
     * one, and break-glass. Which one applies is decided here, once, so the
     * verify step only has to trust the challenge it issued.
     */
    async function registrationOptions(req, res) {
        const bootstrapped = await isBootstrapped();
        const ip = clientIp(req);

        let user = null;
        let breakglass = false;

        if (req.user) {
            // Already signed in — including on a recovery session, which exists
            // for exactly this.
            user = await findUserById(req.user.id);
        } else if (!bootstrapped) {
            const allowed = attempt('bootstrap', LIMITS.bootstrap);
            if (!allowed.allowed) return tooManyAttempts(res, allowed.retryAfterSeconds);

            if (!setupPassword()) {
                return res.status(500).json({
                    error: 'No setup password is configured',
                    hint: 'Set SETUP_PASSWORD (or UI_PASSWORD) on the API service, then create the first account.',
                });
            }
            if (!setupPasswordMatches(req.body?.setupPassword)) {
                await recordAuthEvent({ event: AUTH_EVENTS.SIGN_IN_FAILED, ip, metadata: { stage: 'bootstrap' } });
                return res.status(401).json(FAILED);
            }

            const username = normalizeUsername(req.body?.username);
            const displayName = normalizeUsername(req.body?.displayName) || username;

            if (!username) return res.status(400).json({ error: 'A username is required' });

            const result = await userForRegistration({ username, displayName, isAdmin: true });
            if (result.conflict) return res.status(409).json({ error: 'That username is taken' });

            clearAttempts('bootstrap');
            user = result.user;
        } else if (req.body?.inviteToken) {
            const allowed = attempt('invite', LIMITS.invite);
            if (!allowed.allowed) return tooManyAttempts(res, allowed.retryAfterSeconds);

            const invite = await consumeInvite(req.body.inviteToken);
            if (!invite) {
                return res.status(401).json({ error: 'That invitation is not valid any more' });
            }

            const result = await userForRegistration({
                username: invite.username,
                displayName: invite.display_name,
                isAdmin: invite.is_admin,
            });
            if (result.conflict) return res.status(409).json({ error: 'That username is taken' });
            user = result.user;
        } else if (breakglassEnabled() && req.body?.setupPassword) {
            // The documented way back in when every passkey is gone and the
            // recovery codes went with them. Off unless somebody turned it on.
            const allowed = attempt('breakglass', LIMITS.breakglass);
            if (!allowed.allowed) return tooManyAttempts(res, allowed.retryAfterSeconds);

            if (!setupPasswordMatches(req.body.setupPassword)) {
                await recordAuthEvent({ event: AUTH_EVENTS.SIGN_IN_FAILED, ip, metadata: { stage: 'breakglass' } });
                return res.status(401).json(FAILED);
            }

            user = await findUserByUsername(normalizeUsername(req.body?.username));
            if (!user) return res.status(401).json(FAILED);
            breakglass = true;
        } else {
            return res.status(403).json({
                error: 'Registration is closed',
                hint: 'An administrator has to invite this account.',
            });
        }

        if (!user || user.disabled_at) return res.status(403).json({ error: 'Registration is closed' });

        if (breakglass) {
            await recordAuthEvent({
                userId: user.id,
                event: AUTH_EVENTS.BREAKGLASS_USED,
                ip,
                metadata: { username: user.username },
            });
            logger.warn(
                { username: user.username },
                'Break-glass registration used — the setup password enrolled a passkey'
            );
        }

        const options = await buildRegistrationOptions({
            user,
            existingCredentials: await listCredentials(user.id),
        });

        await issueChallenge({
            challenge: options.challenge,
            ceremony: 'registration',
            userId: user.id,
        });

        res.json(options);
    }

    router.post('/registration/options', registrationOptions);

    router.post('/registration/verify', async (req, res) => {
        const ip = clientIp(req);
        const response = req.body?.response ?? req.body;

        const claim = await consumeChallenge({
            challenge: challengeFrom(response),
            ceremony: 'registration',
        });

        if (!claim?.user_id) return res.status(401).json(FAILED);

        const user = await findUserById(claim.user_id);
        if (!user || user.disabled_at) return res.status(401).json(FAILED);

        let verification;
        try {
            verification = await verifyRegistration({
                response,
                expectedChallenge: challengeFrom(response),
            });
        } catch (err) {
            logger.warn({ err: err.message }, 'Registration verification failed');
            return res.status(401).json(FAILED);
        }

        if (!verification.verified) return res.status(401).json(FAILED);

        const first = (await countCredentials(user.id)) === 0;

        const stored = await addCredential({
            userId: user.id,
            credential: verification.credential,
            nickname: typeof req.body?.nickname === 'string' ? req.body.nickname.slice(0, 60) : null,
        });

        await recordAuthEvent({
            userId: user.id,
            event: AUTH_EVENTS.REGISTERED,
            ip,
            metadata: { credentialId: stored.id, first },
        });

        // The first passkey on an account is the moment recovery codes matter:
        // from here on this credential is the only way in.
        let recoveryCodes = null;
        if (first) {
            recoveryCodes = await issueRecoveryCodes(user.id);
            await recordAuthEvent({ userId: user.id, event: AUTH_EVENTS.RECOVERY_ISSUED, ip });
        }

        if (!(await isBootstrapped())) {
            await markBootstrapped();
            await recordAuthEvent({ userId: user.id, event: AUTH_EVENTS.BOOTSTRAPPED, ip });
        }

        // A fresh session, always. Enrolling from a recovery session upgrades to
        // a full one, which is the whole point of the recovery flow.
        const { token, session } = await createSession({
            userId: user.id,
            userAgent: req.headers['user-agent'],
        });

        res.json({
            verified: true,
            token,
            expiresAt: session.expires_at,
            user: publicUser(user),
            credential: publicCredential(stored),
            recoveryCodes,
        });
    });

    // -------------------------------------------------------------- authentication

    router.post('/authentication/options', async (_req, res) => {
        // Not about guessing — nothing is guessed here. It stops an unattended
        // loop filling the challenge table faster than the sweep empties it.
        const allowed = attempt('challenges', LIMITS.challenges);
        if (!allowed.allowed) return tooManyAttempts(res, allowed.retryAfterSeconds);

        const options = await buildAuthenticationOptions();
        await issueChallenge({ challenge: options.challenge, ceremony: 'authentication' });
        res.json(options);
    });

    router.post('/authentication/verify', async (req, res) => {
        const startedAt = Date.now();
        const ip = clientIp(req);
        const response = req.body?.response ?? req.body;

        const fail = async (metadata = {}, userId = null) => {
            await recordAuthEvent({ userId, event: AUTH_EVENTS.SIGN_IN_FAILED, ip, metadata });
            await padTo(startedAt);
            return res.status(401).json(FAILED);
        };

        const claim = await consumeChallenge({
            challenge: challengeFrom(response),
            ceremony: 'authentication',
        });
        if (!claim) return fail({ reason: 'challenge' });

        if (typeof response?.id !== 'string') return fail({ reason: 'malformed' });

        const credential = await findCredentialWithUser(fromBase64url(response.id));
        if (!credential || credential.disabled_at) return fail({ reason: 'unknown-credential' });

        // Keyed by credential rather than by account: an attacker who cannot
        // produce a signature cannot get here at all, and one who can is
        // holding the key. This bounds a grinding attempt against one of them.
        const allowed = attempt(`assertion:${credential.id}`, LIMITS.assertion);
        if (!allowed.allowed) return tooManyAttempts(res, allowed.retryAfterSeconds);

        let verification;
        try {
            verification = await verifyAuthentication({
                response,
                expectedChallenge: challengeFrom(response),
                // Zero, deliberately. The library would throw on a regressed
                // counter, and a thrown error is indistinguishable from a bad
                // signature — which would leave the audit unable to say a clone
                // was seen. The rule is applied below instead, with the real
                // stored value and an entry of its own.
                credential: { ...credential, sign_count: 0 },
            });
        } catch (err) {
            logger.warn({ err: err.message }, 'Assertion verification failed');
            return fail({ reason: 'signature' }, credential.user_id);
        }

        if (!verification.verified) return fail({ reason: 'signature' }, credential.user_id);

        const stored = Number(credential.sign_count);
        const reported = verification.newCounter ?? reportedCounter(response) ?? 0;

        // A counter that has not moved is normal for a synced passkey, which
        // reports zero forever. A counter that has *gone backwards* on an
        // authenticator that was counting means two copies of the same private
        // key are in circulation.
        if (stored > 0 && reported <= stored) {
            await recordAuthEvent({
                userId: credential.user_id,
                event: AUTH_EVENTS.COUNTER_REGRESSED,
                ip,
                metadata: { stored, reported, credentialId: credential.id },
            });
            logger.error(
                { username: credential.username, stored, reported },
                'Signature counter went backwards — the authenticator may have been cloned'
            );
            await padTo(startedAt);
            return res.status(401).json(FAILED);
        }

        await markCredentialUsed({
            id: credential.id,
            counter: reported,
            backupState: verification.backupState,
            backupEligible: verification.backupEligible,
        });

        const { token, session } = await createSession({
            userId: credential.user_id,
            userAgent: req.headers['user-agent'],
        });

        clearAttempts(`assertion:${credential.id}`);

        await recordAuthEvent({
            userId: credential.user_id,
            event: AUTH_EVENTS.SIGNED_IN,
            ip,
            metadata: { credentialId: credential.id },
        });

        res.json({
            verified: true,
            token,
            expiresAt: session.expires_at,
            user: {
                id: credential.user_id,
                username: credential.username,
                displayName: credential.display_name,
                isAdmin: credential.is_admin,
            },
        });
    });

    // ---------------------------------------------------------------------- session

    router.post('/logout', async (req, res) => {
        const token = req.headers['x-session-token'];
        const revoked = await revokeSession(typeof token === 'string' ? token : '');

        if (revoked && req.user) {
            await recordAuthEvent({ userId: req.user.id, event: AUTH_EVENTS.SIGNED_OUT, ip: clientIp(req) });
        }

        res.json({ authenticated: false });
    });

    router.get('/me', requireUser, async (req, res) => {
        const credentials = await listCredentials(req.user.id);

        res.json({
            user: req.user,
            scope: req.session.scope,
            expiresAt: req.session.expiresAt,
            credentialCount: credentials.length,
            recoveryCodesRemaining: await countUnusedRecoveryCodes(req.user.id),
        });
    });

    /**
     * Whether an account exists at all, for the console's sign-in screen.
     *
     * Says nothing about *which* accounts: before bootstrap it is the setup
     * form, after it the passkey prompt.
     */
    router.get('/state', async (_req, res) => {
        res.json({
            bootstrapped: await isBootstrapped(),
            setupPasswordConfigured: Boolean(setupPassword()),
            breakglassEnabled: breakglassEnabled(),
        });
    });

    // ------------------------------------------------------------------ credentials

    router.get('/credentials', requireUser, async (req, res) => {
        const credentials = await listCredentials(req.user.id);
        res.json({ credentials: credentials.map(publicCredential) });
    });

    // Enrolling an additional passkey is the same ceremony; the handler already
    // recognises a signed-in caller.
    router.post('/credentials', requireUser, registrationOptions);

    router.patch('/credentials/:id', requireFullSession, async (req, res) => {
        const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.slice(0, 60) : null;
        const updated = await renameCredential({ id: req.params.id, userId: req.user.id, nickname });

        if (!updated) return res.status(404).json({ error: 'No such passkey' });
        res.json({ credential: publicCredential(updated) });
    });

    router.delete('/credentials/:id', requireFullSession, async (req, res) => {
        // Deleting the last one would lock the account out of everything except
        // a recovery code, without ever saying so.
        if ((await countCredentials(req.user.id)) <= 1) {
            return res.status(409).json({
                error: 'This is the only passkey on the account',
                hint: 'Enroll another one first.',
            });
        }

        const deleted = await deleteCredential({ id: req.params.id, userId: req.user.id });
        if (!deleted) return res.status(404).json({ error: 'No such passkey' });

        await recordAuthEvent({
            userId: req.user.id,
            event: AUTH_EVENTS.CREDENTIAL_DELETED,
            ip: clientIp(req),
            metadata: { credentialId: req.params.id },
        });

        res.json({ deleted: true });
    });

    // --------------------------------------------------------------------- recovery

    router.post('/recovery/verify', async (req, res) => {
        const startedAt = Date.now();
        const ip = clientIp(req);
        const claimed = normalizeUsername(req.body?.username).toLowerCase();

        // Keyed by the name that was claimed, whether or not it exists — an
        // unknown one must cost the same as a known one, including this.
        const allowed = attempt(`recovery:${claimed}`, LIMITS.recovery);
        if (!allowed.allowed) return tooManyAttempts(res, allowed.retryAfterSeconds);

        const user = await findUserByUsername(normalizeUsername(req.body?.username));
        const accepted = user && !user.disabled_at
            ? await consumeRecoveryCode(user.id, req.body?.code)
            : false;

        if (!accepted) {
            await recordAuthEvent({
                userId: user?.id ?? null,
                event: AUTH_EVENTS.SIGN_IN_FAILED,
                ip,
                metadata: { stage: 'recovery' },
            });
            await padTo(startedAt);
            return res.status(401).json(FAILED);
        }

        // Scoped: this session enrolls a passkey and does nothing else, so a
        // recovery code cannot quietly become a working login.
        const { token, session } = await createSession({
            userId: user.id,
            scope: SCOPES.RECOVERY,
            userAgent: req.headers['user-agent'],
        });

        clearAttempts(`recovery:${claimed}`);
        await recordAuthEvent({ userId: user.id, event: AUTH_EVENTS.RECOVERY_USED, ip });

        res.json({
            verified: true,
            token,
            scope: session.scope,
            expiresAt: session.expires_at,
            user: publicUser(user),
            remaining: await countUnusedRecoveryCodes(user.id),
        });
    });

    router.post('/recovery/codes', requireFullSession, async (req, res) => {
        const codes = await issueRecoveryCodes(req.user.id);
        await recordAuthEvent({ userId: req.user.id, event: AUTH_EVENTS.RECOVERY_ISSUED, ip: clientIp(req) });

        res.json({ codes });
    });

    // ------------------------------------------------------------------------ users

    router.get('/users', requireAdmin, async (_req, res) => {
        res.json({ users: await listUsers() });
    });

    router.post('/invites', requireAdmin, async (req, res) => {
        const username = normalizeUsername(req.body?.username);
        const displayName = normalizeUsername(req.body?.displayName) || username;

        if (!username) return res.status(400).json({ error: 'A username is required' });

        const existing = await findUserByUsername(username);
        if (existing && (await countCredentials(existing.id)) > 0) {
            return res.status(409).json({ error: 'That username is taken' });
        }

        const { token, invite } = await createInvite({
            username,
            displayName,
            isAdmin: req.body?.isAdmin === true,
            invitedBy: req.user.id,
        });

        await recordAuthEvent({
            userId: req.user.id,
            event: AUTH_EVENTS.INVITED,
            ip: clientIp(req),
            metadata: { username },
        });

        // The token is returned once, to the administrator who created it, to
        // pass on however they pass things on. It is not stored in the clear.
        res.status(201).json({ invite, token });
    });

    router.get('/invites', requireAdmin, async (_req, res) => {
        res.json({ invites: await listInvites() });
    });

    router.delete('/invites/:id', requireAdmin, async (req, res) => {
        const revoked = await revokeInvite(req.params.id);
        if (!revoked) return res.status(404).json({ error: 'No such invitation' });
        res.json({ revoked: true });
    });

    /**
     * Take every passkey off an account and end its sessions.
     *
     * For the case the recovery codes exist for and cannot cover: a laptop that
     * is not coming back. The account keeps its history and its recovery codes
     * are reissued in the same breath, because otherwise this is just a lockout.
     */
    router.post('/users/:id/reset', requireAdmin, async (req, res) => {
        const user = await findUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'No such user' });

        const credentials = await listCredentials(user.id);
        for (const credential of credentials) {
            await deleteCredential({ id: credential.id, userId: user.id });
        }

        await revokeAllSessions(user.id);
        const codes = await issueRecoveryCodes(user.id);

        await recordAuthEvent({
            userId: user.id,
            event: AUTH_EVENTS.CREDENTIAL_DELETED,
            ip: clientIp(req),
            metadata: { reset: true, by: req.user.id, removed: credentials.length },
        });
        await recordAuthEvent({ userId: user.id, event: AUTH_EVENTS.RECOVERY_ISSUED, ip: clientIp(req) });

        res.json({ removed: credentials.length, codes });
    });

    return router;
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        isAdmin: user.is_admin,
    };
}

/**
 * The challenge the browser says it signed.
 *
 * Taken from clientDataJSON rather than trusted from anywhere else, and only
 * ever used to look up a row that must exist, be unconsumed and be unexpired —
 * so a forged value finds nothing. The library re-checks it against the same
 * string during verification.
 */
function challengeFrom(response) {
    return decodeChallenge(response?.response?.clientDataJSON);
}

function decodeChallenge(clientDataJSON) {
    if (typeof clientDataJSON !== 'string') return null;

    try {
        const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
        return typeof parsed.challenge === 'string' ? parsed.challenge : null;
    } catch {
        return null;
    }
}
