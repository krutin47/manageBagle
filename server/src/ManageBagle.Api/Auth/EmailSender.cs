using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace ManageBagle.Api.Auth;

public class SmtpOptions
{
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public bool UseTls { get; set; } = true;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string From { get; set; } = "no-reply@managebagle.local";
    /// <summary>Development and end-to-end tests: write each message to a text file here instead of sending it.</summary>
    public string? PickupDirectory { get; set; }
}

public interface IAppEmailSender
{
    Task SendAsync(string to, string subject, string textBody, CancellationToken ct = default);
}

/// <summary>
/// SMTP when a host is configured; otherwise a pickup directory (development, end-to-end tests).
/// A failure to send never fails the request that triggered it: the caller's answer must not reveal
/// whether an address exists, and the user can always ask for the message again.
/// </summary>
public class AppEmailSender(IOptions<SmtpOptions> options, ILogger<AppEmailSender> log, IHostEnvironment env) : IAppEmailSender
{
    public async Task SendAsync(string to, string subject, string textBody, CancellationToken ct = default)
    {
        var o = options.Value;
        try
        {
            if (!string.IsNullOrWhiteSpace(o.Host))
            {
                using var client = new SmtpClient(o.Host, o.Port) { EnableSsl = o.UseTls };
                if (!string.IsNullOrEmpty(o.Username)) client.Credentials = new NetworkCredential(o.Username, o.Password);
                using var message = new MailMessage(o.From, to, subject, textBody);
                await client.SendMailAsync(message, ct);
                return;
            }

            if (!string.IsNullOrWhiteSpace(o.PickupDirectory))
            {
                var directory = Path.IsPathRooted(o.PickupDirectory) ? o.PickupDirectory : Path.Combine(env.ContentRootPath, o.PickupDirectory);
                Directory.CreateDirectory(directory);
                var file = Path.Combine(directory, $"{DateTime.UtcNow:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}.txt");
                await File.WriteAllTextAsync(file, $"To: {to}\nSubject: {subject}\n\n{textBody}\n", ct);
                if (env.IsDevelopment())
                {
                    // Local convenience only: outside Development message bodies (which hold sign-in links) are never logged.
                    log.LogInformation("Email for {To} written to {File}\n{Subject}\n{Body}", to, file, subject, textBody);
                }
                return;
            }

            log.LogError("No email delivery is configured (Smtp:Host); a '{Subject}' message was not sent.", subject);
        }
        catch (Exception e) when (e is SmtpException or IOException or UnauthorizedAccessException)
        {
            log.LogError(e, "Sending a '{Subject}' message failed.", subject);
        }
    }
}

public static class EmailTemplates
{
    public static (string Subject, string Body) Confirm(string name, string link) => (
        "Confirm your email for manageBagle",
        $"Hi {name},\n\nConfirm this email address to start using manageBagle. The link works for 2 hours.\n\n{link}\n\nIf you did not create an account, you can ignore this email.");

    public static (string Subject, string Body) AlreadyRegistered(string name, string signInLink) => (
        "You already have a manageBagle account",
        $"Hi {name},\n\nSomeone tried to create a manageBagle account with this email address, but you already have one.\n\nSign in here: {signInLink}\n\nIf you have forgotten your password, use \"Forgot password?\" on that page. If this was not you, no action is needed.");

    public static (string Subject, string Body) ResetPassword(string name, string link) => (
        "Reset your manageBagle password",
        $"Hi {name},\n\nUse this link to choose a new password. It works once and expires in 2 hours.\n\n{link}\n\nIf you did not ask for this, you can ignore this email.");
}
