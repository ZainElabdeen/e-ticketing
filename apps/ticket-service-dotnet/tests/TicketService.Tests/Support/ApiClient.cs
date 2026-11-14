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
}
