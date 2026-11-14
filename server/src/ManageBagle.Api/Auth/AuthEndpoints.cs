using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.MicrosoftAccount;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace ManageBagle.Api.Auth;

public record RegisterRequest(
    [Required, EmailAddress, StringLength(254)] string Email,
    [Required, StringLength(128)] string Password,
    [Required, StringLength(80, MinimumLength = 1)] string DisplayName);

public record LoginRequest([Required] string Email, [Required] string Password, bool RememberMe);

public record MfaLoginRequest([Required, StringLength(40)] string Code, bool UseRecoveryCode, bool RememberDevice);

public record ChangePasswordRequest(string? CurrentPassword, [Required, StringLength(128)] string NewPassword);

public record ForgotPasswordRequest([Required, EmailAddress] string Email);

public record ResetPasswordRequest([Required] string Email, [Required] string Token, [Required, StringLength(128)] string NewPassword);

public record CodeRequest([Required, StringLength(40)] string Code);

/// <summary>Re-authentication for sensitive actions: the current password, or an authenticator code.</summary>
public record ConfirmRequest(string? Password, string? Code);

public record ProfileRequest([Required, StringLength(80, MinimumLength = 1)] string DisplayName);

public record UserResponse(Guid Id, string Email, string DisplayName, bool MfaEnabled, bool HasPassword, bool GoogleLinked, bool MicrosoftLinked, int RecoveryCodesLeft);

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

        limited.MapPost("/register", async (RegisterRequest req, UserManager<AppUser> users, SignInManager<AppUser> signIn, AppDbContext db) =>
        {
            var user = new AppUser { UserName = req.Email.Trim(), Email = req.Email.Trim(), DisplayName = req.DisplayName.Trim() };
            var result = await users.CreateAsync(user, req.Password);
            if (!result.Succeeded) return IdentityProblem(result);

            DefaultData.AddFor(db, user.Id);
            await db.SaveChangesAsync();
            await signIn.SignInAsync(user, isPersistent: false);
            return Results.Ok(await ToResponse(users, user));
        });

        limited.MapPost("/login", async (LoginRequest req, SignInManager<AppUser> signIn) =>
        {
            var result = await signIn.PasswordSignInAsync(req.Email.Trim(), req.Password, req.RememberMe, lockoutOnFailure: true);
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

        g.MapGet("/external/{provider}", async (string provider, string? returnUrl, SignInManager<AppUser> signIn, IAuthenticationSchemeProvider schemes) =>
        {
            var known = ExternalProviders.Find(provider);
            if (known is null || await schemes.GetSchemeAsync(known.Scheme) is null) return Results.NotFound();
            var callback = "/api/auth/external-callback?returnUrl=" + UrlEncoder.Default.Encode(SafeReturnUrl(returnUrl));
            var props = signIn.ConfigureExternalAuthenticationProperties(known.Scheme, callback);
            return Results.Challenge(props, [known.Scheme]);
        });

        g.MapGet("/external-callback", async (string? returnUrl, string? remoteError, SignInManager<AppUser> signIn,
            UserManager<AppUser> users, AppDbContext db, ILoggerFactory logs) =>
        {
            var log = logs.CreateLogger("Auth.External");
            var info = remoteError is null ? await signIn.GetExternalLoginInfoAsync() : null;
            var known = info is null ? null : ExternalProviders.All.FirstOrDefault(p => p.Scheme == info.LoginProvider);
            if (info is null || known is null) return Results.Redirect("/login?error=external_failed");

            var result = await signIn.ExternalLoginSignInAsync(info.LoginProvider, info.ProviderKey, isPersistent: false, bypassTwoFactor: false);
            if (result.RequiresTwoFactor) return Results.Redirect("/login/verify");
            if (result.IsLockedOut) return Results.Redirect("/login?error=locked");

            if (!result.Succeeded)
            {
                var email = info.Principal.FindFirstValue(ClaimTypes.Email);
                if (string.IsNullOrEmpty(email)) return Results.Redirect("/login?error=external_no_email");

                // Only some providers prove the person owns the mailbox. Google says so per sign-in;
                // Microsoft work/school directories can carry any address, so theirs is never trusted.
                var emailProven = known.TrustsEmailClaim &&
                    string.Equals(info.Principal.FindFirstValue("email_verified"), "true", StringComparison.OrdinalIgnoreCase);
                if (known.TrustsEmailClaim && !emailProven) return Results.Redirect("/login?error=external_unverified");

                var user = await users.FindByEmailAsync(email);
                if (user is null)
                {
                    user = new AppUser
                    {
                        UserName = email, Email = email, EmailConfirmed = emailProven,
                        DisplayName = info.Principal.FindFirstValue(ClaimTypes.GivenName)
                                      ?? info.Principal.FindFirstValue(ClaimTypes.Name) ?? email.Split('@')[0],
                    };
                    var created = await users.CreateAsync(user);
                    if (!created.Succeeded) return Results.Redirect("/login?error=external_failed");
                    DefaultData.AddFor(db, user.Id);
                    await db.SaveChangesAsync();
                }
                else if (!emailProven)
                {
                    // Without proof of the mailbox we never attach a new sign-in method to an existing account.
                    return Results.Redirect("/login?error=external_account_exists");
                }
                else if (!user.EmailConfirmed)
                {
                    // The account's address was never proven, so whoever created it may not own the
                    // mailbox. None of its earlier ways in may survive the link to a proven identity.
                    await users.RemovePasswordAsync(user);
                    await users.SetTwoFactorEnabledAsync(user, false);
                    await users.ResetAuthenticatorKeyAsync(user);
                    foreach (var old in await users.GetLoginsAsync(user))
                    {
                        await users.RemoveLoginAsync(user, old.LoginProvider, old.ProviderKey);
                    }
                    user.EmailConfirmed = true;
                    await users.UpdateAsync(user);
                    await users.UpdateSecurityStampAsync(user);
                    log.LogWarning("Unproven credentials removed while linking {Provider} for user {UserId}.", known.Scheme, user.Id);
                }

                var linked = await users.AddLoginAsync(user, info);
                if (!linked.Succeeded) return Results.Redirect("/login?error=external_failed");

                result = await signIn.ExternalLoginSignInAsync(info.LoginProvider, info.ProviderKey, isPersistent: false, bypassTwoFactor: false);
                if (result.RequiresTwoFactor) return Results.Redirect("/login/verify");
                if (!result.Succeeded) return Results.Redirect("/login?error=external_failed");
            }

            return Results.Redirect(SafeReturnUrl(returnUrl));
        });

        // ---- Passwords -------------------------------------------------------------------------

        var authed = limited.MapGroup("").RequireAuthorization();

        authed.MapPost("/password", async (ChangePasswordRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            var result = await users.HasPasswordAsync(user)
                ? await users.ChangePasswordAsync(user, req.CurrentPassword ?? "", req.NewPassword)
                : await users.AddPasswordAsync(user, req.NewPassword);
            if (!result.Succeeded) return IdentityProblem(result);
            await signIn.RefreshSignInAsync(user);
            return Results.NoContent();
        });

        limited.MapPost("/password/forgot", async (ForgotPasswordRequest req, UserManager<AppUser> users, IAppEmailSender email, IConfiguration config, HttpContext http) =>
        {
            // Always answer the same way so the endpoint cannot be used to discover accounts.
            var user = await users.FindByEmailAsync(req.Email.Trim());
            if (user is not null)
            {
                var token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(user)));
                var origin = config["App:PublicUrl"]?.TrimEnd('/') ?? $"{http.Request.Scheme}://{http.Request.Host}";
                var link = $"{origin}/reset-password?email={Uri.EscapeDataString(user.Email!)}&token={token}";
                await email.SendAsync(user.Email!, "Reset your manageBagle password",
                    $"Hi {user.DisplayName},\n\nUse this link to choose a new password. It expires in 2 hours.\n\n{link}\n\nIf you did not ask for this, you can ignore this email.");
            }
            return Results.Accepted();
        });

        limited.MapPost("/password/reset", async (ResetPasswordRequest req, UserManager<AppUser> users) =>
        {
            var invalid = HttpExtensions.Problem(400, "invalid_token", "This reset link is invalid or has expired. Request a new one.");
            var user = await users.FindByEmailAsync(req.Email.Trim());
            if (user is null) return invalid;
            string token;
            try { token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(req.Token)); }
            catch (FormatException) { return invalid; }

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
            user.Id, user.Email!, user.DisplayName, mfa,
            await users.HasPasswordAsync(user),
            logins.Any(l => l.LoginProvider == GoogleDefaults.AuthenticationScheme),
            logins.Any(l => l.LoginProvider == MicrosoftAccountDefaults.AuthenticationScheme),
            mfa ? await users.CountRecoveryCodesAsync(user) : 0);
    }
}
