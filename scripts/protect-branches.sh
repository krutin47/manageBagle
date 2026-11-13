#!/usr/bin/env bash
# Protects main (production) and uat. Run once by a repository admin:
#   gh auth login && ./scripts/protect-branches.sh krutin47/manageBagle
#
# Rules applied to both branches:
#   - changes only through pull requests, with 1 approval and resolved conversations
#   - the three CI jobs must pass and the branch must be up to date
#   - no force pushes, no deletion, admins included
set -euo pipefail

REPO="${1:?usage: protect-branches.sh <owner/repo>}"

for BRANCH in main uat; do
  echo "Protecting $REPO@$BRANCH"
  gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Client (lint, types, tests, build)",
      "Server (build, tests)",
      "Container image builds"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
done
echo "Done."
