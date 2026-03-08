#!/bin/bash
# SignalBrief — start.sh
# Starts web, bot, and (optionally) the always-on scheduler worker.
# To disable worker for local one-off sessions: START_WORKER=0 ./start.sh

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
START_WORKER="${START_WORKER:-1}"

echo "☀️  Starting SignalBrief services..."
echo ""

# Kill any existing instances
pkill -f "signalbrief/src/entrypoints/bot-server.js" 2>/dev/null && echo "  Stopped existing bot server" || true
pkill -f "signalbrief/web/server.js" 2>/dev/null && echo "  Stopped existing web server" || true
pkill -f "signalbrief/src/entrypoints/scheduler-worker.js" 2>/dev/null && echo "  Stopped existing scheduler worker" || true
sleep 1

# Start bot server (Telegram reply handler)
echo "  📱 Starting Telegram bot server (replies/commands)..."
node "$DIR/src/entrypoints/bot-server.js" >> /tmp/signalbrief-bot.log 2>&1 &
BOT_PID=$!
echo "     PID: $BOT_PID → log: /tmp/signalbrief-bot.log"

# Start web server (onboarding + settings UI)
echo "  🌐 Starting web server (onboarding + settings)..."
node "$DIR/web/server.js" >> /tmp/signalbrief-web.log 2>&1 &
WEB_PID=$!
echo "     PID: $WEB_PID → log: /tmp/signalbrief-web.log"

WORKER_PID=""
if [ "$START_WORKER" = "1" ]; then
  echo "  ⏱️  Starting scheduler worker (24/7 due-check loop)..."
  node "$DIR/src/entrypoints/scheduler-worker.js" >> /tmp/signalbrief-worker.log 2>&1 &
  WORKER_PID=$!
  echo "     PID: $WORKER_PID → log: /tmp/signalbrief-worker.log"
fi

echo ""
echo "✅ SignalBrief running:"
echo "   Onboarding: http://localhost:3003"
echo "   Settings:   http://localhost:3003/settings?email=you@example.com"
echo "   Bot:        @signalbrief29bot"
echo ""
if [ "$START_WORKER" = "1" ]; then
  echo "📅 Scheduler:  worker loop every 5m (catches due users automatically)"
else
  echo "📅 Scheduler worker disabled (START_WORKER=0)"
fi
echo "   Run now:    node $DIR/src/entrypoints/digest.js (manual catch-up run)"
echo ""
echo "Press Ctrl+C to stop services."

# Wait for all started services, kill on exit
trap "kill $BOT_PID $WEB_PID ${WORKER_PID:-} 2>/dev/null; echo 'Stopped.'" EXIT
if [ -n "$WORKER_PID" ]; then
  wait $BOT_PID $WEB_PID $WORKER_PID
else
  wait $BOT_PID $WEB_PID
fi
