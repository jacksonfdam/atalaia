import crypto from 'node:crypto';

/**
 * A WebAuthn authenticator, in software.
 *
 * The tests need a real ceremony, not a stubbed one: a P-256 key pair, an
 * attestation object the library will parse, and assertions signed over the
 * bytes the specification says to sign. Anything less and the tests pass
 * against a verifier that does not work.
 *
 * What it deliberately cannot do is a browser. Conditional UI, the credential
 * picker and the platform prompt are not exercised here — those live in the
 * console and are checked by hand.
 */

/** Just enough CBOR to write an attestation object and a COSE key. */
function cborLength(major, length) {
    if (length < 24) return Buffer.from([(major << 5) | length]);

    if (length < 256) return Buffer.from([(major << 5) | 24, length]);

    if (length < 65536) {
        const out = Buffer.alloc(3);
        out[0] = (major << 5) | 25;
        out.writeUInt16BE(length, 1);
        return out;
    }

    const out = Buffer.alloc(5);
    out[0] = (major << 5) | 26;
    out.writeUInt32BE(length, 1);
    return out;
}

function cbor(value) {
    if (Buffer.isBuffer(value)) return Buffer.concat([cborLength(2, value.length), value]);

    if (typeof value === 'string') {
        const bytes = Buffer.from(value, 'utf8');
        return Buffer.concat([cborLength(3, bytes.length), bytes]);
    }

    if (typeof value === 'number') {
        return value >= 0 ? cborLength(0, value) : cborLength(1, -value - 1);
    }

    if (value instanceof Map) {
        const parts = [cborLength(5, value.size)];
        for (const [key, entry] of value) parts.push(cbor(key), cbor(entry));
        return Buffer.concat(parts);
    }

    const entries = Object.entries(value);
    const parts = [cborLength(5, entries.length)];
    for (const [key, entry] of entries) parts.push(cbor(key), cbor(entry));
    return Buffer.concat(parts);
}

/** The uncompressed EC point, as a COSE_Key map. */
function coseKey(publicKey) {
    const raw = publicKey.export({ format: 'jwk' });

    return cbor(
        new Map([
            [1, 2], // kty: EC2
            [3, -7], // alg: ES256
            [-1, 1], // crv: P-256
            [-2, Buffer.from(raw.x, 'base64url')],
            [-3, Buffer.from(raw.y, 'base64url')],
        ])
    );
}

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED_DATA = 0x40;

function authenticatorData({ rpId, flags, signCount, attested = null }) {
    const head = Buffer.concat([
        crypto.createHash('sha256').update(rpId).digest(),
        Buffer.from([flags]),
        (() => {
            const counter = Buffer.alloc(4);
            counter.writeUInt32BE(signCount);
            return counter;
        })(),
    ]);

    return attested ? Buffer.concat([head, attested]) : head;
}

function clientData({ type, challenge, origin }) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

/**
 * @param {object} [options]
 * @param {boolean} [options.syncedPasskey]  report a counter of zero forever,
 *   the way a platform authenticator does
 * @param {boolean} [options.userVerified]
 */
export function createAuthenticator({ syncedPasskey = true, userVerified = true } = {}) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

    const credentialId = crypto.randomBytes(32);
    const aaguid = Buffer.alloc(16);
    let signCount = 0;

    function flags(attested) {
        let value = FLAG_USER_PRESENT;
        if (userVerified) value |= FLAG_USER_VERIFIED;
        if (syncedPasskey) value |= FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;
        if (attested) value |= FLAG_ATTESTED_DATA;
        return value;
    }

    return {
        credentialId,

        /** The response a browser would post back from a registration ceremony. */
        register({ rpId, origin, challenge }) {
            const attested = Buffer.concat([
                aaguid,
                (() => {
                    const length = Buffer.alloc(2);
                    length.writeUInt16BE(credentialId.length);
                    return length;
                })(),
                credentialId,
                coseKey(publicKey),
            ]);

            const authData = authenticatorData({
                rpId,
                flags: flags(true),
                signCount: syncedPasskey ? 0 : ++signCount,
                attested,
            });

            const attestationObject = cbor(
                new Map([
                    ['fmt', 'none'],
                    ['attStmt', new Map()],
                    ['authData', authData],
                ])
            );

            const json = clientData({ type: 'webauthn.create', challenge, origin });

            return {
                id: credentialId.toString('base64url'),
                rawId: credentialId.toString('base64url'),
                type: 'public-key',
                clientExtensionResults: {},
                response: {
                    clientDataJSON: json.toString('base64url'),
                    attestationObject: attestationObject.toString('base64url'),
                    transports: ['internal'],
                },
            };
        },

        /**
         * @param {object} params
         * @param {number} [params.counter]  force a specific value, to test a
         *   counter that has gone backwards
         */
        authenticate({ rpId, origin, challenge, counter }) {
            if (counter !== undefined) signCount = counter;
            else if (!syncedPasskey) signCount += 1;

            const authData = authenticatorData({ rpId, flags: flags(false), signCount });
            const json = clientData({ type: 'webauthn.get', challenge, origin });

            const signature = crypto.sign(
                'sha256',
                Buffer.concat([authData, crypto.createHash('sha256').update(json).digest()]),
                privateKey
            );

            return {
                id: credentialId.toString('base64url'),
                rawId: credentialId.toString('base64url'),
                type: 'public-key',
                clientExtensionResults: {},
                response: {
                    clientDataJSON: json.toString('base64url'),
                    authenticatorData: authData.toString('base64url'),
                    signature: signature.toString('base64url'),
                    userHandle: null,
                },
            };
        },
    };
}
