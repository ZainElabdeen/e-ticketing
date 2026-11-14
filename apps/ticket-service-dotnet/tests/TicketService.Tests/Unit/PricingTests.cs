using TicketService.Api.Domain;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
public sealed class PricingTests
{
    private static PricedLine Line(string code, int qty, long unit, string currency = "AED", long? total = null) =>
        new(code, Guid.NewGuid(), qty, unit, total ?? unit * qty, currency);

    [Fact]
    public void Sorts_ordinally_by_code()
    {
        var sorted = Pricing.SortLines(new[] { "VIP", "GOLD", "PREMIUM" }, c => c);

        Assert.Equal(["GOLD", "PREMIUM", "VIP"], sorted);
    }

    [Fact]
    public void Sort_does_not_change_the_input()
    {
        var input = new[] { "VIP", "GOLD" };

        Pricing.SortLines(input, c => c);

        Assert.Equal(["VIP", "GOLD"], input);
    }

    [Fact]
    public void Prices_gold_twice_and_vip_once_as_70000()
    {
        var (total, currency) = Pricing.Price([Line("GOLD", 2, 10000), Line("VIP", 1, 50000)]);

        Assert.Equal(70000, total);
        Assert.Equal("AED", currency);
    }

    [Fact]
    public void A_line_total_that_does_not_match_throws()
    {
        Assert.Throws<InvalidOperationException>(() =>
            Pricing.Price([Line("GOLD", 2, 10000, total: 19999)]));
    }

    [Fact]
    public void Mixed_currencies_throw()
    {
        Assert.Throws<InvalidOperationException>(() =>
            Pricing.Price([Line("GOLD", 1, 10000), Line("VIP", 1, 50000, "USD")]));
    }

    [Fact]
    public void No_lines_throw()
    {
        Assert.Throws<InvalidOperationException>(() => Pricing.Price([]));
    }
}
