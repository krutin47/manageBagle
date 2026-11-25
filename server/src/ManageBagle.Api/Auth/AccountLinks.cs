using System.Security.Claims;
using System.Text;
using ManageBagle.Api.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace ManageBagle.Api.Auth;

/// <summary>Builds the links that go out by email, and the short-lived tickets used to link an outside account.</summary>
public sealed class AccountLinks(IConfiguration config, IHttpContextAccessor http, IDataProtectionProvider protection)
{
    private readonly ITimeLimitedDataProtector _tickets = protection.CreateProtector("external-login-link").ToTimeLimitedDataProtector();
    private readonly ITimeLimitedDataProtector _mfaReset = protection.CreateProtector("mfa-reset").ToTimeLimitedDataProtector();

    /// <summary>
    /// Link tokens for the lost-second-factor flow. Bound to the account, the purpose ("confirm" or
    /// "cancel") and the security stamp, so a password change or a completed reset kills every older link.
    /// </summary>
    public string CreateMfaResetToken(AppUser user, string purpose, TimeSpan lifetime) =>
        AccountLinks.Encode(_mfaReset.Protect($"{user.Id}|{purpose}|{user.SecurityStamp}", lifetime));

    public bool TryReadMfaResetToken(string token, string purpose, out Guid userId, out string stamp)
    {
        userId = Guid.Empty;
        stamp = "";
        if (!TryDecode(token, out var raw)) return false;
        try
        {
            var parts = _mfaReset.Unprotect(raw).Split('|');
            if (parts.Length != 3 || parts[1] != purpose || !Guid.TryParse(parts[0], out userId)) return false;
            stamp = parts[2];
            return true;
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return false;
        }
    }

    /// <summary>Absolute URL on the public site. Prefers the configured address over whatever host the request claimed.</summary>
    public string Url(string path)
    {
        var configured = config["App:PublicUrl"]?.TrimEnd('/');
        if (!string.IsNullOrEmpty(configured)) return configured + path;
        var request = http.HttpContext!.Request;
        return $"{request.Scheme}://{request.Host}{path}";
    }

    public async Task SendConfirmationAsync(UserManager<AppUser> users, IAppEmailSender email, AppUser user)
    {
        var token = Encode(await users.GenerateEmailConfirmationTokenAsync(user));
        var (subject, body) = EmailTemplates.Confirm(user.DisplayName, Url($"/confirm-email?userId={user.Id}&token={token}"));
        await email.SendAsync(user.Email!, subject, body);
    }

    public static string Encode(string token) => WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

    public static bool TryDecode(string encoded, out string token)
    {
        try
        {
            token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(encoded));
            return true;
        }
        catch (FormatException)
        {
            token = "";
            return false;
        }
    }

    /// <summary>Issued only after the owner re-entered a password or code; valid for five minutes, for one account and one provider.</summary>
    public string CreateLinkTicket(Guid userId, string provider) => _tickets.Protect($"{userId}|{provider}", TimeSpan.FromMinutes(5));

    public bool IsValidLinkTicket(string ticket, ClaimsPrincipal principal, string provider)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return false;
        try
        {
            return _tickets.Unprotect(ticket) == $"{userId}|{provider}";
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return false; // expired, tampered with, or issued by another environment's keys
        }
    }
}

/// <summary>
/// Security-relevant account events. Each is written as a structured log line and as a row the owner
/// can see under Settings → Account activity. Written in its own unit of work, so recording an event
/// never commits or rolls back the request's other changes. Never includes credentials, codes, tokens
/// or email bodies.
/// </summary>
public static class Audit
{
    public static async Task RecordAsync(IEndpointRouteBuilder app, string eventName, Guid userId, string? detail = null)
    {
        app.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("ManageBagle.Audit")
            .LogInformation("audit {AuditEvent} user {UserId} {Detail}", eventName, userId, detail ?? "");
        using var scope = app.ServiceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.AuditEvents.Add(new AuditEvent
        {
            UserId = userId, Event = eventName, Detail = detail ?? "",
            At = scope.ServiceProvider.GetRequiredService<TimeProvider>().GetUtcNow(),
        });
        await db.SaveChangesAsync();
    }
}
