/**
 * The four ceremonies, without a database in the way.
 *
 * A P-256 authenticator written in software signs the responses, so these
 * exercise the verifier itself: what it accepts, and which of the things that
 * are supposed to be checked actually are.
 */
import { test, expect, describe, beforeEach, afterEach } from '@jest/globals';
import { createAuthenticator } from '../../helpers/authenticator.js';
import {
    buildRegistrationOptions,
    verifyRegistration,
    buildAuthenticationOptions,
    verifyAuthentication,
    fromBase64url,
    toBase64url,
} from '#app/infrastructure/auth/webauthn.js';

const RP = { rpId: 'localhost', origin: 'http://localhost:3001' };

const USER = {
    handle: Buffer.alloc(32, 7),
    username: 'jackson',
    display_name: 'Jackson',
};

let saved;

beforeEach(() => {
    saved = { ...process.env };
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_ORIGINS = 'http://localhost:3001';
    process.env.WEBAUTHN_RP_NAME = 'Atalaia Console';
    delete process.env.WEBAUTHN_REQUIRE_UV;
});

afterEach(() => {
    process.env = saved;
});

/** Register an authenticator and hand back the stored row it would produce. */
async function registered(authenticator = createAuthenticator()) {
    const options = await buildRegistrationOptions({ user: USER });
    const response = authenticator.register({ ...RP, challenge: options.challenge });

    const result = await verifyRegistration({ response, expectedChallenge: options.challenge });

    return {
        authenticator,
        result,
        stored: {
            credential_id: result.credential.credentialId,
            public_key: result.credential.publicKey,
            sign_count: result.credential.counter,
            transports: result.credential.transports,
        },
    };
}

describe('registration options', () => {
    test('ask for a discoverable credential, so signing in needs no username', async () => {
        const options = await buildRegistrationOptions({ user: USER });

        expect(options.rp.id).toBe('localhost');
        expect(options.rp.name).toBe('Atalaia Console');
        expect(options.authenticatorSelection.residentKey).toBe('required');
        expect(options.attestation).toBe('none');
        expect(options.pubKeyCredParams.map(p => p.alg)).toEqual([-7, -257]);
    });

    test('carry the handle, never the database id', async () => {
        const options = await buildRegistrationOptions({ user: USER });
        expect(fromBase64url(options.user.id)).toEqual(USER.handle);
    });

    test('exclude the credentials this account already has', async () => {
        const existing = { credential_id: Buffer.alloc(32, 3), transports: ['internal'] };
        const options = await buildRegistrationOptions({ user: USER, existingCredentials: [existing] });

        expect(options.excludeCredentials).toEqual([
            { id: toBase64url(existing.credential_id), transports: ['internal'], type: 'public-key' },
        ]);
    });

    test('require user verification only when the deployment asks for it', async () => {
        expect((await buildRegistrationOptions({ user: USER })).authenticatorSelection.userVerification).toBe(
            'preferred'
        );

        process.env.WEBAUTHN_REQUIRE_UV = 'true';
        expect((await buildRegistrationOptions({ user: USER })).authenticatorSelection.userVerification).toBe(
            'required'
        );
    });
});

