#!/usr/bin/env bash
set -euo pipefail

IMAGE="lab42it/wlaudio"
VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

usage() {
  echo "Usage: $0 [--version <tag>] [--platform <platforms>] [--dry-run]"
  echo ""
  echo "  --version    Override version tag (default: from package.json: $VERSION)"
  echo "  --platform   Target platforms (default: $PLATFORMS)"
  echo "  --dry-run    Build only, do not push"
  echo ""
  echo "Examples:"
  echo "  $0                          # build + push :$VERSION and :latest"
  echo "  $0 --dry-run               # build only"
  echo "  $0 --version 0.7.0-rc1     # push a specific tag"
  exit 1
}

DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --platform) PLATFORMS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done

echo "Image   : $IMAGE"
echo "Version : $VERSION"
echo "Platforms: $PLATFORMS"
echo "Dry run : $DRY_RUN"
echo ""

# Ensure buildx builder with multi-platform support is available
if ! docker buildx ls | grep -q "wlaudio-builder"; then
  echo "Creating buildx builder..."
  docker buildx create --name wlaudio-builder --use --bootstrap
else
  docker buildx use wlaudio-builder
fi

BUILD_ARGS=(
  buildx build
  --platform "$PLATFORMS"
  --tag "$IMAGE:$VERSION"
  --tag "$IMAGE:latest"
  --label "org.opencontainers.image.version=$VERSION"
  --label "org.opencontainers.image.source=https://github.com/alvagante/wlaudio"
  --label "org.opencontainers.image.description=Real-time web frontend for monitoring Claude Code sessions"
)

if [ "$DRY_RUN" = true ]; then
  echo "--- DRY RUN: building for $PLATFORMS (no push) ---"
  docker "${BUILD_ARGS[@]}" --load .
  echo ""
  echo "Build complete. Image NOT pushed (dry run)."
else
  echo "--- Building and pushing $IMAGE:$VERSION ---"
  docker "${BUILD_ARGS[@]}" --push .
  echo ""
  echo "Pushed:"
  echo "  docker pull $IMAGE:$VERSION"
  echo "  docker pull $IMAGE:latest"
fi
