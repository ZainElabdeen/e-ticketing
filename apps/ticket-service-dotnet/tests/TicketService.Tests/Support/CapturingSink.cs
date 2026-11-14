using Serilog.Core;
using Serilog.Events;
using TicketService.Api.Http;

namespace TicketService.Tests.Support;

/// <summary>Collects log events and renders them with the production formatter.</summary>
public sealed class CapturingSink : ILogEventSink
{
    private readonly List<LogEvent> _events = [];

    public void Emit(LogEvent logEvent)
    {
        lock (_events)
        {
            _events.Add(logEvent);
        }
    }

    public IReadOnlyList<string> Lines()
    {
        LogEvent[] snapshot;
        lock (_events)
        {
            snapshot = [.. _events];
        }
        return snapshot.Select(e =>
        {
            using var writer = new StringWriter();
            new JsonLogFormatter().Format(e, writer);
            return writer.ToString().TrimEnd();
        }).ToList();
    }
}
