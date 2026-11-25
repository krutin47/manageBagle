using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using ManageBagle.Api.Infrastructure;

namespace ManageBagle.Api.Tests;

/// <summary>The time rules of ADR-008, exercised in America/Halifax (clocks change at 02:00).</summary>
public class CivilTimeTests
{
    private static readonly TimeZoneInfo Halifax = TimeZoneInfo.FindSystemTimeZoneById("America/Halifax");
    private static readonly DateOnly SpringForward = new(2026, 3, 8);  // 02:00 → 03:00
    private static readonly DateOnly FallBack = new(2026, 11, 1);      // 02:00 → 01:00

    private static CivilTime.Span Measure(DateOnly date, string start, string end, TimeZoneInfo? zone = null) =>
        CivilTime.Measure(date, TimeOnly.Parse(start), TimeOnly.Parse(end), zone ?? Halifax);

    [Fact]
    public void An_ordinary_overnight_block_is_90_minutes_and_ends_on_the_next_date()
    {
        var span = Assert.IsType<CivilTime.Span.Ok>(Measure(new DateOnly(2026, 11, 16), "23:30", "01:00"));
        Assert.Equal(90, span.Minutes);
        Assert.Equal(17, span.EndUtc!.Value.ToOffset(Halifax.GetUtcOffset(span.EndUtc.Value)).Day);
    }

    [Theory]
    [InlineData(2026, 1, 31, "23:30", "00:30")]  // month end
    [InlineData(2026, 12, 31, "23:30", "00:30")] // year end
    public void A_block_can_cross_month_and_year_ends(int y, int m, int d, string start, string end) =>
        Assert.Equal(60, Assert.IsType<CivilTime.Span.Ok>(Measure(new DateOnly(y, m, d), start, end)).Minutes);

    [Fact]
    public void A_start_inside_the_spring_forward_gap_is_rejected_with_the_next_real_time()
    {
        var gap = Assert.IsType<CivilTime.Span.Nonexistent>(Measure(SpringForward, "02:30", "04:00"));
        Assert.Equal("start", gap.Field);
        Assert.Equal(new TimeOnly(3, 0), gap.NextValidTime);
    }

    [Fact]
    public void An_end_inside_the_gap_is_rejected_too()
    {
        var gap = Assert.IsType<CivilTime.Span.Nonexistent>(Measure(SpringForward, "01:00", "02:30"));
        Assert.Equal("end", gap.Field);
    }

    [Fact]
    public void A_block_across_spring_forward_is_as_long_as_it_really_lasts()
    {
        // 01:00 → 04:00 on the clock face is three hours, but one of them never happens.
        Assert.Equal(120, Assert.IsType<CivilTime.Span.Ok>(Measure(SpringForward, "01:00", "04:00")).Minutes);
    }

    [Fact]
    public void A_block_across_fall_back_includes_the_repeated_hour()
    {
        Assert.Equal(240, Assert.IsType<CivilTime.Span.Ok>(Measure(FallBack, "00:00", "03:00")).Minutes);
    }

