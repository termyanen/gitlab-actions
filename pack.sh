#!/bin/bash
# Pack extension into .zip for distribution
cd "$(dirname "$0")"
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
ZIPNAME="gitlab-mr-actions-v${VERSION}.zip"
rm -f gitlab-mr-actions-v*.zip
zip -r "$ZIPNAME" . \
  -x "pack.sh" \
  -x ".*" \
  -x ".git/*" \
  -x ".idea/*" \
  -x ".vscode/*" \
  -x "_metadata/*" \
  -x "CLAUDE.md" \
  -x "README.md" \
  -x "CHANGELOG.md" \
  -x "CHANGELOG_RU.md" \
  -x "ROADMAP.md" \
  -x "PRIVACY_POLICY.md" \
  -x "LICENSE" \
  -x "screenshots/*" \
  -x "docs/*" \
  -x "*.crx" \
  -x "*.pem" \
  -x "*.zip"
echo "Created $ZIPNAME"
echo ""
echo "To install:"
echo "  1. chrome://extensions → Developer mode ON"
echo "  2. Drag & drop the .zip, or unzip and Load unpacked"
