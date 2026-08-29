set default-list
set positional-arguments

wrangler := "./node_modules/.bin/wrangler"

_ensure-wrangler:
    @command -v npm >/dev/null 2>&1 || { echo "npm is required to install Wrangler." >&2; exit 127; }
    @if ! {{wrangler}} --version 2>/dev/null | grep -Eq '^4\.'; then npm install --no-save --no-package-lock wrangler@4; fi

_stage-pages:
    @rm -rf dist
    @cp -R site dist

# Serve the Cloudflare Pages site at http://127.0.0.1:8788
dev: _ensure-wrangler _stage-pages
    {{wrangler}} pages dev dist --ip 127.0.0.1 --port 8788 --compatibility-date 2026-08-23

# Deploy the static site to the production Pages branch
deploy: _ensure-wrangler _stage-pages
    {{wrangler}} pages deploy dist --project-name nientiendo --branch main

# Run the NextUI automation contract tests
test:
    @command -v bats >/dev/null 2>&1 || { echo "bats is required (brew install bats-core)." >&2; exit 127; }
    bats tests/nextui_automation.bats

# Install NextUI on a prepared SD card
install *args:
    @bin/nextui-just install "$@"

# Update an existing NextUI SD card
update *args:
    @bin/nextui-just update "$@"

# Compare the installed and latest NextUI releases
check *args:
    @bin/nextui-just check "$@"

# Create a compressed backup of a NextUI SD card
backup *args:
    @bin/nextui-just backup "$@"

# Configure a device, including its Nientiendo boot logos
configure *args:
    @bin/nextui-just logos "$@"

# Format supported source and documentation files
fmt:
    npm run format

# Check formatting without changing files
fmt-check:
    npm run format:check

# Run static analysis
lint:
    npm run lint

# Run every local verification gate
verify: fmt-check lint test

# Install the repository's pre-commit hook
hooks:
    @command -v pre-commit >/dev/null 2>&1 || { echo "pre-commit is required (brew install pre-commit)." >&2; exit 127; }
    pre-commit install
