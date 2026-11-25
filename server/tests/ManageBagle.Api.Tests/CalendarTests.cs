using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ManageBagle.Api.Application.Calendars;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace ManageBagle.Api.Tests;

public class SafeFetchTests
{
    [Theory]
    [InlineData("https://calendar.google.com/calendar/ical/abc/private-xyz/basic.ics", true)]
    [InlineData("webcal://p01-caldav.icloud.com/published/2/abc", true)]
    [InlineData("http://calendar.example.com/cal.ics", false)]          // not encrypted
    [InlineData("https://user:pass@calendar.example.com/cal.ics", false)] // credentials in the address
    [InlineData("https://calendar.example.com:8443/cal.ics", false)]    // custom port
    [InlineData("https://127.0.0.1/cal.ics", false)]
    [InlineData("https://169.254.169.254/latest/meta-data", false)]     // cloud metadata
    [InlineData("https://[::1]/cal.ics", false)]
    [InlineData("https://10.0.0.7/cal.ics", false)]
    [InlineData("https://localhost/cal.ics", false)]
    [InlineData("https://db.internal/cal.ics", false)]
    [InlineData("ftp://example.com/cal.ics", false)]
    [InlineData("not a url", false)]
    public void Only_public_https_calendar_addresses_are_accepted(string url, bool ok) =>
        Assert.Equal(ok, SafeFetch.TryParseCalendarUrl(url, out _, out _));

    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("2001:4860:4860::8888", true)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.16.0.1", false)]
    [InlineData("172.31.255.255", false)]
    [InlineData("192.168.1.1", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("127.0.0.1", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("::ffff:10.0.0.1", false)] // a private IPv4 address hidden inside IPv6
    public void Private_and_special_addresses_are_never_fetched(string address, bool isPublic) =>
        Assert.Equal(isPublic, SafeFetch.IsPublic(IPAddress.Parse(address)));
}

public class IcsTests
{
    private static readonly TimeZoneInfo Halifax = TimeZoneInfo.FindSystemTimeZoneById("America/Halifax");

    private const string Sample = """
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:-//Test//EN
        BEGIN:VEVENT
        UID:weekly
        DTSTART;TZID=America/Halifax:20261102T100000
        DTEND;TZID=America/Halifax:20261102T110000
        RRULE:FREQ=WEEKLY;COUNT=10
        SUMMARY:Team sync
        END:VEVENT
        BEGIN:VEVENT
        UID:cancelled
        DTSTART:20261104T150000Z
        DTEND:20261104T160000Z
        STATUS:CANCELLED
        SUMMARY:Cancelled call
        END:VEVENT
        BEGIN:VEVENT
        UID:free
        DTSTART:20261104T170000Z
        DTEND:20261104T180000Z
        TRANSP:TRANSPARENT
        SUMMARY:Optional webinar
        END:VEVENT
        BEGIN:VEVENT
        UID:holiday
        DTSTART;VALUE=DATE:20261111
        DTEND;VALUE=DATE:20261112
        SUMMARY:Remembrance Day
        END:VEVENT
        BEGIN:VEVENT
        UID:floating
        DTSTART:20261105T090000
        DTEND:20261105T093000
        SUMMARY:Dentist
        END:VEVENT
        END:VCALENDAR
        """;

    [Fact]
    public void Recurring_meetings_are_expanded_and_free_cancelled_or_all_day_entries_skipped()
    {
        var from = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var busy = IcsReader.Busy(Sample, from, from.AddDays(21), Halifax);
        Assert.Equal(3, busy.Count(b => b.Title == "Team sync")); // Nov 2, 9, 16
        Assert.DoesNotContain(busy, b => b.Title is "Cancelled call" or "Optional webinar" or "Remembrance Day");
        // 10:00 in Halifax: daylight time on Nov 2? No — Halifax falls back on Nov 1, so it is UTC−4 → 14:00Z.
        Assert.Equal(new DateTimeOffset(2026, 11, 2, 14, 0, 0, TimeSpan.Zero), busy.First(b => b.Title == "Team sync").StartUtc);
        // A time with no zone is read in the account's zone.
        Assert.Equal(new DateTimeOffset(2026, 11, 5, 13, 0, 0, TimeSpan.Zero), busy.Single(b => b.Title == "Dentist").StartUtc);
    }

    [Fact]
    public void Garbage_is_refused_not_half_read()
    {
        Assert.ThrowsAny<Exception>(() => IcsReader.Busy("<html>Sign in to Google</html>", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddDays(1), null));
    }

    [Fact]
    public void The_feed_escapes_text_folds_long_lines_and_uses_utc_for_zoned_blocks()
    {
        var block = new TimeBlock { Id = Guid.NewGuid(), Title = "Review Q4; budget, plans\nand notes " + new string('x', 120), Status = ItemStatus.Done };
        block.Schedule(new DateOnly(2026, 11, 26), new TimeOnly(9, 0), new TimeOnly(10, 30), "America/Halifax");
        block.Notes = "PRIVATE NOTE";
        var ics = IcsWriter.Write([block], DateTimeOffset.UtcNow);

        Assert.Contains("DTSTART:20261126T130000Z", ics);
        Assert.Contains("DTEND:20261126T143000Z", ics);
        Assert.Contains(@"Review Q4\; budget\, plans\nand notes", ics.Replace("\r\n ", ""));
        Assert.DoesNotContain("PRIVATE NOTE", ics);
        Assert.All(ics.Split("\r\n"), line => Assert.True(Encoding.UTF8.GetByteCount(line) <= 75, line));
        Assert.Contains("✓ Review", ics.Replace("\r\n ", ""));
    }
}

/// <summary>The real app, with a stand-in for the internet: calendar addresses answer what the test says.</summary>
public sealed class CalendarFactory : ApiFactory
{
    public ConcurrentDictionary<string, (HttpStatusCode Status, string Body)> Calendars { get; } = new();
    public ConcurrentDictionary<string, int> Fetches { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
            services.AddHttpClient(SafeFetch.ClientName).ConfigurePrimaryHttpMessageHandler(() => new StubHandler(this)));
    }

    private sealed class StubHandler(CalendarFactory f) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            f.Fetches.AddOrUpdate(url, 1, (_, n) => n + 1);
            var (status, body) = f.Calendars.TryGetValue(url, out var r) ? r : (HttpStatusCode.NotFound, "");
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "text/calendar") });
        }
    }
}

