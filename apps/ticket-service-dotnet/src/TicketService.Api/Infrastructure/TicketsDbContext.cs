using Microsoft.EntityFrameworkCore;

namespace TicketService.Api.Infrastructure;

/// <summary>
/// Maps the hand-written `tickets` schema (ADR-0015). The schema is owned by SQL migrations: no
/// EF migrations, no EnsureCreated. Reads are untracked.
/// </summary>
public sealed class TicketsDbContext : DbContext
{
    public const string Schema = "tickets";

    public TicketsDbContext(DbContextOptions<TicketsDbContext> options)
        : base(options)
    {
        ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
    }

    public DbSet<TicketTypeEntity> TicketTypes => Set<TicketTypeEntity>();
    public DbSet<OrderEntity> Orders => Set<OrderEntity>();
    public DbSet<OrderItemEntity> OrderItems => Set<OrderItemEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<TicketTypeEntity>(e =>
        {
            e.ToTable("ticket_types");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            e.Property(x => x.Code).HasColumnName("code").HasColumnType("text");
            e.Property(x => x.Name).HasColumnName("name").HasColumnType("text");
            e.Property(x => x.PriceMinor).HasColumnName("price_minor").HasColumnType("bigint");
            e.Property(x => x.Currency).HasColumnName("currency").HasColumnType("char(3)");
            e.Property(x => x.Quota).HasColumnName("quota").HasColumnType("integer");
            e.Property(x => x.Sold).HasColumnName("sold").HasColumnType("integer");
            e.Property(x => x.Reserved).HasColumnName("reserved").HasColumnType("integer");
        });

        modelBuilder.Entity<OrderEntity>(e =>
        {
            e.ToTable("orders");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            e.Property(x => x.Status).HasColumnName("status").HasColumnType("text");
            e.Property(x => x.TotalMinor).HasColumnName("total_minor").HasColumnType("bigint");
            e.Property(x => x.Currency).HasColumnName("currency").HasColumnType("char(3)");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz");
            e.Property(x => x.ExpiresAt).HasColumnName("expires_at").HasColumnType("timestamptz");
            e.Property(x => x.ConfirmedAt).HasColumnName("confirmed_at").HasColumnType("timestamptz");
            e.Property(x => x.PaidTransactionId).HasColumnName("paid_transaction_id").HasColumnType("uuid");
            e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.OrderId);
        });

        modelBuilder.Entity<OrderItemEntity>(e =>
        {
            e.ToTable("order_items");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            e.Property(x => x.OrderId).HasColumnName("order_id").HasColumnType("uuid");
            e.Property(x => x.TicketTypeId).HasColumnName("ticket_type_id").HasColumnType("uuid");
            e.Property(x => x.Quantity).HasColumnName("quantity").HasColumnType("integer");
            e.Property(x => x.UnitPriceMinor).HasColumnName("unit_price_minor").HasColumnType("bigint");
            e.Property(x => x.LineTotalMinor).HasColumnName("line_total_minor").HasColumnType("bigint");
        });
    }
}
