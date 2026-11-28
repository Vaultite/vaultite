#!/bin/sh
# Run Tailscale (the app reads it with `tailscale status --json`,
# core/owner.ts) when a preauth key is given, then run the app.
#
# With Tailscale up, the app answers for its machine's tailnet name(s);
# if VAULTITE_HOSTS isn't set, export that DNS name as it.
if command -v tailscale >/dev/null 2>&1; then
  [ -n "${TS_AUTHKEY:-}" ] && tailscale up --authkey "$TS_AUTHKEY" --hostname "${TS_HOSTNAME:-vaultite}" >/dev/null 2>&1 &
  if [ -z "${VAULTITE_HOSTS:-}" ]; then
    VAULTITE_HOSTS=$(tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)?.Self?.DNSName??"")}catch{console.log("")}})')
    export VAULTITE_HOSTS
  fi
fi
exec node server.ts
