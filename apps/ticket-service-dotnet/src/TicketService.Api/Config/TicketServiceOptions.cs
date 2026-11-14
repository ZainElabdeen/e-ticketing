namespace TicketService.Api.Config;

public sealed record TicketServiceOptions(
    int Port,
    string ConnectionString,
    string Schema,
    string PublicKey,
    string InternalKey,
    bool SwaggerEnabled,
    string LogLevel,
    int OrderTtlMinutes,
    int ExpiryIntervalSeconds,
    int ExpiryBatchSize,
    bool ExpiryEnabled);
