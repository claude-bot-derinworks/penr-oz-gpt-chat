# penr-oz-gpt-chat
GPT Chat Client leveraging Neural Network Service
- Based on [ng-video-lecture](https://github.com/karpathy/ng-video-lecture), [nanoGPT](https://github.com/karpathy/nanoGPT) and  [nanochat](https://github.com/karpathy/nanochat)
- Using the [Neural Network service](https://github.com/derinworks/penr-oz-neural-network-v3-torch-ddp)

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
   - **Start the development server**:
     ```bash
     npm run dev
     ```
     App running at http://localhost:3000
   - **Build for production**:
     ```bash
     npm run build
     ```
   - **Preview the production build**:
     ```bash
     npm run preview
     ```
