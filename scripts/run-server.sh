#!/bin/zsh -f
# Runs the app server for the launchd agent com.sumitnarayan.portfoliotracker
# (launchd/com.sumitnarayan.portfoliotracker.plist). The Mac is kept awake for as
# long as the server runs: caffeinate watches this process id, and `exec` makes
# the server that process, so launchd's stop signal reaches the server directly.
cd "${0:A:h}/.."
/usr/bin/caffeinate -is -w $$ &
exec /opt/homebrew/bin/node node_modules/tsx/dist/cli.mjs server.ts
