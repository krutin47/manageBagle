using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace ManageBagle.Api.Auth;

public class SmtpOptions
{
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string From { get; set; } = "no-reply@managebagle.local";
}

public interface IAppEmailSender
{
    Task SendAsync(string to, string subject, string textBody, CancellationToken ct = default);
}

/// <summary>Sends through SMTP when configured; otherwise writes the message to the log (local development).</summary>
public class AppEmailSender(IOptions<SmtpOptions> options, ILogger<AppEmailSender> log, IHostEnvironment env) : IAppEmailSender
{
    public async Task SendAsync(string to, string subject, string textBody, CancellationToken ct = default)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.Host))
        {
            if (env.IsDevelopment())
            {
                log.LogInformation("SMTP is not configured. Email to {To} — {Subject}\n{Body}", to, subject, textBody);
            }
            else
            {
                log.LogError("SMTP is not configured; could not send '{Subject}' email.", subject);
            }
            return;
        }

        using var client = new SmtpClient(o.Host, o.Port) { EnableSsl = true };
        if (!string.IsNullOrEmpty(o.Username))
        {
            client.Credentials = new NetworkCredential(o.Username, o.Password);
        }
        using var message = new MailMessage(o.From, to, subject, textBody);
        await client.SendMailAsync(message, ct);
    }
}
