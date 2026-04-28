#!/bin/bash
echo "🧹 Cleaning up node_modules and .next..."
rm -rf node_modules .next package-lock.json

echo "📦 Installing fresh dependencies for Linux..."
npm install

echo "🚀 Building Next.js app with memory constraints..."
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--max-old-space-size=1536"
export NEXT_EXPORT=true
export cpus=1

npm run build

echo "✅ Build complete!"
