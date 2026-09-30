#!/bin/zsh -f
# Runs the app server for the launchd agent com.sumitnarayan.portfoliotracker
# (launchd/com.sumitnarayan.portfoliotracker.plist): the production build, rebuilt
# first whenever the source is newer than it. The Mac is kept awake for as long as
# the server runs: caffeinate watches this process id, and `exec` makes the server
# that process, so launchd's stop signal reaches the server directly.
cd "${0:A:h}/.."
if [[ ! -f dist/server.mjs || -n "$(find server*.ts src index.html package.json -newer dist/server.mjs -print -quit)" ]]; then
  echo "[run-server] building $(date)"
  /opt/homebrew/bin/npm run build || exit 1
fi
/usr/bin/caffeinate -is -w $$ &
NODE_ENV=production exec /opt/homebrew/bin/node dist/server.mjs
