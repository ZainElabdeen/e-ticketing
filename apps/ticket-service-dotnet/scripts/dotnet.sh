#!/bin/sh
# Uses the user-local .NET SDK when one is installed, so pnpm and Turbo work without shell profile
# changes. Otherwise (CI, Docker) the dotnet already on PATH is used.
if [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
if ! command -v dotnet >/dev/null 2>&1; then
  echo "ticket-service-dotnet: .NET SDK not found — install SDK 10.0.404 (see global.json) or run the official dotnet-install.sh into ~/.dotnet" >&2
  exit 1
fi
exec dotnet "$@"
