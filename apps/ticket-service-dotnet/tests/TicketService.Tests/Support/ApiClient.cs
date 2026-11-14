using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Npgsql;

namespace TicketService.Tests.Support;

public static class ApiClient
{
    public static async Task<(int Status, JsonElement Body)> SendAsync(
        HttpClient client, HttpMethod method, string path, string key, string? json = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Api-Key", key);
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        using var response = await client.SendAsync(request);
        var raw = await response.Content.ReadAsStringAsync();
        return ((int)response.StatusCode, JsonDocument.Parse(raw).RootElement.Clone());
    }

    public static string OrderJson(params (string Code, int Qty)[] items) =>
        JsonSerializer.Serialize(new
        {
            items = items.Select(i => new { ticketTypeCode = i.Code, quantity = i.Qty }),
        });

    public static async Task ExecuteAsync(PostgresFixture db, string sql)
    {
        await using var connection = await db.OpenAsync("tickets_owner");
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public static Task ResetTicketTypesAsync(PostgresFixture db) => ExecuteAsync(db,
        """
        UPDATE tickets.ticket_types SET quota = 100, sold = 0, reserved = 0,
          price_minor = CASE code WHEN 'GOLD' THEN 10000 WHEN 'PREMIUM' THEN 20000 ELSE 50000 END
        """);

    public static Task ResetAllAsync(PostgresFixture db) => ExecuteAsync(db,
        """
        DELETE FROM tickets.order_items;
        DELETE FROM tickets.orders;
        UPDATE tickets.ticket_types SET quota = 100, sold = 0, reserved = 0,
          price_minor = CASE code WHEN 'GOLD' THEN 10000 WHEN 'PREMIUM' THEN 20000 ELSE 50000 END;
        """);

    public static async Task<(int Sold, int Reserved)> CountsAsync(PostgresFixture db, string code)
    {
        await using var connection = await db.OpenAsync("tickets_owner");
        await using var command = new NpgsqlCommand("SELECT sold, reserved FROM tickets.ticket_types WHERE code = @c", connection);
        command.Parameters.AddWithValue("c", code);
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return (reader.GetInt32(0), reader.GetInt32(1));
    }

    public static async Task<string> OrderStatusAsync(PostgresFixture db, string id)
    {
        await using var connection = await db.OpenAsync("tickets_owner");
        await using var command = new NpgsqlCommand("SELECT status FROM tickets.orders WHERE id = @id", connection);
        command.Parameters.AddWithValue("id", Guid.Parse(id));
        return (string)(await command.ExecuteScalarAsync())!;
    }

    public static Task MakeDueAsync(PostgresFixture db, params string[] ids) => ExecuteAsync(db,
        $"UPDATE tickets.orders SET expires_at = now() - interval '1 minute' WHERE id IN ({string.Join(",", ids.Select(i => $"'{Guid.Parse(i)}'"))})");
}
