#!/bin/zsh -f
# Who can reach the app at https://<mac>.<tailnet>.ts.net:
#   scripts/access.sh private   only your own Tailscale devices (Tailscale Serve)
#   scripts/access.sh public    anyone on the internet (Tailscale Funnel); the app
#                               itself still requires Google sign-in and an invite
#   scripts/access.sh status    show which one is on
set -e
case "${1:-status}" in
  private) tailscale funnel --https=443 off >/dev/null 2>&1 || true; tailscale serve --bg 3000 ;;
  public)  tailscale funnel --bg 3000 ;;
  status)  ;;
  *) echo "usage: $0 private|public|status" >&2; exit 2 ;;
esac
tailscale funnel status