describe('verifying a registration', () => {
    test('accepts an attestation from a real ceremony and keeps what matters', async () => {
        const { result } = await registered();

        expect(result.verified).toBe(true);
        expect(result.credential.publicKey.length).toBeGreaterThan(0);
        expect(result.credential.transports).toEqual(['internal']);
        // A platform passkey is synced, and says so.
        expect(result.credential.backupEligible).toBe(true);
        expect(result.credential.backupState).toBe(true);
    });

    test('leaves aaguid null when the authenticator declines to identify itself', async () => {
        const { result } = await registered();
        expect(result.credential.aaguid).toBeNull();
    });

    test('refuses a challenge it did not issue', async () => {
        const authenticator = createAuthenticator();
        const options = await buildRegistrationOptions({ user: USER });
        const response = authenticator.register({ ...RP, challenge: options.challenge });

        await expect(
            verifyRegistration({ response, expectedChallenge: 'c29tZXRoaW5nLWVsc2U' })
        ).rejects.toThrow();
    });

    test('refuses a ceremony from another origin', async () => {
        const authenticator = createAuthenticator();
        const options = await buildRegistrationOptions({ user: USER });
        const response = authenticator.register({
            ...RP,
            origin: 'http://localhost:4001',
            challenge: options.challenge,
        });

        await expect(
            verifyRegistration({ response, expectedChallenge: options.challenge })
        ).rejects.toThrow();
    });

    test('refuses a ceremony for another relying party', async () => {
        const authenticator = createAuthenticator();
        const options = await buildRegistrationOptions({ user: USER });
        const response = authenticator.register({
            ...RP,
            rpId: 'evil.example.com',
            challenge: options.challenge,
        });

        await expect(
            verifyRegistration({ response, expectedChallenge: options.challenge })
        ).rejects.toThrow();
    });
});

describe('authentication options', () => {
    test('name no credentials, so the flow works without a username and reveals nothing', async () => {
        const options = await buildAuthenticationOptions();

        expect(options.rpId).toBe('localhost');
        expect(options.allowCredentials).toEqual([]);
        expect(options.challenge).toEqual(expect.any(String));
    });

    test('hand out a different challenge every time', async () => {
        const first = await buildAuthenticationOptions();
        const second = await buildAuthenticationOptions();

        expect(first.challenge).not.toBe(second.challenge);
    });
});

describe('verifying an assertion', () => {
    test('accepts one signed by the credential that was registered', async () => {
        const { authenticator, stored } = await registered();
        const options = await buildAuthenticationOptions();

        const result = await verifyAuthentication({
            response: authenticator.authenticate({ ...RP, challenge: options.challenge }),
            expectedChallenge: options.challenge,
            credential: stored,
        });

        expect(result.verified).toBe(true);
        expect(result.backupState).toBe(true);
    });

    test('refuses one whose signature has been altered', async () => {
        const { authenticator, stored } = await registered();
        const options = await buildAuthenticationOptions();

        const response = authenticator.authenticate({ ...RP, challenge: options.challenge });
        const signature = Buffer.from(response.response.signature, 'base64url');
        signature[signature.length - 1] ^= 0xff;
        response.response.signature = signature.toString('base64url');

        const attempt = verifyAuthentication({
            response,
            expectedChallenge: options.challenge,
            credential: stored,
        });

        // Either answer is a refusal: a mangled DER signature throws where a
        // well-formed wrong one comes back unverified.
        await expect(attempt.then(r => r.verified).catch(() => false)).resolves.toBe(false);
    });

    test('refuses one signed by a different key', async () => {
        const { stored } = await registered();
        const stranger = createAuthenticator();
        const options = await buildAuthenticationOptions();

        const response = stranger.authenticate({ ...RP, challenge: options.challenge });
        // The stranger claims the registered credential's id, and cannot sign for it.
        response.id = toBase64url(stored.credential_id);
        response.rawId = response.id;

        const attempt = verifyAuthentication({
            response,
            expectedChallenge: options.challenge,
            credential: stored,
        });

        await expect(attempt.then(r => r.verified).catch(() => false)).resolves.toBe(false);
    });

    test('reports the counter it was given, for the caller to judge', async () => {
        const { authenticator, stored } = await registered(createAuthenticator({ syncedPasskey: false }));
        const options = await buildAuthenticationOptions();

        const result = await verifyAuthentication({
            response: authenticator.authenticate({ ...RP, challenge: options.challenge, counter: 42 }),
            expectedChallenge: options.challenge,
            // Zero, the way the route passes it: the counter rule is applied
            // against the stored value afterwards, not here.
            credential: { ...stored, sign_count: 0 },
        });

        expect(result.newCounter).toBe(42);
    });
});
