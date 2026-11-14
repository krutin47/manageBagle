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
/// Security-relevant account events, written as structured log entries (event name, account id, optional
/// detail such as the provider). Never includes credentials, codes, tokens or email bodies.
/// </summary>
public static class Audit
{
    public static void Log(IEndpointRouteBuilder app, string eventName, Guid userId, string? detail = null) =>
        app.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("ManageBagle.Audit")
            .LogInformation("audit {AuditEvent} user {UserId} {Detail}", eventName, userId, detail ?? "");
}
