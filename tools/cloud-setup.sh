#!/bin/bash
# A cloud session's setup (Claude Code on the web): Node 26 as CI has it, the packages, Chrome for QA. Run by
# .claude/settings.json's SessionStart hook; outside the cloud it does nothing.
[ "$CLAUDE_CODE_REMOTE" = true ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 1
major=$(sed -n 's/.*node-version: *\([0-9]*\).*/\1/p' .github/workflows/ci.yml | head -1)
dir=/opt/node${major:-26}
if [ ! -x "$dir/bin/node" ]; then
  v=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r --arg m "v${major:-26}." '[.[] | select(.version | startswith($m))][0].version')
  curl -fsSL "https://nodejs.org/dist/$v/node-$v-linux-x64.tar.xz" | tar -xJ -C /opt && mv "/opt/node-$v-linux-x64" "$dir" || { echo "cloud-setup: no Node $v" >&2; exit 1; }
fi
export PATH="$dir/bin:$PATH"
# (every command Claude runs after this: this Node first, and QA's Chrome the VM has)
[ -n "$CLAUDE_ENV_FILE" ] && printf 'export PATH="%s/bin:$PATH"\nexport VAULTITE_CHROME="%s"\n' "$dir" "${CHROME_PATH:-/usr/bin/google-chrome}" >> "$CLAUDE_ENV_FILE"
# (npm ci again only when the lock or .npmrc changed)
sum=$(cat package-lock.json .npmrc | sha256sum | cut -c1-16)
if [ "$(cat node_modules/.cloud-setup 2>/dev/null)" != "$sum" ]; then
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund > /tmp/cloud-setup-npm.log 2>&1 || { tail -20 /tmp/cloud-setup-npm.log >&2; exit 1; }
  echo "$sum" > node_modules/.cloud-setup
fi
