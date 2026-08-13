import { createRssAdvisoryFeed } from './rssAdvisoryFeed.js';

/** CERT-EU security advisories. */
export const fetch = createRssAdvisoryFeed({
    name: 'certeu',
    label: 'CERT-EU',
    url: 'https://cert.europa.eu/publications/security-advisories-rss',
});
