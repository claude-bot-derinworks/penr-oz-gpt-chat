# penr-oz-gpt-chat
GPT Chat Client leveraging Neural Network Service
- Based on [ng-video-lecture](https://github.com/karpathy/ng-video-lecture), [nanoGPT](https://github.com/karpathy/nanoGPT) and  [nanochat](https://github.com/karpathy/nanochat)
- Using the [Neural Network service](https://github.com/derinworks/penr-oz-neural-network-v3-torch-ddp)

## API Contract

See [API.md](API.md) for the full request/response contracts between the React client, Express proxy, and Neural Network service.

## Quickstart Guide

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/derinworks/penr-oz-gpt-chat.git
   cd penr-oz-gpt-chat
   ```

2. **Setup**:
   - **Install dependencies**:
     ```bash
     npm install
     ```
   - **Configure environment** by copying the example file and editing it:
     ```bash
     cp .env.example .env
     ```
     Update `.env` with your Neural Network service URL:
     ```dotenv
     VITE_PREDICTION_SERVER_URL=http://localhost:8000
     ```

3. **Neural Network Service**:
   - **Follow instructions** on [Quick Start Guide](https://github.com/derinworks/penr-oz-neural-network-v3-torch-ddp?tab=readme-ov-file#quickstart-guide)
   - **Deployed remotely** then use a `.env` file as such to configure url:
    ```dotenv
    VITE_PREDICTION_SERVER_URL=http://???:8000
    ```

4. **Run**:
   - **Launch React client** (Vite dev server only):
     ```bash
     npm start
     ```
     App running at http://localhost:3000
   - **Build for production** (type-check + Vite bundle):
     ```bash
     npm run build
     ```
   - **Start the proxy server** (Express on port 3001):
     ```bash
     npm run server
     ```
   - **Run client and server together** (recommended for development):
     ```bash
     npm run dev
     ```
     React client at http://localhost:3000, proxy server at http://localhost:3001 (auto-restarts on server file changes)
   - **Preview the production build**:
     ```bash
     npm run preview
     ```
