/**
 * Supported email providers.
 *
 * All of them are reached over SMTP through nodemailer rather than through six
 * different REST SDKs: every provider here offers SMTP, the credentials are the
 * same ones their API uses, and one transport means one code path to keep
 * working. What differs between them — host, port, and what they call the
 * username — lives in these descriptors.
 *
 * @typedef {object} ProviderField
 * @property {string} name      Config key it fills
 * @property {string} label
 * @property {boolean} [secret] Stored encrypted, never returned
 * @property {boolean} [required]
 * @property {string} [placeholder]
 * @property {string} [help]
 *
 * @typedef {object} ProviderDescriptor
 * @property {string} id
 * @property {string} label
 * @property {string} docsUrl
 * @property {{ host?: string, port?: number, username?: string }} defaults
 * @property {ProviderField[]} fields
 * @property {string} [note]
 */

const SECRET = { name: 'secret', secret: true, required: true };

/** @type {ProviderDescriptor[]} */
export const EMAIL_PROVIDERS = [
    {
        id: 'mailtrap',
        label: 'Mailtrap',
        docsUrl: 'https://help.mailtrap.io/article/12-getting-started-guide',
        defaults: { host: 'sandbox.smtp.mailtrap.io', port: 2525 },
        note: 'The sandbox host captures mail instead of delivering it. Switch the host to live.smtp.mailtrap.io to send for real.',
        fields: [
            { name: 'host', label: 'SMTP host', required: true, placeholder: 'sandbox.smtp.mailtrap.io' },
            { name: 'port', label: 'Port', required: true, placeholder: '2525' },
            { name: 'username', label: 'Username', required: true },
            { ...SECRET, label: 'Password' },
        ],
    },
    {
        id: 'mailjet',
        label: 'Mailjet',
        docsUrl: 'https://dev.mailjet.com/smtp-relay/configuration/',
        defaults: { host: 'in-v3.mailjet.com', port: 587 },
        fields: [
            { name: 'username', label: 'API key', required: true, help: 'Mailjet uses the API key as the SMTP username.' },
            { ...SECRET, label: 'Secret key' },
        ],
    },
    {
        id: 'sendgrid',
        label: 'SendGrid',
        docsUrl: 'https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api',
        defaults: { host: 'smtp.sendgrid.net', port: 587, username: 'apikey' },
        note: 'The username is the literal string "apikey"; the API key goes in the password.',
        fields: [{ ...SECRET, label: 'API key', placeholder: 'SG.…' }],
    },
    {
        id: 'mailgun',
        label: 'Mailgun',
        docsUrl: 'https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/#smtp',
        defaults: { host: 'smtp.mailgun.org', port: 587 },
        note: 'EU accounts send through smtp.eu.mailgun.org.',
        fields: [
            { name: 'host', label: 'SMTP host', required: true, placeholder: 'smtp.mailgun.org' },
            { name: 'username', label: 'SMTP login', required: true, placeholder: 'postmaster@mg.example.com' },
            { ...SECRET, label: 'SMTP password' },
        ],
    },
    {
        id: 'mailerlite',
        label: 'MailerLite',
        docsUrl: 'https://www.mailerlite.com/help/how-to-use-mailerlite-smtp',
        defaults: { host: 'smtp.mailerlite.com', port: 587 },
        fields: [
            { name: 'username', label: 'Username', required: true },
            { ...SECRET, label: 'Password' },
        ],
    },
    {
        id: 'resend',
        label: 'Resend',
        docsUrl: 'https://resend.com/docs/send-with-smtp',
        defaults: { host: 'smtp.resend.com', port: 587, username: 'resend' },
        note: 'The username is the literal string "resend"; the API key goes in the password.',
        fields: [{ ...SECRET, label: 'API key', placeholder: 're_…' }],
    },
    {
        id: 'smtp',
        label: 'Custom SMTP',
        docsUrl: '',
        defaults: { port: 587 },
        note: 'Anything else that speaks SMTP.',
        fields: [
            { name: 'host', label: 'SMTP host', required: true, placeholder: 'smtp.example.com' },
            { name: 'port', label: 'Port', required: true, placeholder: '587' },
            { name: 'username', label: 'Username' },
            { ...SECRET, label: 'Password', required: false },
        ],
    },
];

const BY_ID = new Map(EMAIL_PROVIDERS.map(provider => [provider.id, provider]));

/** @returns {ProviderDescriptor|undefined} */
export function getProvider(id) {
    return BY_ID.get(String(id ?? '').toLowerCase());
}

/**
 * The catalog as the console renders it. Nothing here is secret — the field
 * list is a form description, not a value.
 */
export function listProviders() {
    return EMAIL_PROVIDERS.map(({ id, label, docsUrl, defaults, fields, note }) => ({
        id,
        label,
        docsUrl,
        defaults,
        note: note ?? null,
        fields: fields.map(field => ({
            name: field.name,
            label: field.label,
            secret: field.secret === true,
            required: field.required !== false,
            placeholder: field.placeholder ?? null,
            help: field.help ?? null,
        })),
    }));
}

/**
 * Merge stored values with the provider's defaults into nodemailer options.
 *
 * @param {{ provider: string, host?: string, port?: number, username?: string, password?: string }} config
 * @returns {{ host: string, port: number, secure: boolean, auth?: { user: string, pass: string } }}
 */
export function buildTransportOptions(config) {
    const descriptor = getProvider(config.provider);
    if (!descriptor) throw new Error(`Unknown email provider: ${config.provider}`);

    const host = config.host || descriptor.defaults.host;
    const port = Number(config.port || descriptor.defaults.port || 587);
    const user = config.username || descriptor.defaults.username;

    if (!host) throw new Error(`No SMTP host configured for ${descriptor.label}`);

    return {
        host,
        port,
        // 465 is implicit TLS; everything else negotiates STARTTLS.
        secure: port === 465,
        ...(user && config.password ? { auth: { user, pass: config.password } } : {}),
    };
}
