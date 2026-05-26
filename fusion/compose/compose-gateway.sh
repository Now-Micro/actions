#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

input_directory="$repo_root/artifacts/subgraphs"
output_file="$repo_root/src/Trafera.GraphQL.Gateway/gateway.fgp"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input-directory)
      input_directory="$2"
      shift 2
      ;;
    --output-file)
      output_file="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

echo "[compose] script_dir=$script_dir"
echo "[compose] repo_root=$repo_root"
echo "[compose] current_dir=$(pwd)"
echo "[compose] input_directory=$input_directory"
echo "[compose] output_file=$output_file"

if ! command -v dotnet &>/dev/null; then
  echo "dotnet is required but not installed or not on PATH." >&2
  exit 1
fi

if [[ ! -f "$repo_root/.config/dotnet-tools.json" ]]; then
  echo "Local tool manifest '$repo_root/.config/dotnet-tools.json' was not found." >&2
  exit 1
fi

echo "[compose] dotnet version: $(dotnet --version)"
echo "[compose] local tools:"
dotnet tool list --local

if ! dotnet tool run fusion -- --help >/dev/null 2>&1; then
  echo "Local tool 'fusion' is not runnable. Ensure 'dotnet tool restore' succeeded in repo root." >&2
  exit 1
fi

if [[ ! -d "$input_directory" ]]; then
  echo "Input directory '$input_directory' does not exist." >&2
  exit 1
fi

mapfile -t subgraph_files < <(find "$input_directory" -type f -name '*.fsp' | sort)

if [[ ${#subgraph_files[@]} -eq 0 ]]; then
  echo "No .fsp files were found under '$input_directory'." >&2
  exit 1
fi

subgraph_args=()
for subgraph_file in "${subgraph_files[@]}"; do
  subgraph_args+=("-s" "$subgraph_file")
done

echo "[compose] subgraph_count=${#subgraph_files[@]}"
for subgraph_file in "${subgraph_files[@]}"; do
  echo "[compose] subgraph_file=$subgraph_file"
done

mkdir -p "$(dirname "$output_file")"

dotnet tool run fusion compose -p "$output_file" "${subgraph_args[@]}"

if [[ ! -f "$output_file" ]]; then
  echo "Expected composed output '$output_file' was not created." >&2
  exit 1
fi

echo "[compose] wrote output_file=$output_file"