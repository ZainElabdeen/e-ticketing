namespace TicketService.Api.Http;

/// <summary>Endpoint metadata: only the internal API key may call this route.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class InternalScopeAttribute : Attribute;

/// <summary>Endpoint metadata: no API key needed (health probes).</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class PublicEndpointAttribute : Attribute;
