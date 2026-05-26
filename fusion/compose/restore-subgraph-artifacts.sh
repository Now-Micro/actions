#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

manifest_path="$repo_root/gateway-release.json"
output_directory=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest-path)
      manifest_path="$2"
      shift 2
      ;;
    --output-directory)
      output_directory="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v jq &>/dev/null; then
  echo "jq is required but not installed." >&2
  exit 1
fi

if [[ -z "$output_directory" ]]; then
  output_directory="$repo_root/$(jq -r '.outputDirectory' "$manifest_path")"
fi

mkdir -p "$output_directory"

subgraph_count="$(jq '.subgraphs | length' "$manifest_path")"

for (( index=0; index<subgraph_count; index++ )); do
  subgraph_name="$(jq -r ".subgraphs[$index].name" "$manifest_path")"
  subgraph_repository="$(jq -r ".subgraphs[$index].repository" "$manifest_path")"
  subgraph_release_tag="$(jq -r ".subgraphs[$index].releaseTag" "$manifest_path")"
  subgraph_asset_name="$(jq -r ".subgraphs[$index].assetName" "$manifest_path")"

  staging_directory="$output_directory/$subgraph_name"
  mkdir -p "$staging_directory"

  gh release download "$subgraph_release_tag" \
    --repo "$subgraph_repository" \
    --pattern "$subgraph_asset_name" \
    --dir "$staging_directory" \
    --clobber

  downloaded_asset_path="$staging_directory/$subgraph_asset_name"
  if [[ ! -f "$downloaded_asset_path" ]]; then
    echo "Expected release asset '$subgraph_asset_name' from '$subgraph_repository' at tag '$subgraph_release_tag'." >&2
    exit 1
  fi

  stable_asset_path="$staging_directory/$subgraph_name.fsp"
  if [[ "$downloaded_asset_path" != "$stable_asset_path" ]]; then
    cp -f "$downloaded_asset_path" "$stable_asset_path"
  fi
done