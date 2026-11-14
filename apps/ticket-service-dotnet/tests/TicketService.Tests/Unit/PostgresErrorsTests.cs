using Npgsql;
using TicketService.Api.Infrastructure;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
public sealed class PostgresErrorsTests
{
    private static PostgresException Pg(string sqlState, string? constraint) =>
        new("boom", "ERROR", "ERROR", sqlState, constraintName: constraint);

    [Fact]
    public void Matches_a_unique_violation_on_the_named_constraint() =>
        Assert.True(PostgresErrors.IsUniqueViolation(Pg("23505", "orders_paid_transaction_id_key"), "orders_paid_transaction_id_key"));

    [Fact]
    public void Walks_inner_exceptions() =>
        Assert.True(PostgresErrors.IsUniqueViolation(
            new InvalidOperationException("outer", new Exception("mid", Pg("23505", "k"))), "k"));

    [Fact]
    public void Rejects_another_constraint_or_another_sqlstate()
    {
        Assert.False(PostgresErrors.IsUniqueViolation(Pg("23505", "other"), "k"));
        Assert.False(PostgresErrors.IsUniqueViolation(Pg("23514", "k"), "k"));
        Assert.False(PostgresErrors.IsUniqueViolation(new Exception("x"), "k"));
    }
}
