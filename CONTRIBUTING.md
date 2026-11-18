# Contributing to Vaultite

Thanks for your interest. Bug reports, ideas and pull requests are all welcome.

## Reporting issues

Open a [GitHub issue](https://github.com/Vaultite/vaultite/issues) with your Vaultite version, your system, steps to
reproduce, and what you expected. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

## Setup

Needs Node.js 23.6 or later. On Linux, also `build-essential` and `python3`.

```sh
npm ci
npm run prepare                                  # the git hooks
npx playwright-core install chromium             # for the browser checks
npm run build
node bin/vau sandbox /tmp/vaultite-dev           # a made-up vault
VAULTITE_VAULT=/tmp/vaultite-dev VAULTITE_LOCAL=/tmp/vaultite-local PORT=8799 npm start
```

Then open http://127.0.0.1:8799. Use a made-up vault, never your own: the server writes into the vault it serves.

The desktop app is `npm run app`, the iPhone app `npm run ios` (needs Xcode, and your `DEVELOPMENT_TEAM` in
`ios/App/Local.xcconfig`), and the Android app `npm run android` (needs JDK 21 and the Android SDK). On Windows, npm's
scripts need a POSIX shell: `npm config set script-shell` to Git Bash's `bash.exe`.

A change to `package-lock.json` makes `npmDepsHash` in `flake.nix` stale: set it to the hash `nix build .#server`, or
the Nix job on CI, says it got.

## Pull requests

Small fixes are fine to send directly. For anything larger, open an issue first so we can agree on the approach before
you spend time on it. Many features are better as a plugin of your own, which needs no pull request:
[vault plugins](core/docs/vault-plugins.md).

Before sending a pull request:

```sh
npm run build
npm run check
npm test
npm run smoke
```

CI runs them on Linux, macOS and Windows. If you can only test on one, say so.

- **One change per pull request**, rebased on `main`. It lands as one squashed commit.
- **The title is a Conventional Commit**, at most 72 characters, saying what changed for the user:
  `fix(phone): tab list no longer stretches the page`.
- **Say what changed and how you tested it**, in a few lines. A UI change has before and after screenshots.
- **A change users notice** has a test and one line under Unreleased in [CHANGELOG.md](CHANGELOG.md).

Three hard rules:

- **The vault is the user's.** Their data is plain files, with no database, and opening a vault changes none of them.
- **Features are plugins.** The core indexes files and loads plugins, and never imports one.
- **Made-up data only**, in code, docs, tests and screenshots.

The rest of the rules are in [CLAUDE.md](CLAUDE.md) and the `CLAUDE.md` of each folder you touch. They're written for
AI agents and work for people too, but how a branch lands there is for maintainers.

## License of contributions

Vaultite is under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it's under the same
license, with no additional terms (its section 5), and that you wrote it or otherwise have the right to submit it,
including your employer's permission where they have rights to your work. You keep your copyright.

Code or assets from elsewhere need a compatible license and an entry in [NOTICE](NOTICE).