    [Fact]
    public void An_ambiguous_time_means_its_first_occurrence()
    {
        // 01:30 happens twice on fall-back night. The first is still on daylight time (UTC−3).
        var first = CivilTime.Resolve(FallBack, new TimeOnly(1, 30), Halifax);
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 4, 30, 0, TimeSpan.Zero), first.Instant);
    }

    [Fact]
    public void Without_a_zone_only_the_wall_clock_is_used()
    {
        var span = Assert.IsType<CivilTime.Span.Ok>(CivilTime.Measure(SpringForward, new TimeOnly(1, 0), new TimeOnly(4, 0), zone: null));
        Assert.Equal(180, span.Minutes);
        Assert.Null(span.StartUtc);
    }

    [Fact]
    public void A_block_keeps_its_zone_so_it_does_not_jump_when_the_person_travels()
    {
        var block = new TimeBlock();
        Assert.Null(block.Schedule(new DateOnly(2026, 6, 1), new TimeOnly(9, 0), new TimeOnly(10, 0), "America/Halifax"));
        // The account later moves to London; the stored block is untouched: still 09:00 Halifax.
        Assert.Equal("America/Halifax", block.TimeZoneId);
        Assert.Equal(new TimeOnly(9, 0), block.Start);
    }

    [Theory]
    [InlineData("America/Halifax", "America/Halifax")]
    [InlineData("Europe/London", "Europe/London")]
    [InlineData("Not/AZone", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Only_real_IANA_zones_are_accepted(string? input, string? expected) => Assert.Equal(expected, TimeZones.Normalize(input));
}

public class TaskCompletionTests
{
    [Fact]
    public void Finishing_the_only_session_finishes_the_task() =>
        Assert.Equal(ItemStatus.Done, TaskCompletion.AfterSessionFinished(ItemStatus.Planned, []));

    [Fact]
    public void Finishing_one_of_several_sessions_leaves_the_task_in_progress() =>
        Assert.Equal(ItemStatus.InProgress, TaskCompletion.AfterSessionFinished(ItemStatus.Planned, [ItemStatus.Planned, ItemStatus.Done]));

    [Fact]
    public void Skipped_and_done_sessions_do_not_hold_a_task_open() =>
        Assert.Equal(ItemStatus.Done, TaskCompletion.AfterSessionFinished(ItemStatus.InProgress, [ItemStatus.Done, ItemStatus.Skipped]));
}

public class ForwardedHeadersTests
{
    private static ForwardedHeadersOptions Configure(Dictionary<string, string?> settings)
    {
        var options = new ForwardedHeadersOptions();
        SecurityMiddleware.ConfigureForwardedHeaders(options, new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        return options;
    }

    [Fact]
    public void By_default_only_loopback_is_trusted_and_one_hop_is_read()
    {
        var options = Configure([]);
        Assert.Equal(1, options.ForwardLimit);
        Assert.All(options.KnownProxies, p => Assert.True(System.Net.IPAddress.IsLoopback(p)));
        Assert.All(options.KnownIPNetworks, n => Assert.True(System.Net.IPAddress.IsLoopback(n.BaseAddress)));
    }

    [Fact]
    public void Configured_proxies_and_networks_are_added_not_substituted_for_trust_everyone()
    {
        var options = Configure(new() { ["ForwardedHeaders:KnownProxies"] = "10.0.0.5", ["ForwardedHeaders:KnownNetworks"] = "10.1.0.0/16, 172.16.0.0/12" });
        Assert.Contains(System.Net.IPAddress.Parse("10.0.0.5"), options.KnownProxies);
        Assert.Contains(options.KnownIPNetworks, n => n.ToString() == "10.1.0.0/16");
        Assert.Contains(options.KnownIPNetworks, n => n.ToString() == "172.16.0.0/12");
        Assert.DoesNotContain(options.KnownIPNetworks, n => n.PrefixLength == 0); // never "the whole internet"
    }
}

/// <summary>Dependency rule: the domain knows nothing about HTTP, the database or the identity system.</summary>
public class ArchitectureTests
{
    [Fact]
    public void Domain_types_do_not_depend_on_web_or_persistence_frameworks()
    {
        var forbidden = new[] { "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore", "Npgsql", "ManageBagle.Api.Features", "ManageBagle.Api.Auth", "ManageBagle.Api.Infrastructure" };
        var domainTypes = typeof(CivilTime).Assembly.GetTypes().Where(t => t.Namespace == "ManageBagle.Api.Domain");
        var offenders =
            from type in domainTypes
            from member in type.GetMembers(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly)
            from used in TypesUsedBy(member)
            where used.Namespace is { } ns && forbidden.Any(ns.StartsWith)
            select $"{type.Name}.{member.Name} uses {used.FullName}";
        Assert.Empty(offenders);
    }

    [Fact]
    public void Use_cases_do_not_depend_on_http_or_on_endpoint_code()
    {
        var forbidden = new[] { "Microsoft.AspNetCore.Http", "Microsoft.AspNetCore.Mvc", "Microsoft.AspNetCore.Builder", "ManageBagle.Api.Features", "ManageBagle.Api.Infrastructure" };
        var types = typeof(CivilTime).Assembly.GetTypes().Where(t => t.Namespace?.StartsWith("ManageBagle.Api.Application") == true);
        var offenders =
            from type in types
            from member in type.GetMembers(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly)
            from used in TypesUsedBy(member)
            where used.Namespace is { } ns && forbidden.Any(ns.StartsWith)
            select $"{type.Name}.{member.Name} uses {used.FullName}";
        Assert.Empty(offenders);
        Assert.NotEmpty(types);
    }

    private static IEnumerable<Type> TypesUsedBy(System.Reflection.MemberInfo member) => member switch
    {
        System.Reflection.MethodInfo m => m.GetParameters().Select(p => p.ParameterType).Append(m.ReturnType),
        System.Reflection.PropertyInfo p => [p.PropertyType],
        System.Reflection.FieldInfo f => [f.FieldType],
        System.Reflection.ConstructorInfo c => c.GetParameters().Select(p => p.ParameterType),
        _ => [],
    };
}
