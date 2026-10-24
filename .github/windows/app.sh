# The Windows app as a user gets it, after npm ci and npm run build (windows.yml's surfaces job): its installer built
# under a test name, installed, run on a sandbox vault, updated over itself, uninstalled; screenshots and logs in windows-out/.
set -eu
node tools/test_installer.ts windows-out
