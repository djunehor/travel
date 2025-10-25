#!/bin/bash

echo "================================"
echo "Vacation Planner - Starting..."
echo "================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "   Creating from .env.example..."
    cp .env.example .env
    echo "   Please edit .env and add your OPENAI_API_KEY"
    echo ""
    read -p "Press Enter to continue (or Ctrl+C to exit and configure .env)..."
fi

# Check if OPENAI_API_KEY is set
if ! grep -q "OPENAI_API_KEY=sk-" .env 2>/dev/null; then
    echo "⚠️  Warning: OPENAI_API_KEY not configured in .env"
    echo "   Please add your OpenAI API key to .env file"
    echo ""
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install --break-system-packages
    echo ""
fi

echo "🚀 Starting backend server..."
echo "   Server will run on http://localhost:3000"
echo "   Open vacation-planner.html in your browser to use the app"
echo ""
echo "   Press Ctrl+C to stop the server"
echo ""

node server.js