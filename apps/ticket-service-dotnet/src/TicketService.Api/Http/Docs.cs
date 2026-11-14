using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace TicketService.Api.Http;

public static class Docs
{
    private static readonly string SpecFile = Path.Combine(AppContext.BaseDirectory, "openapi.json");

    /// <summary>Serves the bundled contract and Swagger UI at /docs, with no API key. Must precede the key middleware.</summary>
    public static void UseDocs(this WebApplication app, bool enabled)
    {
        if (!enabled)
        {
            return;
        }
        app.Use(async (context, next) =>
        {
            if (HttpMethods.IsGet(context.Request.Method)
                && string.Equals(context.Request.Path.Value, "/docs/openapi.json", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.ContentType = "application/json; charset=utf-8";
                await context.Response.SendFileAsync(SpecFile);
                return;
            }
            await next(context);
        });
        app.UseSwaggerUI(options =>
        {
            options.SwaggerEndpoint("/docs/openapi.json", "Ticket Service");
            options.RoutePrefix = "docs";
        });
    }
}
