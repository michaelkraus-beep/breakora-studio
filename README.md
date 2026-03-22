<div align="center">
  <img width="800" alt="Breakora Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
  
  # Breakora 📈
  **Advanced Algorithmic Trading Station & Analytics Platform**
</div>

## 🚀 Project Overview

Breakora is a comprehensive, web-based trading terminal designed for complex market analysis and automated trading. It processes real-time data, calculates proprietary footprint metrics, and offers a highly interactive, customizable workspace that bridges the gap between deep market analytics and future AI-driven strategy execution.

### ✨ Core Features
* **Interactive Dashboard:** Tabbed charting (candlestick & footprint), custom indicators, and flexible window management (tape reading).
* **Live Market Scanner:** Real-time filtering of asset activity based on custom criteria. One-click opening of scanned assets into the main dashboard.
* **Robust Data Pipeline:** Real-time WebSocket aggregation from Binance (expandable to other exchanges) with asynchronous database storage.
* **AI & Automation Ready:** Foundation built for future backtesting, algorithmic execution, and machine learning strategy development.

---

## 🏗️ Tech Stack

**Frontend (Client)**
* React 19 & Vite
* TypeScript
* Tailwind CSS v4
* FlexLayout-React (for dynamic workspace management)
* TensorFlow.js & Google GenAI (ML foundations)

**Backend (Server)**
* Python 3.x
* FastAPI & Uvicorn (High-performance Async API)
* PostgreSQL (via `asyncpg` & SQLAlchemy 2.0)
* WebSockets & Pandas (Data processing & Technical Analysis)

---

## 💻 Local Development Setup

To run Breakora locally, you need to start both the Python backend and the React frontend.

### Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Python](https://www.python.org/) (3.10+)
* PostgreSQL Database

### 1. Backend Setup (FastAPI)
Open a terminal and navigate to the backend folder:
```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/Scripts/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server
uvicorn main:app --reload
2. Frontend Setup (React/Vite)
Open a second terminal in the project root directory:

Bash
# Install Node dependencies
npm install

# Start the Vite development server
npm run dev
3. Environment Variables
Ensure you have set up your database connection and API keys.

Database URL: postgresql+asyncpg://postgres:breakora@localhost:5432/postgres

Set your GEMINI_API_KEY in .env.local if utilizing AI Studio features.

Disclaimer: This software is for educational and analytical purposes. Trading cryptocurrencies carries a high level of risk.
