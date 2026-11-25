using System.Net;
using System.Net.Sockets;

namespace ManageBagle.Api.Infrastructure;

/// <summary>
/// Fetching addresses that people type in is a server-side request forgery risk: a URL could point at
/// this server's own network (databases, cloud metadata at 169.254.169.254). These rules keep the
/// calendar reader on the public internet (ADR-015).
/// </summary>
public static class SafeFetch
{
    public const string ClientName = "calendar-fetch";
    public const int MaxBytes = 2 * 1024 * 1024;

    /// <summary>Accepts https:// and webcal:// (read as https) on the default port, without credentials.</summary>
    public static bool TryParseCalendarUrl(string? text, out Uri uri, out string error)
    {
        uri = null!;
        error = "";
        var raw = text?.Trim() ?? "";
        if (raw.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase)) raw = "https://" + raw["webcal://".Length..];
        if (raw.Length > 2000 || !Uri.TryCreate(raw, UriKind.Absolute, out var parsed)) { error = "That is not a web address."; return false; }
        if (parsed.Scheme != Uri.UriSchemeHttps) { error = "Use the https:// (or webcal://) address of the calendar."; return false; }
        if (!string.IsNullOrEmpty(parsed.UserInfo)) { error = "Remove the user name and password from the address."; return false; }
        if (!parsed.IsDefaultPort) { error = "Calendar addresses with a custom port are not supported."; return false; }
        if (IPAddress.TryParse(parsed.IdnHost, out var literal) && !IsPublic(literal)) { error = "That address points to a private network."; return false; }
        if (parsed.IdnHost.Equals("localhost", StringComparison.OrdinalIgnoreCase) || parsed.IdnHost.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || parsed.IdnHost.EndsWith(".internal", StringComparison.OrdinalIgnoreCase))
        {
            error = "That address points to a private network.";
            return false;
        }
        uri = parsed;
        return true;
    }

    /// <summary>True only for addresses on the public internet.</summary>
    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any) || address.Equals(IPAddress.Broadcast)) return false;
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast || address.IsIPv6UniqueLocal) return false;
            return true;
        }
        var b = address.GetAddressBytes();
        return !(b[0] == 10                                    // 10.0.0.0/8
            || b[0] == 0                                       // 0.0.0.0/8
            || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)      // 100.64.0.0/10 carrier-grade NAT
            || b[0] == 127                                     // loopback
            || (b[0] == 169 && b[1] == 254)                    // link-local, cloud metadata
            || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)       // 172.16.0.0/12
            || (b[0] == 192 && b[1] == 168)                    // 192.168.0.0/16
            || (b[0] == 192 && b[1] == 0 && b[2] == 0)         // 192.0.0.0/24
            || (b[0] == 198 && (b[1] == 18 || b[1] == 19))     // benchmarking
            || b[0] >= 224);                                   // multicast and reserved
    }

    /// <summary>
    /// The handler for calendar fetches. The address is checked again at connect time, after DNS, so a
    /// public name that resolves to a private address (DNS rebinding) is refused too. No proxy, no
    /// redirects, short timeouts.
    /// </summary>
    public static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        UseCookies = false,
        ConnectTimeout = TimeSpan.FromSeconds(5),
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        ConnectCallback = async (context, ct) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
            var target = addresses.FirstOrDefault(IsPublic)
                ?? throw new HttpRequestException("The calendar address does not resolve to a public internet address.");
            if (addresses.Any(a => !IsPublic(a))) throw new HttpRequestException("The calendar address resolves to a private network.");
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(target, context.DnsEndPoint.Port), ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };

    /// <summary>Reads at most <see cref="MaxBytes"/>; a larger calendar is refused rather than truncated.</summary>
    public static async Task<string> ReadCalendarAsync(HttpClient client, Uri uri, CancellationToken ct)
    {
        using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
        if ((int)response.StatusCode is >= 300 and < 400) throw new HttpRequestException("The calendar address redirects elsewhere. Use the final address.");
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > MaxBytes) throw new HttpRequestException("That calendar is too large to read (over 2 MB).");
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var buffer = new byte[MaxBytes + 1];
        var total = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer.AsMemory(total, buffer.Length - total), ct)) > 0)
        {
            total += read;
            if (total > MaxBytes) throw new HttpRequestException("That calendar is too large to read (over 2 MB).");
        }
        return System.Text.Encoding.UTF8.GetString(buffer, 0, total);
    }
}
