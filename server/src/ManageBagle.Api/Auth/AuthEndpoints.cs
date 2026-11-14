using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Encodings.Web;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.MicrosoftAccount;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using ManageBagle.Api.Domain;

namespace ManageBagle.Api.Auth;

public record RegisterRequest(
    [Required, EmailAddress, StringLength(254)] string Email,
    [Required, StringLength(128)] string Password,
    [Required, StringLength(80, MinimumLength = 1)] string DisplayName,
    [StringLength(64)] string? TimeZone = null);

public record ConfirmEmailRequest(Guid UserId, [Required] string Token);

public record LoginRequest([Required] string Email, [Required] string Password, bool RememberMe);

public record MfaLoginRequest([Required, StringLength(40)] string Code, bool UseRecoveryCode, bool RememberDevice);

public record ChangePasswordRequest(string? CurrentPassword, [Required, StringLength(128)] string NewPassword);

public record ForgotPasswordRequest([Required, EmailAddress] string Email);

public record ResetPasswordRequest([Required] string Email, [Required] string Token, [Required, StringLength(128)] string NewPassword);

public record CodeRequest([Required, StringLength(40)] string Code);

/// <summary>Re-authentication for sensitive actions: the current password, or an authenticator code.</summary>
public record ConfirmRequest(string? Password, string? Code);

public record ProfileRequest([Required, StringLength(80, MinimumLength = 1)] string DisplayName, [StringLength(64)] string? TimeZone = null);

public record UserResponse(Guid Id, string Email, string DisplayName, string? TimeZone, bool MfaEnabled, bool HasPassword, bool GoogleLinked, bool MicrosoftLinked, int RecoveryCodesLeft);

/// <param name="Key">Name used in URLs and by the client.</param>
/// <param name="TrustsEmailClaim">True when the provider states, per sign-in, that the email is verified.</param>
public record ExternalProvider(string Key, string Scheme, bool TrustsEmailClaim);

public static class ExternalProviders
{
    public static readonly ExternalProvider[] All =
    [
        new("google", GoogleDefaults.AuthenticationScheme, TrustsEmailClaim: true),
        new("microsoft", MicrosoftAccountDefaults.AuthenticationScheme, TrustsEmailClaim: false),
    ];

    public static ExternalProvider? Find(string key) => All.FirstOrDefault(p => p.Key == key);
}

public static class AuthEndpoints
{
    private const string Issuer = "manageBagle";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/auth").WithTags("Auth");
        var limited = g.MapGroup("").RequireRateLimiting("auth");

        // The antiforgery token for this browser and account. The client sends it back in X-CSRF-TOKEN on
        // every state-changing request, and fetches a new one after signing in or out.
        g.MapGet("/csrf", (HttpContext http, IAntiforgery antiforgery) =>
            Results.Ok(new { token = antiforgery.GetAndStoreTokens(http).RequestToken }));

        g.MapGet("/providers", async (IAuthenticationSchemeProvider schemes) =>
        {
            var enabled = new Dictionary<string, bool>();
            foreach (var p in ExternalProviders.All) enabled[p.Key] = await schemes.GetSchemeAsync(p.Scheme) is not null;
            return Results.Ok(enabled);
        });

