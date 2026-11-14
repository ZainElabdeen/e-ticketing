using Npgsql;

namespace TicketService.Api.Infrastructure;

public static class PostgresErrors
{
    private const string UniqueViolation = "23505";

    /// <summary>True when the exception, or one it wraps, is a unique violation of exactly this constraint.</summary>
    public static bool IsUniqueViolation(Exception e, string constraint)
    {
        for (var current = e; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: UniqueViolation } pg
                && string.Equals(pg.ConstraintName, constraint, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }
}
