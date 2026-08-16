import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { webauthnConfig } from './webauthnConfig.js';

/**
 * The four WebAuthn ceremonies, and the only place this codebase talks to
 * @simplewebauthn/server.
 *
 * Routes call these. Nothing else imports the library, so the expectations that
 * make a ceremony safe — the origin allow-list, the rpID, the algorithms we
 * accept — are stated once instead of once per endpoint, where one of them
 * would eventually be forgotten.
 *
 * Persisting the challenge is not this module's job: it hands one out and
 * verifies the one it is given. The store decides what "issued exactly once"
 * means. See challengeStore.js.
 */

/** The database keeps credential ids as bytes; the protocol speaks base64url. */
export function toBase64url(bytes) {
    return Buffer.from(bytes).toString('base64url');
}

export function fromBase64url(value) {
    return Buffer.from(value, 'base64url');
}

/**
 * @typedef {object} StoredCredential
 * @property {Buffer} credential_id
 * @property {Buffer} public_key
 * @property {number} sign_count
 * @property {string[]} transports
 */

/**
 * @param {object} params
 * @param {{handle: Buffer, username: string, display_name: string}} params.user
 * @param {StoredCredential[]} [params.existingCredentials]
 * @returns {Promise<import('@simplewebauthn/server').PublicKeyCredentialCreationOptionsJSON>}
 */
export async function buildRegistrationOptions({ user, existingCredentials = [] }) {
    const { rpID, rpName, requireUserVerification } = webauthnConfig();

    return await generateRegistrationOptions({
        rpID,
        rpName,
        // The handle, never the database id. It is what the authenticator
        // stores and shows back at us, and a primary key that leaked into a
        // credential could never be changed afterwards.
        userID: Uint8Array.from(user.handle),
        userName: user.username,
        userDisplayName: user.display_name,
        attestationType: 'none',
        authenticatorSelection: {
            // Discoverable, so signing in needs no username typed first.
            residentKey: 'required',
            userVerification: requireUserVerification ? 'required' : 'preferred',
        },
        // ES256 and RS256. Everything in circulation does one of the two.
        supportedAlgorithmIDs: [-7, -257],
        // Stops an authenticator that already holds a credential for this
        // account from silently registering a second one.
        excludeCredentials: existingCredentials.map(credential => ({
            id: toBase64url(credential.credential_id),
            transports: credential.transports ?? undefined,
        })),
    });
}

/**
 * @param {object} params
 * @param {object} params.response  attestation response from the browser
 * @param {string} params.expectedChallenge  base64url, as issued
 * @returns {Promise<{verified: boolean, credential?: object}>}
 */
export async function verifyRegistration({ response, expectedChallenge }) {
    const { rpID, origins, requireUserVerification } = webauthnConfig();

    const result = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification,
    });

    if (!result.verified) return { verified: false };

    const info = result.registrationInfo;

    return {
        verified: true,
        credential: {
            credentialId: Buffer.from(fromBase64url(info.credential.id)),
            publicKey: Buffer.from(info.credential.publicKey),
            counter: info.credential.counter,
            transports: info.credential.transports ?? [],
            // 'aaguid' is all zeroes when the authenticator declines to say what
            // it is, which is the norm with attestationType 'none'.
            aaguid: info.aaguid && info.aaguid !== '00000000-0000-0000-0000-000000000000'
                ? info.aaguid
                : null,
            backupEligible: info.credentialDeviceType === 'multiDevice',
            backupState: info.credentialBackedUp,
        },
    };
}

/**
 * Options for a sign-in.
 *
 * allowCredentials stays empty on purpose. Naming the credentials up front
 * would mean knowing who is signing in before they have proved anything — which
 * both tells an unauthenticated caller whether an account exists, and rules out
 * the usernameless flow the whole design rests on.
 *
 * @returns {Promise<import('@simplewebauthn/server').PublicKeyCredentialRequestOptionsJSON>}
 */
export async function buildAuthenticationOptions() {
    const { rpID, requireUserVerification } = webauthnConfig();

    return await generateAuthenticationOptions({
        rpID,
        allowCredentials: [],
        userVerification: requireUserVerification ? 'required' : 'preferred',
    });
}

/**
 * @param {object} params
 * @param {object} params.response  assertion response from the browser
 * @param {string} params.expectedChallenge  base64url, as issued
 * @param {StoredCredential} params.credential  the row matching response.id
 * @returns {Promise<{verified: boolean, newCounter?: number, backupState?: boolean,
 *                    backupEligible?: boolean}>}
 */
export async function verifyAuthentication({ response, expectedChallenge, credential }) {
    const { rpID, origins, requireUserVerification } = webauthnConfig();

    const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification,
        credential: {
            id: toBase64url(credential.credential_id),
            publicKey: Uint8Array.from(credential.public_key),
            counter: Number(credential.sign_count),
            transports: credential.transports ?? undefined,
        },
    });

    if (!result.verified) return { verified: false };

    return {
        verified: true,
        newCounter: result.authenticationInfo.newCounter,
        backupState: result.authenticationInfo.credentialBackedUp,
        backupEligible: result.authenticationInfo.credentialDeviceType === 'multiDevice',
    };
}
