import { createRssAdvisoryFeed } from './rssAdvisoryFeed.js';

/** CERT-FR (ANSSI) alerts and advisories. */
export const fetch = createRssAdvisoryFeed({
    name: 'certfr',
    label: 'CERT-FR',
    url: 'https://www.cert.ssi.gouv.fr/feed/',
});
