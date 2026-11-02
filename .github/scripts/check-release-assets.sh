#!/usr/bin/env bash
# Checks a release's assets (a draft's too): a SHA256SUMS-<os>.txt for macOS,
# Ubuntu and Windows, every other asset listed in one of them with the digest
# GitHub has for it, and a build provenance attestation for each.
#   check-release-assets.sh <tag>      (GH_TOKEN, GITHUB_REPOSITORY set)
set -euo pipefail
tag=$1
repo=${GITHUB_REPOSITORY:?}

release=$(gh api "repos/$repo/releases" --paginate --jq ".[] | select(.tag_name == \"$tag\")")
if [ -z "$release" ]; then
  echo "::error::No release has the tag $tag"
  exit 1
fi
assets=$(jq -c '[.assets[] | {id, name, digest}]' <<<"$release")

fail=0
listed=()
for os in macos ubuntu windows; do
  sums=SHA256SUMS-$os.txt
  id=$(jq -r --arg n "$sums" '.[] | select(.name == $n) | .id' <<<"$assets")
  if [ -z "$id" ]; then
    echo "::error::$sums is missing"
    fail=1
    continue
  fi
  while read -r sum name; do
    listed+=("$name")
    digest=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .digest // ""' <<<"$assets")
    if [ -z "$digest" ]; then
      echo "::error::$name is in $sums but not on the release"
      fail=1
    elif [ "$digest" != "sha256:$sum" ]; then
      echo "::error::$name is $digest on the release, $sums says $sum"
      fail=1
    elif [ "$(gh api "repos/$repo/attestations/$digest" --jq '.attestations | length' 2>/dev/null || echo 0)" = 0 ]; then
      echo "::error::$name has no build provenance attestation"
      fail=1
    else
      echo "ok  $name"
    fi
  done < <(gh api -H 'Accept: application/octet-stream' "repos/$repo/releases/assets/$id")
done

while read -r name; do
  case "$name" in SHA256SUMS-*.txt) continue ;; esac
  if ! printf '%s\n' "${listed[@]}" | grep -qxF -- "$name"; then
    echo "::error::$name isn't in any SHA256SUMS file"
    fail=1
  fi
done < <(jq -r '.[].name' <<<"$assets")

if [ "$fail" = 0 ]; then
  echo "All $(jq length <<<"$assets") assets of $tag check out"
fi
exit "$fail"