        g.MapGet("/me", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = await users.GetUserAsync(principal);
            return user is null ? Results.Unauthorized() : Results.Ok(await ToResponse(users, user));
        }).RequireAuthorization();

        limited.MapPost("/register", async (RegisterRequest req, UserManager<AppUser> users, AppDbContext db, IAppEmailSender email, AccountLinks links, IOptions<IdentityOptions> identity) =>
        {
            var address = req.Email.Trim();
            // Password rules are not a secret, so those errors are reported whether or not the address is known.
            var probe = new AppUser { UserName = address, Email = address };
            foreach (var validator in users.PasswordValidators)
            {
                var check = await validator.ValidateAsync(users, probe, req.Password);
                if (!check.Succeeded) return IdentityProblem(check);
            }

            var existing = await users.FindByEmailAsync(address);
            if (existing is null)
            {
                var user = new AppUser { UserName = address, Email = address, DisplayName = req.DisplayName.Trim(), TimeZoneId = TimeZones.Normalize(req.TimeZone) };
                var result = await users.CreateAsync(user, req.Password);
                if (!result.Succeeded) return IdentityProblem(result);
                DefaultData.AddFor(db, user.Id);
                await db.SaveChangesAsync();
                await links.SendConfirmationAsync(users, email, user);
                Audit.Log(app, "account_created", user.Id);
            }
            else if (!existing.EmailConfirmed)
            {
                await links.SendConfirmationAsync(users, email, existing);
            }
            else
            {
                var (subject, body) = EmailTemplates.AlreadyRegistered(existing.DisplayName, links.Url("/login"));
                await email.SendAsync(existing.Email!, subject, body);
            }

            // The same answer in every case: this endpoint must not reveal which addresses have accounts.
            return Results.Accepted(value: new { status = "confirmation_sent" });
        });

        limited.MapPost("/email/confirm", async (ConfirmEmailRequest req, UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var invalid = HttpExtensions.Problem(400, "invalid_token", "This confirmation link is invalid or has expired. Ask for a new one.");
            var user = await users.FindByIdAsync(req.UserId.ToString());
            if (user is null || !AccountLinks.TryDecode(req.Token, out var token)) return invalid;
            if (!user.EmailConfirmed)
            {
                var result = await users.ConfirmEmailAsync(user, token);
                if (!result.Succeeded) return invalid;
                Audit.Log(app, "email_confirmed", user.Id);
            }
            else if (!await users.VerifyUserTokenAsync(user, users.Options.Tokens.EmailConfirmationTokenProvider, UserManager<AppUser>.ConfirmEmailTokenPurpose, token))
            {
                return invalid;
            }

            // Opening the link proves the mailbox. That is enough to sign in — unless two-step
            // verification is on, which a mailbox alone must never bypass.
            if (await users.GetTwoFactorEnabledAsync(user)) return Results.Ok(new { status = "confirmed" });
            await signIn.SignInAsync(user, isPersistent: false);
            return Results.Ok(new { status = "signed_in" });
        });

        limited.MapPost("/email/resend", async (ForgotPasswordRequest req, UserManager<AppUser> users, IAppEmailSender email, AccountLinks links) =>
        {
            var user = await users.FindByEmailAsync(req.Email.Trim());
            if (user is { EmailConfirmed: false }) await links.SendConfirmationAsync(users, email, user);
            return Results.Accepted();
        });

        limited.MapPost("/login", async (LoginRequest req, SignInManager<AppUser> signIn, UserManager<AppUser> users) =>
        {
            var user = await users.FindByEmailAsync(req.Email.Trim());
            if (user is { EmailConfirmed: false })
            {
                // Only someone who knows the password learns that the address is waiting for confirmation.
                if (await users.IsLockedOutAsync(user)) return SignInOutcome(Microsoft.AspNetCore.Identity.SignInResult.LockedOut);
                if (await users.CheckPasswordAsync(user, req.Password))
                {
                    return HttpExtensions.Problem(403, "email_unconfirmed", "Confirm your email address first. Check your inbox for the link, or ask for a new one.");
                }
                await users.AccessFailedAsync(user);
                return SignInOutcome(Microsoft.AspNetCore.Identity.SignInResult.Failed);
            }

            var result = await signIn.PasswordSignInAsync(req.Email.Trim(), req.Password, req.RememberMe, lockoutOnFailure: true);
            if (user is not null) Audit.Log(app, result.Succeeded ? "sign_in" : result.RequiresTwoFactor ? "sign_in_needs_mfa" : "sign_in_failed", user.Id);
            return SignInOutcome(result);
        });

        limited.MapPost("/login/mfa", async (MfaLoginRequest req, SignInManager<AppUser> signIn) =>
        {
            if (await signIn.GetTwoFactorAuthenticationUserAsync() is null)
            {
                return HttpExtensions.Problem(401, "mfa_session_expired", "Your sign-in session expired. Start again.");
            }
            // Recovery codes keep their dash; authenticator codes are digits only.
            var result = req.UseRecoveryCode
                ? await signIn.TwoFactorRecoveryCodeSignInAsync(req.Code.Replace(" ", "").ToUpperInvariant())
                : await signIn.TwoFactorAuthenticatorSignInAsync(req.Code.Replace(" ", "").Replace("-", ""), isPersistent: false, rememberClient: req.RememberDevice);
            if (result.Succeeded) return Results.Ok(new { status = "ok" });
            if (result.IsLockedOut) return SignInOutcome(result);
            return HttpExtensions.Problem(401, "invalid_code", "That code is not valid. Check your authenticator app and try again.");
        });

        g.MapPost("/logout", async (SignInManager<AppUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return Results.NoContent();
        });

        // ---- External providers (Google, Microsoft; an OIDC SSO provider would be one more entry) ----
        //
        // An outside identity is attached to an account in exactly two ways:
        //   - it creates a brand-new account, or
        //   - the signed-in owner of an existing account links it from Settings after re-entering
        //     their password or an authenticator code.
        // A matching email address alone never attaches anything and never changes credentials.

        g.MapGet("/external/{provider}", async (string provider, string? returnUrl, string? link, ClaimsPrincipal principal,
            SignInManager<AppUser> signIn, IAuthenticationSchemeProvider schemes, AccountLinks links) =>
        {
            var known = ExternalProviders.Find(provider);
            if (known is null || await schemes.GetSchemeAsync(known.Scheme) is null) return Results.NotFound();

            var callback = "/api/auth/external-callback?returnUrl=" + UrlEncoder.Default.Encode(SafeReturnUrl(returnUrl));
            if (link is not null)
            {
                if (!links.IsValidLinkTicket(link, principal, known.Key)) return Results.Redirect("/settings?error=link_expired");
                callback += "&link=" + UrlEncoder.Default.Encode(link);
            }
            var props = signIn.ConfigureExternalAuthenticationProperties(known.Scheme, callback);
            return Results.Challenge(props, [known.Scheme]);
        });

        g.MapGet("/external-callback", async (string? returnUrl, string? remoteError, string? link, HttpContext http, SignInManager<AppUser> signIn,
            UserManager<AppUser> users, AppDbContext db, IAppEmailSender email, AccountLinks links) =>
        {
            var info = remoteError is null ? await signIn.GetExternalLoginInfoAsync() : null;
            var known = info is null ? null : ExternalProviders.All.FirstOrDefault(p => p.Scheme == info.LoginProvider);
            if (info is null || known is null) return Results.Redirect("/login?error=external_failed");

            // ---- Explicit linking, started from Settings by the signed-in owner ----
            if (link is not null)
            {
                await http.SignOutAsync(IdentityConstants.ExternalScheme);
                var current = await users.GetUserAsync(http.User);
                if (current is null || !links.IsValidLinkTicket(link, http.User, known.Key)) return Results.Redirect("/settings?error=link_expired");
                if (await users.FindByLoginAsync(info.LoginProvider, info.ProviderKey) is not null) return Results.Redirect("/settings?error=link_in_use");
                var added = await users.AddLoginAsync(current, info);
                if (!added.Succeeded) return Results.Redirect("/settings?error=link_failed");
                Audit.Log(app, "external_login_linked", current.Id, known.Key);
                return Results.Redirect($"/settings?linked={known.Key}");
            }

            // ---- Ordinary sign-in ----
            var result = await signIn.ExternalLoginSignInAsync(info.LoginProvider, info.ProviderKey, isPersistent: false, bypassTwoFactor: false);
            if (result.Succeeded) return Results.Redirect(SafeReturnUrl(returnUrl));
            if (result.RequiresTwoFactor) return Results.Redirect("/login/verify");
            if (result.IsLockedOut) return Results.Redirect("/login?error=locked");

            var linkedUser = await users.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
            if (linkedUser is not null)
            {
                // The identity is known but the account's email is still unconfirmed.
                await http.SignOutAsync(IdentityConstants.ExternalScheme);
                await links.SendConfirmationAsync(users, email, linkedUser);
                return Results.Redirect("/login?notice=confirm_email");
            }

            var address = info.Principal.FindFirstValue(ClaimTypes.Email);
            if (string.IsNullOrEmpty(address)) return Results.Redirect("/login?error=external_no_email");
            if (await users.FindByEmailAsync(address) is not null)
            {
                // Never attach to, or alter, an existing account from here. The owner links it in Settings.
                return Results.Redirect("/login?error=external_account_exists");
            }

            // Only some providers prove the mailbox. Google says so per sign-in; Microsoft work/school
            // directories can carry any address, so an account created through them confirms by email.
            var emailProven = known.TrustsEmailClaim &&
                string.Equals(info.Principal.FindFirstValue("email_verified"), "true", StringComparison.OrdinalIgnoreCase);
            var user = new AppUser
            {
                UserName = address, Email = address, EmailConfirmed = emailProven,
                DisplayName = info.Principal.FindFirstValue(ClaimTypes.GivenName) ?? info.Principal.FindFirstValue(ClaimTypes.Name) ?? address.Split('@')[0],
            };
            if (!(await users.CreateAsync(user)).Succeeded) return Results.Redirect("/login?error=external_failed");
            DefaultData.AddFor(db, user.Id);
            await db.SaveChangesAsync();
            if (!(await users.AddLoginAsync(user, info)).Succeeded) return Results.Redirect("/login?error=external_failed");
            Audit.Log(app, "account_created", user.Id, known.Key);

            if (!emailProven)
            {
                await http.SignOutAsync(IdentityConstants.ExternalScheme);
                await links.SendConfirmationAsync(users, email, user);
                return Results.Redirect("/login?notice=confirm_email");
            }
            result = await signIn.ExternalLoginSignInAsync(info.LoginProvider, info.ProviderKey, isPersistent: false, bypassTwoFactor: false);
            return Results.Redirect(result.Succeeded ? SafeReturnUrl(returnUrl) : "/login?error=external_failed");
        });

        // ---- Passwords -------------------------------------------------------------------------

        var authed = limited.MapGroup("").RequireAuthorization();

        // Step-up: prove it is you (password or authenticator code), receive a 5-minute ticket to link.
        authed.MapPost("/external/{provider}/link", async (string provider, ConfirmRequest req, ClaimsPrincipal principal, UserManager<AppUser> users,
            IAuthenticationSchemeProvider schemes, AccountLinks links) =>
        {
            var known = ExternalProviders.Find(provider);
            if (known is null || await schemes.GetSchemeAsync(known.Scheme) is null) return Results.NotFound();
            var user = (await users.GetUserAsync(principal))!;
            if (!await users.HasPasswordAsync(user) && !await users.GetTwoFactorEnabledAsync(user))
            {
                return HttpExtensions.Problem(409, "step_up_unavailable", "Set a password first, so we can confirm it is you before linking another account.");
            }
            if (!await Confirm(users, user, req)) return ConfirmFailed();
            return Results.Ok(new { url = $"/api/auth/external/{known.Key}?link={Uri.EscapeDataString(links.CreateLinkTicket(user.Id, known.Key))}&returnUrl=%2Fsettings" });
        });

        authed.MapPost("/external/{provider}/unlink", async (string provider, ConfirmRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var known = ExternalProviders.Find(provider);
            if (known is null) return Results.NotFound();
            var user = (await users.GetUserAsync(principal))!;
            var logins = await users.GetLoginsAsync(user);
            var login = logins.FirstOrDefault(l => l.LoginProvider == known.Scheme);
            if (login is null) return Results.NotFound();
            if (!await users.HasPasswordAsync(user) && logins.Count == 1)
            {
                return HttpExtensions.Problem(409, "last_sign_in_method", "This is your only way to sign in. Set a password before disconnecting it.");
            }
            if (!await Confirm(users, user, req)) return ConfirmFailed();
            await users.RemoveLoginAsync(user, login.LoginProvider, login.ProviderKey);
            await signIn.RefreshSignInAsync(user);
            Audit.Log(app, "external_login_unlinked", user.Id, known.Key);
            return Results.NoContent();
        });

        authed.MapPost("/password", async (ChangePasswordRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            var result = await users.HasPasswordAsync(user)
                ? await users.ChangePasswordAsync(user, req.CurrentPassword ?? "", req.NewPassword)
                : await users.AddPasswordAsync(user, req.NewPassword);
            if (!result.Succeeded) return IdentityProblem(result);
            await signIn.RefreshSignInAsync(user);
            Audit.Log(app, "password_changed", user.Id);
            return Results.NoContent();
        });

        limited.MapPost("/password/forgot", async (ForgotPasswordRequest req, UserManager<AppUser> users, IAppEmailSender email, AccountLinks links) =>
        {
            // Always answer the same way so the endpoint cannot be used to discover accounts.
            var user = await users.FindByEmailAsync(req.Email.Trim());
            if (user is not null)
            {
                var token = AccountLinks.Encode(await users.GeneratePasswordResetTokenAsync(user));
                var (subject, body) = EmailTemplates.ResetPassword(user.DisplayName, links.Url($"/reset-password?email={Uri.EscapeDataString(user.Email!)}&token={token}"));
                await email.SendAsync(user.Email!, subject, body);
            }
            return Results.Accepted();
        });

        limited.MapPost("/password/reset", async (ResetPasswordRequest req, UserManager<AppUser> users) =>
        {
            var invalid = HttpExtensions.Problem(400, "invalid_token", "This reset link is invalid or has expired. Request a new one.");
            var user = await users.FindByEmailAsync(req.Email.Trim());
            if (user is null) return invalid;
            if (!AccountLinks.TryDecode(req.Token, out var token)) return invalid;

            var result = await users.ResetPasswordAsync(user, token, req.NewPassword);
            if (!result.Succeeded)
            {
                return result.Errors.Any(e => e.Code == "InvalidToken") ? invalid : IdentityProblem(result);
            }
            // Receiving the link proves ownership of the mailbox.
            if (!user.EmailConfirmed)
            {
                user.EmailConfirmed = true;
                await users.UpdateAsync(user);
            }
            await users.SetLockoutEndDateAsync(user, null);
            Audit.Log(app, "password_reset", user.Id);
            return Results.NoContent();
        });

        // ---- Multi-factor ----------------------------------------------------------------------

        authed.MapGet("/mfa/setup", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            if (await users.GetTwoFactorEnabledAsync(user))
            {
                return HttpExtensions.Problem(409, "mfa_already_enabled", "Two-step verification is already on.");
            }
            var key = await users.GetAuthenticatorKeyAsync(user);
            if (string.IsNullOrEmpty(key))
            {
                await users.ResetAuthenticatorKeyAsync(user);
                key = await users.GetAuthenticatorKeyAsync(user);
            }
            var uri = $"otpauth://totp/{Uri.EscapeDataString(Issuer)}:{Uri.EscapeDataString(user.Email!)}" +
                      $"?secret={key}&issuer={Uri.EscapeDataString(Issuer)}&digits=6";
            return Results.Ok(new { sharedKey = key, otpauthUri = uri });
        });

        authed.MapPost("/mfa/enable", async (CodeRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            var code = req.Code.Replace(" ", "").Replace("-", "");
            var valid = await users.VerifyTwoFactorTokenAsync(user, users.Options.Tokens.AuthenticatorTokenProvider, code);
            if (!valid) return HttpExtensions.Problem(400, "invalid_code", "That code is not valid. Check your authenticator app and try again.");

            await users.SetTwoFactorEnabledAsync(user, true);
            var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
            await signIn.RefreshSignInAsync(user);
            Audit.Log(app, "mfa_enabled", user.Id);
            return Results.Ok(new { recoveryCodes = codes });
        });

        authed.MapPost("/mfa/disable", async (ConfirmRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            if (!await Confirm(users, user, req)) return ConfirmFailed();
            await users.SetTwoFactorEnabledAsync(user, false);
            await users.ResetAuthenticatorKeyAsync(user);
            await signIn.ForgetTwoFactorClientAsync();
            await signIn.RefreshSignInAsync(user);
            Audit.Log(app, "mfa_disabled", user.Id);
            return Results.NoContent();
        });

        authed.MapPost("/mfa/recovery-codes", async (ConfirmRequest req, ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            if (!await users.GetTwoFactorEnabledAsync(user))
            {
                return HttpExtensions.Problem(409, "mfa_not_enabled", "Turn on two-step verification first.");
            }
            if (!await Confirm(users, user, req)) return ConfirmFailed();
            var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
            return Results.Ok(new { recoveryCodes = codes });
        });

        // ---- Profile ---------------------------------------------------------------------------

        g.MapPut("/profile", async (ProfileRequest req, ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            user.DisplayName = req.DisplayName.Trim();
            if (req.TimeZone is not null)
            {
                if (TimeZones.Normalize(req.TimeZone) is not { } zone) return HttpExtensions.Invalid("timeZone", "That is not a time zone we recognise.");
                user.TimeZoneId = zone;
            }
            await users.UpdateAsync(user);
            return Results.Ok(await ToResponse(users, user));
        }).RequireAuthorization();

        authed.MapPost("/account/delete", async (ConfirmRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            // Google-only accounts without MFA have nothing to re-enter; their live session is the proof.
            var needsProof = await users.HasPasswordAsync(user) || await users.GetTwoFactorEnabledAsync(user);
            if (needsProof && !await Confirm(users, user, req)) return ConfirmFailed();
            await signIn.SignOutAsync();
            await users.DeleteAsync(user); // owned rows cascade
            return Results.NoContent();
        });
    }

    private static async Task<bool> Confirm(UserManager<AppUser> users, AppUser user, ConfirmRequest req)
    {
        if (!string.IsNullOrEmpty(req.Password) && await users.CheckPasswordAsync(user, req.Password)) return true;
        if (!string.IsNullOrWhiteSpace(req.Code) && await users.GetTwoFactorEnabledAsync(user))
        {
            var code = req.Code.Replace(" ", "").Replace("-", "");
            return await users.VerifyTwoFactorTokenAsync(user, users.Options.Tokens.AuthenticatorTokenProvider, code);
        }
        return false;
    }

    private static IResult ConfirmFailed() =>
        HttpExtensions.Problem(403, "confirmation_failed", "We could not confirm it is you. Check your password or code.");

    private static IResult SignInOutcome(Microsoft.AspNetCore.Identity.SignInResult result)
    {
        if (result.Succeeded) return Results.Ok(new { status = "ok" });
        if (result.RequiresTwoFactor) return Results.Ok(new { status = "mfaRequired" });
        if (result.IsLockedOut)
        {
            return HttpExtensions.Problem(423, "locked_out", "Too many attempts. Try again in a few minutes.");
        }
        return HttpExtensions.Problem(401, "invalid_credentials", "That email and password do not match.");
    }

    private static IResult IdentityProblem(IdentityResult result)
    {
        var errors = result.Errors
            .GroupBy(e => e.Code.Contains("Password") ? "password" : e.Code.Contains("Email") || e.Code.Contains("UserName") ? "email" : "form")
            .ToDictionary(grp => grp.Key, grp => grp.Select(e => e.Code is "DuplicateUserName" or "DuplicateEmail"
                ? "An account with this email already exists."
                : e.Description).Distinct().ToArray());
        return Results.ValidationProblem(errors);
    }

    private static string SafeReturnUrl(string? url) =>
        !string.IsNullOrEmpty(url) && url.StartsWith('/') && !url.StartsWith("//") && !url.StartsWith("/\\") ? url : "/";

    private static async Task<UserResponse> ToResponse(UserManager<AppUser> users, AppUser user)
    {
        var logins = await users.GetLoginsAsync(user);
        var mfa = await users.GetTwoFactorEnabledAsync(user);
        return new UserResponse(
            user.Id, user.Email!, user.DisplayName, user.TimeZoneId, mfa,
            await users.HasPasswordAsync(user),
            logins.Any(l => l.LoginProvider == GoogleDefaults.AuthenticationScheme),
            logins.Any(l => l.LoginProvider == MicrosoftAccountDefaults.AuthenticationScheme),
            mfa ? await users.CountRecoveryCodesAsync(user) : 0);
    }
}
