#!/bin/sh
# Uses the user-local .NET SDK when one is installed, so pnpm and Turbo work without shell profile
# changes. Otherwise (CI, Docker) the dotnet already on PATH is used.
if [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
exec dotnet "$@"
