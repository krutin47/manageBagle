using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.HttpOverrides;

namespace ManageBagle.Api.Infrastructure;

public static class SecurityMiddleware
{
    public const string ClientHeader = "X-MB-Client";
    public const string CsrfHeader = "X-CSRF-TOKEN";

    public static IServiceCollection AddCsrfProtection(this IServiceCollection services, bool secureCookies)
    {
        services.AddAntiforgery(o =>
        {
            o.HeaderName = CsrfHeader;
            o.Cookie.Name = "mb.csrf";
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        });
        return services;
    }

    /// <summary>
    /// Cross-site request forgery defence for the cookie-authenticated API. A state-changing request
    /// must pass three independent checks:
    ///   1. it carries the app's custom header (a plain HTML form cannot add one);
    ///   2. its Origin, when the browser sends one, is this site;
    ///   3. it carries an antiforgery token that is tied to this browser's cookie and to the signed-in
    ///      account — a secret an attacker's page cannot read.
    /// Must run after authentication, because the token is bound to the user.
    /// </summary>
    public static IApplicationBuilder UseCsrfProtection(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        var method = http.Request.Method;
        var unsafeMethod = !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method));
        if (!unsafeMethod || !http.Request.Path.StartsWithSegments("/api"))
        {
            await next();
            return;
        }

        if (!http.Request.Headers.ContainsKey(ClientHeader))
        {
            await Reject(http, StatusCodes.Status400BadRequest, ErrorCodes.ClientHeaderMissing, "This request did not come from the manageBagle app.");
            return;
        }

        var origin = http.Request.Headers.Origin.ToString();
        if (origin.Length > 0 && !IsOwnOrigin(http, origin))
        {
            await Reject(http, StatusCodes.Status403Forbidden, ErrorCodes.OriginRejected, "This request came from another site.");
            return;
        }

        if (!await http.RequestServices.GetRequiredService<IAntiforgery>().IsRequestValidAsync(http))
        {
            await Reject(http, StatusCodes.Status400BadRequest, ErrorCodes.CsrfInvalid, "Your session token is out of date. Reload the page and try again.");
            return;
        }

        await next();
    });

    private static bool IsOwnOrigin(HttpContext http, string origin)
    {
        var own = $"{http.Request.Scheme}://{http.Request.Host}";
        if (string.Equals(origin, own, StringComparison.OrdinalIgnoreCase)) return true;
        var allowed = http.RequestServices.GetRequiredService<IConfiguration>().GetSection("Security:AllowedOrigins").Get<string[]>() ?? [];
        return allowed.Contains(origin, StringComparer.OrdinalIgnoreCase);
    }

    private static Task Reject(HttpContext http, int status, string code, string detail) =>
        HttpExtensions.Problem(status, code, detail).ExecuteAsync(http);

    /// <summary>
    /// Trust X-Forwarded-* only from the ingress in front of the app. Loopback is trusted by default;
    /// add the platform's proxy addresses or networks in configuration. Trusting every sender would let
    /// anyone forge their IP (defeating rate limits) and the request scheme.
    /// </summary>
    public static void ConfigureForwardedHeaders(ForwardedHeadersOptions options, IConfiguration config)
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = config.GetValue("ForwardedHeaders:ForwardLimit", 1);
        foreach (var proxy in ReadList(config, "ForwardedHeaders:KnownProxies"))
        {
            options.KnownProxies.Add(System.Net.IPAddress.Parse(proxy));
        }
        foreach (var network in ReadList(config, "ForwardedHeaders:KnownNetworks"))
        {
            options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        }
    }

    /// <summary>Accepts either a JSON array or one comma-separated value (convenient as an environment variable).</summary>
    private static IEnumerable<string> ReadList(IConfiguration config, string key)
    {
        var section = config.GetSection(key);
        var items = section.Get<string[]>() ?? section.Value?.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) ?? [];
        return items.Where(i => !string.IsNullOrWhiteSpace(i));
    }

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        var h = ctx.Response.Headers;
        h.XContentTypeOptions = "nosniff";
        h.XFrameOptions = "DENY";
        h["Referrer-Policy"] = "strict-origin-when-cross-origin";
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        h.ContentSecurityPolicy =
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
        if (ctx.Request.Path.StartsWithSegments("/api"))
        {
            h.CacheControl = "no-store";
        }
        await next();
    });
}
