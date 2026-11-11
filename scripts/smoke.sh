#!/bin/sh
set -eu
exec pwsh -NoProfile -File "$(dirname "$0")/smoke.ps1" "$@"