public class CalendarTests(CalendarFactory factory) : IClassFixture<CalendarFactory>
{
    private static readonly string Day = DateTime.UtcNow.AddDays(7).ToString("yyyy-MM-dd");

    /// <summary>A meeting from 10:00 to 11:00 Halifax time, a week from now.</summary>
    private static string MeetingIcs(string title = "Client call") => $"""
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:-//Test//EN
        BEGIN:VEVENT
        UID:{Guid.NewGuid()}
        DTSTART;TZID=America/Halifax:{Day.Replace("-", "")}T100000
        DTEND;TZID=America/Halifax:{Day.Replace("-", "")}T110000
        SUMMARY:{title}
        END:VEVENT
        END:VCALENDAR
        """;

    private string NewCalendar(string body, HttpStatusCode status = HttpStatusCode.OK)
    {
        var url = $"https://calendar.example.com/{Guid.NewGuid():N}/basic.ics";
        factory.Calendars[url] = (status, body);
        return url;
    }

    private static object Plan(string start, string end) => new { items = new[] { new { title = "Deep work", estimatedMinutes = 60, workMode = "DeepFocus", priority = "Low", start, end } } };

    [Fact]
    public async Task A_connected_calendar_shows_as_busy_and_the_plan_works_around_it()
    {
        var (client, _) = await factory.NewUserAsync(timeZone: "America/Halifax");
        var url = NewCalendar(MeetingIcs());
        var connected = await client.PostAsJsonAsync("/api/calendar/connections", new { name = "Work", url });
        Assert.Equal(HttpStatusCode.Created, connected.StatusCode);
        var body = await connected.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, body.GetProperty("eventCount").GetInt32());
        Assert.Equal("calendar.example.com", body.GetProperty("host").GetString());
        Assert.False(body.TryGetProperty("url", out _)); // the secret address is never sent back

        var commitments = await client.GetFromJsonAsync<JsonElement>($"/api/commitments?from={Day}&to={Day}");
        var meeting = commitments.EnumerateArray().Single(c => c.GetProperty("kind").GetString() == "event");
        Assert.Equal("Client call", meeting.GetProperty("title").GetString());
        Assert.Equal("10:00:00", meeting.GetProperty("start").GetString());
        Assert.Equal(60, meeting.GetProperty("minutes").GetInt32());

