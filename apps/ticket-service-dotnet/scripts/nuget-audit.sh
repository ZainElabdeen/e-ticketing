#!/bin/sh
# Fails (exit 1) when a direct or transitive NuGet package has a High or Critical advisory, or
# when the vulnerability data could not be fetched (an unreachable feed must not pass silently).
# Low and Moderate advisories are reported but do not fail (ADR-0025).
# `nuget-audit.sh --check` reads a `dotnet list package --vulnerable` report on stdin and only
# applies the matching rules (used to test them without NuGet).
set -eu

check_report() {
  report=$(cat)
  if printf '%s\n' "$report" | grep -Eiq 'NU1900|error occurred while getting package vulnerability data'; then
    echo "nuget-audit: vulnerability data unavailable (NU1900)" >&2
    return 1
  fi
  # Vulnerability rows look like: "> Package  1.0.0  1.0.0  High  https://github.com/advisories/..."
  if printf '%s\n' "$report" | grep -E '^[[:space:]]*>' | grep -Eq '[[:space:]](High|Critical)[[:space:]]'; then
    echo "nuget-audit: High or Critical advisory found" >&2
    return 1
  fi
  echo "nuget-audit: no High or Critical advisories"
}

if [ "${1:-}" = "--check" ]; then
  check_report
  exit $?
fi

cd "$(dirname "$0")/.."
report=$(sh scripts/dotnet.sh list TicketService.sln package --vulnerable --include-transitive 2>&1) || {
  printf '%s\n' "$report" >&2
  echo "nuget-audit: dotnet list failed" >&2
  exit 2
}
printf '%s\n' "$report"
printf '%s\n' "$report" | check_report
