#!/bin/sh
# Usage: test.sh <unit|integration>. Coverage is opt-in (ADR-0025): set CI_COVERAGE=1 to write
# OpenCover XML to TestResults/<kind>/.
set -e
cd "$(dirname "$0")/.."
kind="$1"
case "$kind" in
  unit) category=Unit ;;
  integration) category=Integration ;;
  *) echo "usage: test.sh <unit|integration>" >&2; exit 2 ;;
esac
if [ "${CI_COVERAGE:-}" = "1" ]; then
  exec sh scripts/dotnet.sh test TicketService.sln --filter "Category=$category" \
    --collect "XPlat Code Coverage" --results-directory "TestResults/$kind" \
    -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=opencover
fi
exec sh scripts/dotnet.sh test TicketService.sln --filter "Category=$category"