        var clash = await client.PostAsJsonAsync($"/api/days/{Day}/plan", Plan("10:30:00", "11:30:00"));
        Assert.Equal(HttpStatusCode.Conflict, clash.StatusCode);
        Assert.Contains("Client call", (await clash.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/days/{Day}/plan", Plan("11:00:00", "12:00:00"))).StatusCode);
    }

    [Fact]
    public async Task Bad_addresses_are_explained_and_nothing_is_saved()
    {
        var (client, _) = await factory.NewUserAsync();
        async Task<string> Refused(string url)
        {
            var r = await client.PostAsJsonAsync("/api/calendar/connections", new { url });
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").GetProperty("url")[0].GetString()!;
        }
        Assert.Contains("https://", await Refused("http://calendar.example.com/a.ics"));
        Assert.Contains("private network", await Refused("https://169.254.169.254/latest/meta-data"));
        Assert.Contains("refused", await Refused(NewCalendar("", HttpStatusCode.NotFound)));
        Assert.Contains("iCal", await Refused(NewCalendar("<html>Sign in</html>")));
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/calendar/connections")).GetArrayLength());
    }

    [Fact]
    public async Task Calendars_are_re_read_at_most_every_15_minutes_unless_forced()
    {
        var (client, _) = await factory.NewUserAsync();
        var url = NewCalendar(MeetingIcs());
        await client.PostAsJsonAsync("/api/calendar/connections", new { url });
        await client.PostAsync("/api/calendar/connections/refresh", null);
        await client.PostAsync("/api/calendar/connections/refresh", null);
        Assert.Equal(1, factory.Fetches[url]);

        factory.Calendars[url] = (HttpStatusCode.OK, MeetingIcs("Moved call"));
        var forced = await (await client.PostAsync("/api/calendar/connections/refresh?force=true", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, factory.Fetches[url]);
        Assert.Equal("", forced[0].GetProperty("lastError").GetString());
        var titles = (await client.GetFromJsonAsync<JsonElement>($"/api/commitments?from={Day}&to={Day}")).EnumerateArray().Select(c => c.GetProperty("title").GetString());
        Assert.Contains("Moved call", titles);

        // When the calendar stops answering, the last known events stay and the reason is shown.
        factory.Calendars[url] = (HttpStatusCode.Forbidden, "");
        var failed = await (await client.PostAsync("/api/calendar/connections/refresh?force=true", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("refused", failed[0].GetProperty("lastError").GetString());
        Assert.Equal(1, failed[0].GetProperty("eventCount").GetInt32());
    }

    [Fact]
    public async Task The_subscription_link_serves_the_plan_and_regenerating_it_kills_the_old_one()
    {
        var (client, _) = await factory.NewUserAsync(timeZone: "America/Halifax");
        await client.PostAsJsonAsync("/api/blocks", new { date = Day, start = "14:00:00", end = "15:00:00", title = "Write proposal", priority = "High", workMode = "DeepFocus", status = "Planned", notes = "secret note" });
        var feed = await client.GetFromJsonAsync<JsonElement>("/api/calendar/feed");
        var url = new Uri(feed.GetProperty("url").GetString()!);
        Assert.StartsWith("webcal://", feed.GetProperty("webcalUrl").GetString());
        Assert.Equal(url, new Uri((await client.GetFromJsonAsync<JsonElement>("/api/calendar/feed")).GetProperty("url").GetString()!)); // stable

        var calendarApp = factory.NewClient(likeTheApp: false); // no cookie: the link is the credential
        var ics = await calendarApp.GetAsync(url.PathAndQuery);
        Assert.Equal(HttpStatusCode.OK, ics.StatusCode);
        Assert.Equal("text/calendar", ics.Content.Headers.ContentType!.MediaType);
        var text = await ics.Content.ReadAsStringAsync();
        Assert.Contains("SUMMARY:Write proposal", text);
        Assert.Contains("T180000Z", text); // 14:00 Halifax
        Assert.DoesNotContain("secret note", text);

        await client.PostAsync("/api/calendar/feed/regenerate", null);
        Assert.Equal(HttpStatusCode.NotFound, (await calendarApp.GetAsync(url.PathAndQuery)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await calendarApp.GetAsync("/api/calendar/feed/guessing-is-pointless-guessing-is-pointless.ics")).StatusCode);

        var download = await client.GetAsync($"/api/calendar/export.ics?from={Day}&to={Day}");
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
    }

    [Fact]
    public async Task Connected_calendars_belong_to_their_owner()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        var created = await (await alice.PostAsJsonAsync("/api/calendar/connections", new { url = NewCalendar(MeetingIcs("Alice's interview")) })).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/calendar/connections")).GetArrayLength());
        Assert.DoesNotContain("Alice's interview", await bob.GetStringAsync($"/api/commitments?from={Day}&to={Day}"));
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/calendar/connections/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/calendar/connections/{id}")).StatusCode);
        Assert.DoesNotContain("Alice's interview", await alice.GetStringAsync($"/api/commitments?from={Day}&to={Day}"));
    }
}
