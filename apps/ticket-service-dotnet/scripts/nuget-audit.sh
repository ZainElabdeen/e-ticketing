#!/bin/sh
# Fails (exit 1) when a direct or transitive NuGet package has a High or Critical advisory.
# Low and Moderate advisories are reported but do not fail (ADR-0025).
set -eu
cd "$(dirname "$0")/.."
report=$(sh scripts/dotnet.sh list TicketService.sln package --vulnerable --include-transitive 2>&1) || {
  printf '%s\n' "$report" >&2
  echo "nuget-audit: dotnet list failed" >&2
  exit 2
}
printf '%s\n' "$report"
# Vulnerability rows look like: "> Package  1.0.0  1.0.0  High  https://github.com/advisories/..."
if printf '%s\n' "$report" | grep -E '^[[:space:]]*>' | grep -Eq '[[:space:]](High|Critical)[[:space:]]'; then
  echo "nuget-audit: High or Critical advisory found" >&2
  exit 1
fi
echo "nuget-audit: no High or Critical advisories"
