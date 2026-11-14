namespace ManageBagle.Api.Infrastructure;

public static class SecurityMiddleware
{
    public const string ClientHeader = "X-MB-Client";

    /// <summary>
    /// CSRF defence for the cookie-authenticated API: state-changing requests must carry a custom
    /// header. Browsers will not attach custom headers to cross-site requests without a CORS
    /// preflight, and this API enables no CORS origins.
    /// </summary>
    public static IApplicationBuilder UseClientHeaderCheck(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        var method = ctx.Request.Method;
        var unsafeMethod = !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method));
        if (unsafeMethod && ctx.Request.Path.StartsWithSegments("/api") && !ctx.Request.Headers.ContainsKey(ClientHeader))
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            await ctx.Response.WriteAsJsonAsync(new { title = "Missing client header.", status = 400 });
            return;
        }
        await next();
    });

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
