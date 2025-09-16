# Atalaia 🛡️👁️

Atalaia is a real-time security vulnerability monitoring service that fetches data from multiple feeds and sends formatted alerts directly to a Slack channel. It helps security and engineering teams stay ahead of emerging threats.

## ✨ Features

- **Real-time Monitoring**: Runs on a configurable schedule to check for new vulnerabilities.
- **Multi-Source Aggregation**: Pulls data from trusted feeds like CISA, Snyk, VulDB, and more.
- **Data Normalization**: Standardizes vulnerabilities into a clean, consistent format.
- **Smart Slack Alerts**: Delivers well-formatted messages with severity indicators.
- **Urgent Notifications**: Automatically tags `@channel` for Critical or Known Exploited vulnerabilities.
- **Containerized**: Ready to deploy with Docker.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express
- **Scheduling**: `node-cron`
- **HTTP Requests**: `axios`
- **Architecture**: Clean Architecture
- **Deployment**: Docker

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or later)
- npm
- Docker (for containerized deployment)
- A Slack Webhook URL

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd atalaia
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create the environment file:**
    Create a `.env` file in the project root and add your Slack Webhook URL:
    ```ini
    # .env
    SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
    PORT=3000
    # Optional: Override the default cron schedule ('0 * * * *' -> every hour)
    # CRON_SCHEDULE="*/5 * * * *" # Every 5 minutes
    ```

4.  **Configure feeds:**
    Review and adjust the feed URLs in `config.json` as needed.

### Running the Application

-   **Development Mode (with hot-reload):**
    ```bash
    npm run dev
    ```

-   **Production Mode:**
    ```bash
    npm run start
    ```

The service will start, run an initial check, and then follow the schedule defined in `config.json` or `.env`.

### Running with Docker

1.  **Build the Docker image:**
    ```bash
    docker build -t atalaia .
    ```

2.  **Run the Docker container:**
    You must pass the `.env` file to the container so it can access the Slack Webhook URL.
    ```bash
    docker run --env-file .env -p 3000:3000 --name atalaia-app -d atalaia
    ```
    - `-p 3000:3000`: Maps the container's port 3000 to your local machine's port 3000.
    - `-d`: Runs the container in detached mode (in the background).

## 🌐 API Endpoints

-   **Health Check:**
    -   `GET /health`
    -   Returns a simple JSON response to confirm the service is running.
    -   `{"status":"ok","timestamp":"..."}`

## 📂 Project Structure

The project follows **Clean Architecture** principles to separate concerns:

-   `src/domain`: Core business entities (e.g., `Vulnerability`).
-   `src/application`: Use cases that orchestrate the business logic.
-   `src/infrastructure`: External concerns like APIs, databases, schedulers (Slack, Cron, Axios).
-   `src/interface`: Entry points to the application (Express server).