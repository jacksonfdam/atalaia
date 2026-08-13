import { createRssAdvisoryFeed } from './rssAdvisoryFeed.js';

/** Zero Day Initiative published advisories. */
export const fetch = createRssAdvisoryFeed({
    name: 'zdi',
    label: 'ZDI',
    url: 'https://www.zerodayinitiative.com/rss/published/',
});
