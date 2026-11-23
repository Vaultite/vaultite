#!/bin/bash
# A cloud session lands its branch (one commit on origin/main, through tools/maingate.sh) by a PR GitHub squash-merges:
# GitHub signs that commit, where the cloud's are signed by Anthropic. The cloud's proxy lets only REST through (no gh pr).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
die() { echo "land: $*" >&2; exit 1; }
branch=$(git symbolic-ref --short HEAD) || die "not on a branch"
[ "$branch" != main ] || die "land from your branch, not main"
[ -z "$(git status --porcelain)" ] || die "commit or drop your changes first"
git fetch -q origin main
base=$(git rev-parse origin/main) sha=$(git rev-parse HEAD)
git merge-base --is-ancestor "$base" "$sha" && [ "$(git rev-list --count "$base..$sha")" = 1 ] ||
  die "rebase onto origin/main and squash to one commit first: git rebase origin/main, then git reset --soft origin/main && git commit"
repo=$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
who=$(gh api user --jq .login 2>/dev/null) || die "gh can't act as you (gh api user failed)"
case "$who" in *"[bot]") die "gh acts as $who, an app: the merge must be yours" ;; esac
subject=$(git log -1 --format=%s) body=$(git log -1 --format=%b)
sh tools/maingate.sh "$base" "$sha" || die "main's gate refused it (above)"
git push -q --force-with-lease origin "HEAD:refs/heads/$branch"
pr=$(gh api "repos/$repo/pulls?head=${repo%%/*}:$branch&state=open" --jq '.[0].number // empty')
about="TL;DR: ${body:-$subject}"
if [ -n "$pr" ]; then gh api -X PATCH "repos/$repo/pulls/$pr" -f title="$subject" -f body="$about" > /dev/null
else pr=$(gh api "repos/$repo/pulls" -f title="$subject" -f head="$branch" -f base=main -f body="$about" --jq .number); fi
# (GitHub works out a new PR's mergeability after it answers: a merge that soon may be refused for a few seconds)
err=$(mktemp)
for wait in 2 4 8 16 0; do
  if merged=$(gh api -X PUT "repos/$repo/pulls/$pr/merge" -f merge_method=squash -f sha="$sha" -f commit_title="$subject" \
    -f commit_message="$body" --jq .sha 2>"$err"); then break; fi
  [ "$(gh api "repos/$repo/pulls/$pr" --jq .mergeable_state)" = dirty ] &&
    die "PR #$pr conflicts with main: rebase onto origin/main and run this again"
  [ "$wait" = 0 ] && { cat "$err" >&2; die "GitHub refused to merge PR #$pr"; }
  sleep "$wait"
done
gh api -X DELETE "repos/$repo/git/refs/heads/$branch" > /dev/null 2>&1 || true
got=$(gh api "repos/$repo/commits/$merged" --jq '"\(.commit.verification.verified) \(.author.login // "-")"')
[ "$got" = "true $who" ] || echo "land: $merged landed, but GitHub says verified/author is \"$got\", not \"true $who\"" >&2
echo "Merged: $merged (PR #$pr)"
