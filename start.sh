#!/bin/bash
# SignalBrief — start.sh
# Starts the Telegram bot reply handler and web onboarding server in parallel.
# digest.js runs on schedule via OpenClaw cron (signalbrief-daily, 7 AM ET Mon-Sat).
# To run a manual digest: node digest.js

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "☀️  Starting SignalBrief services..."
echo ""

# Kill any existing instances
pkill -f "signalbrief/bot-server.js" 2>/dev/null && echo "  Stopped existing bot server" || true
pkill -f "signalbrief/web/server.js" 2>/dev/null && echo "  Stopped existing web server" || true
sleep 1

# Start bot server (Telegram reply handler)
echo "  📱 Starting Telegram bot server (replies/commands)..."
node "$DIR/bot-server.js" >> /tmp/signalbrief-bot.log 2>&1 &
BOT_PID=$!
echo "     PID: $BOT_PID → log: /tmp/signalbrief-bot.log"

# Start web server (onboarding + settings UI)
echo "  🌐 Starting web server (onboarding + settings)..."
node "$DIR/web/server.js" >> /tmp/signalbrief-web.log 2>&1 &
WEB_PID=$!
echo "     PID: $WEB_PID → log: /tmp/signalbrief-web.log"

echo ""
echo "✅ SignalBrief running:"
echo "   Onboarding: http://localhost:3003"
echo "   Settings:   http://localhost:3003/settings?email=you@example.com"
echo "   Bot:        @signalbrief29bot"
echo ""
echo "📅 Digest cron: 6:45 AM ET Mon–Sat (OpenClaw cron: signalbrief-daily)"
echo "   Run now:    node $DIR/digest.js"
echo ""
echo "Press Ctrl+C to stop both services."

# Wait for both, kill both on exit
trap "kill $BOT_PID $WEB_PID 2>/dev/null; echo 'Stopped.'" EXIT
wait $BOT_PID $WEB_PID
