#!/bin/sh
# Pins the user-local .NET SDK so pnpm and Turbo work without shell profile changes.
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
exec dotnet "$@"
