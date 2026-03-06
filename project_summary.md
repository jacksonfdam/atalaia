# Project Prompt: Atalaia 🛡️👁️

You are an expert software engineer tasked with maintaining and extending **Atalaia**, a real-time security vulnerability monitoring service.

## Project Overview
Atalaia is a Node.js application that fetches security vulnerability data from multiple sources (CISA, Snyk, VulDB, CVE Details), normalizes them, and sends formatted alerts to a Slack channel. It uses a **Clean Architecture** to maintain a clear separation of concerns.

## Technical Stack
- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js (for health checks)
- **Scheduling**: `node-cron`
- **Scraping/HTTP**: `axios`, `cheerio`, `rss-parser`
- **Containerization**: Docker

## Architecture & Directory Structure
- **`src/domain/`**: Contains core business entities.
  - `Vulnerability.js`: Defines the `Vulnerability` class with properties like `cveId`, `severity`, `exploited`, etc.
- **`src/application/`**: Contains use cases.
  - `monitorVulns.js`: The main orchestration logic. It fetches feeds, filters by technology (if configured), checks against a local cache to avoid duplicates, and triggers Slack notifications.
- **`src/infrastructure/`**: Handles external integrations.
  - `fetchFeeds.js`: Implements scrapers and parsers for various vulnerability sources.
  - `cache.js`: Manages a local JSON cache to keep track of reported vulnerabilities.
  - `config.js`: Centralized configuration management.
  - `notifySlack.js`: Handles Slack Webhook interactions.
  - `scheduler.js`: Manages the cron job for periodic monitoring.
- **`src/interface/`**: Application entry points.
  - `index.js`: Initializes the Express server, starts the scheduler, and triggers the first monitoring cycle.

## Key Features
- **Multi-Source Aggregation**: Pulls from diverse feeds using different techniques (JSON API, RSS, Web Scraping).
- **Normalization**: All external data is mapped to a consistent `Vulnerability` entity.
- **Filtering**: Supports filtering vulnerabilities based on specific technology keywords (e.g., "nginx", "react").
- **Smart Alerting**: Automatically highlights Critical or Known Exploited vulnerabilities and can tag `@channel` in Slack.
- **Deduplication**: Uses a persistent cache to ensure each vulnerability is reported only once.

## How to Run
1. Install dependencies: `npm install`
2. Configure `.env`: Add `SLACK_WEBHOOK_URL`.
3. Start the service: `npm run dev` or `npm start`.
4. Health check: `GET /health`.

## Instructions for the Agent
When working on this project:
1. **Respect Clean Architecture**: Keep business logic in `application` and `domain`, and implementation details in `infrastructure`.
2. **Follow Existing Patterns**: Use the `Vulnerability` entity for all data normalization.
3. **Verify Scrapers**: If adding a new feed, ensure it handles pagination and respects the source's `User-Agent` requirements.
4. **Test Changes**: Ensure that the monitoring cycle completes without errors and that filtering/caching works as expected.
