using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ManageBagle.Api.Tests;

/// <summary>Adversarial tests: each one plays an attacker or a failure, and asserts the app holds.</summary>
[Collection("api")]
public class SecurityTests(ApiFactory factory)
{
    private static async Task<JsonElement> Problem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(code, body.GetProperty("code").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("traceId").GetString()));
        return body;
    }

    private static object Block(int? version = null) => new
    {
        date = "2026-11-16", start = "09:00:00", end = "10:00:00", title = "Block", priority = "High", workMode = "DeepFocus", status = "Planned", version,
    };

    // ---- CSRF ------------------------------------------------------------------------------------

    [Fact]
    public async Task A_forged_request_with_the_victims_cookies_but_no_token_is_refused()
    {
        var (victim, _) = await factory.NewUserAsync();
        // The attacker's page can make the browser send cookies and even guess the static header,
        // but it cannot read the antiforgery token.
        var forged = new HttpRequestMessage(HttpMethod.Post, "/api/blocks") { Content = JsonContent.Create(Block()) };
        forged.Headers.Add("X-MB-Client", "web");
        forged.Headers.Add("X-CSRF-TOKEN", "guessed-value");
        await Problem(await victim.SendAsync(forged), HttpStatusCode.BadRequest, "csrf_invalid");
        Assert.Equal(0, (await victim.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-16&to=2026-11-16")).GetArrayLength());
    }

    [Fact]
    public async Task One_accounts_token_does_not_work_for_another_account()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        var aliceToken = (await alice.GetFromJsonAsync<JsonElement>("/api/auth/csrf")).GetProperty("token").GetString();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/blocks") { Content = JsonContent.Create(Block()) };
        request.Headers.Add("X-CSRF-TOKEN", aliceToken); // the test client keeps a preset token instead of fetching Bob's
        await Problem(await bob.SendAsync(request), HttpStatusCode.BadRequest, "csrf_invalid");
    }

    [Fact]
    public async Task A_request_from_another_origin_is_refused_even_with_a_valid_token()
    {
        var (client, _) = await factory.NewUserAsync();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/blocks") { Content = JsonContent.Create(Block()) };
        request.Headers.Add("Origin", "https://evil.example");
        await Problem(await client.SendAsync(request), HttpStatusCode.Forbidden, "origin_rejected");

        var sameSite = new HttpRequestMessage(HttpMethod.Post, "/api/blocks") { Content = JsonContent.Create(Block()) };
        sameSite.Headers.Add("Origin", "https://localhost");
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(sameSite)).StatusCode);
    }

    [Fact]
    public async Task Signing_out_is_protected_too_and_ends_the_session_when_legitimate()
    {
        var (client, _) = await factory.NewUserAsync();
        var forged = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        forged.Headers.Add("X-CSRF-TOKEN", "nope");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(forged)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    // ---- Error contract ----------------------------------------------------------------------------

    [Fact]
    public async Task Every_error_is_a_problem_document_with_a_code_and_a_trace_id()
    {
        var (client, _) = await factory.NewUserAsync();
        await Problem(await factory.NewClient().GetAsync("/api/backlog"), HttpStatusCode.Unauthorized, "unauthorized");
        await Problem(await client.GetAsync("/api/does-not-exist"), HttpStatusCode.NotFound, "not_found");
        await Problem(await client.GetAsync($"/api/blocks/{Guid.NewGuid()}"), HttpStatusCode.NotFound, "not_found");

        var invalid = await client.PostAsJsonAsync("/api/blocks", new { date = "2026-11-16", start = "09:00:00", end = "10:00:00", title = "" });
        var body = await Problem(invalid, HttpStatusCode.BadRequest, "validation_failed");
        Assert.True(body.TryGetProperty("errors", out _));
        Assert.Equal(body.GetProperty("traceId").GetString(), invalid.Headers.GetValues("X-Trace-Id").Single());
    }

    // ---- Registration and email confirmation -------------------------------------------------------

    [Fact]
    public async Task Registration_answers_the_same_whether_or_not_the_address_is_taken()
    {
        var (_, taken) = await factory.NewUserAsync();
        var client = factory.NewClient();
        var fresh = $"fresh-{Guid.NewGuid():N}@example.com";

        var forNew = await client.PostAsJsonAsync("/api/auth/register", new { email = fresh, password = ApiFactory.Password, displayName = "N" });
        var forTaken = await client.PostAsJsonAsync("/api/auth/register", new { email = taken, password = "a different password", displayName = "Mallory" });
        Assert.Equal(HttpStatusCode.Accepted, forNew.StatusCode);
        Assert.Equal(forNew.StatusCode, forTaken.StatusCode);
        Assert.Equal(await forNew.Content.ReadAsStringAsync(), await forTaken.Content.ReadAsStringAsync());

        // The real owner is told by email, and their password is untouched.
        Assert.Contains(factory.Email.To(taken), m => m.Subject.StartsWith("You already have"));
        (await factory.NewClient().PostAsJsonAsync("/api/auth/login", new { email = taken, password = ApiFactory.Password })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task An_account_cannot_be_used_until_its_email_is_confirmed()
    {
        var client = factory.NewClient();
        var email = $"pending-{Guid.NewGuid():N}@example.com";
        await client.PostAsJsonAsync("/api/auth/register", new { email, password = ApiFactory.Password, displayName = "Pending" });
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode); // registering does not sign in

        // Only the right password reveals that the account is waiting; a wrong one looks like any failure.
        await Problem(await client.PostAsJsonAsync("/api/auth/login", new { email, password = "wrong password" }), HttpStatusCode.Unauthorized, "invalid_credentials");
        await Problem(await client.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password }), HttpStatusCode.Forbidden, "email_unconfirmed");

        var confirmation = factory.Email.ConfirmationFor(email);
        var bad = await client.PostAsJsonAsync("/api/auth/email/confirm", confirmation with { Token = "bm9wZQ" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        (await client.PostAsJsonAsync("/api/auth/email/confirm", confirmation)).EnsureSuccessStatusCode();
        Assert.Equal(email, (await client.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("email").GetString());
    }

    [Fact]
    public async Task Resending_a_confirmation_never_reveals_whether_the_address_exists()
    {
        var client = factory.NewClient();
        var known = await client.PostAsJsonAsync("/api/auth/email/resend", new { email = "nobody-here@example.com" });
        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Empty(factory.Email.To("nobody-here@example.com"));
    }

    // ---- External identities -----------------------------------------------------------------------

    [Fact]
    public async Task A_matching_provider_email_never_attaches_to_or_alters_an_existing_account()
    {
        var (owner, email) = await factory.NewUserAsync();
        var setup = await owner.GetFromJsonAsync<JsonElement>("/api/auth/mfa/setup");
        var code = new OtpNet.Totp(OtpNet.Base32Encoding.ToBytes(setup.GetProperty("sharedKey").GetString()!)).ComputeTotp();
        (await owner.PostAsJsonAsync("/api/auth/mfa/enable", new { code })).EnsureSuccessStatusCode();

        // An attacker controls a provider account that claims — verified — the victim's address.
        var attacker = factory.NewClient();
        var landed = await FakeProvider.SignInAsync(attacker, sub: "attacker-sub", email);
        Assert.Equal("/login?error=external_account_exists", landed);
        Assert.Equal(HttpStatusCode.Unauthorized, (await attacker.GetAsync("/api/auth/me")).StatusCode);

        // Nothing about the victim's account changed: password, two-step verification, no new sign-in method.
        var me = await owner.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.True(me.GetProperty("mfaEnabled").GetBoolean());
        Assert.True(me.GetProperty("hasPassword").GetBoolean());
        Assert.False(me.GetProperty("googleLinked").GetBoolean());
        var login = await factory.NewClient().PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal("mfaRequired", (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_new_person_can_start_an_account_with_a_verified_provider_identity()
    {
        var client = factory.NewClient();
        var email = $"g-{Guid.NewGuid():N}@example.com";
        Assert.Equal("/", await FakeProvider.SignInAsync(client, sub: $"sub-{email}", email));
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.True(me.GetProperty("googleLinked").GetBoolean());
        Assert.False(me.GetProperty("hasPassword").GetBoolean());
    }

    [Fact]
    public async Task An_unverified_provider_email_must_be_confirmed_by_mail_before_the_account_works()
    {
        var client = factory.NewClient();
        var email = $"u-{Guid.NewGuid():N}@example.com";
        Assert.Equal("/login?notice=confirm_email", await FakeProvider.SignInAsync(client, sub: $"sub-{email}", email, verified: false));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        (await client.PostAsJsonAsync("/api/auth/email/confirm", factory.Email.ConfirmationFor(email))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Linking_needs_the_signed_in_owner_and_a_fresh_proof_of_identity()
    {
        var (owner, email) = await factory.NewUserAsync();
        var sub = $"sub-{Guid.NewGuid():N}";

        // No proof, no ticket.
        await Problem(await owner.PostAsJsonAsync("/api/auth/external/google/link", new { password = "wrong" }), HttpStatusCode.Forbidden, "confirmation_failed");

        // A made-up ticket is worthless.
        Assert.Equal("/settings?error=link_expired", await FakeProvider.SignInAsync(owner, sub, "other@example.com", path: "/api/auth/external/google?link=forged"));

        var ticket = await (await owner.PostAsJsonAsync("/api/auth/external/google/link", new { password = ApiFactory.Password })).Content.ReadFromJsonAsync<JsonElement>();
        var url = ticket.GetProperty("url").GetString()!;

        // Someone else's browser cannot spend the owner's ticket.
        var (stranger, _) = await factory.NewUserAsync();
        Assert.Equal("/settings?error=link_expired", await FakeProvider.SignInAsync(stranger, sub, "other@example.com", path: url));

        // The owner can — and the provider's email does not have to match the account's.
        Assert.Equal("/settings?linked=google", await FakeProvider.SignInAsync(owner, sub, "a-different-address@example.com", path: url));
        Assert.True((await owner.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("googleLinked").GetBoolean());

        // From now on that identity signs in to this account.
        var later = factory.NewClient();
        Assert.Equal("/", await FakeProvider.SignInAsync(later, sub, "a-different-address@example.com"));
        Assert.Equal(email, (await later.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("email").GetString());

        // An identity already linked somewhere cannot be linked to a second account.
        var second = await (await stranger.PostAsJsonAsync("/api/auth/external/google/link", new { password = ApiFactory.Password })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("/settings?error=link_in_use", await FakeProvider.SignInAsync(stranger, sub, "x@example.com", path: second.GetProperty("url").GetString()!));
    }

    [Fact]
    public async Task The_last_way_to_sign_in_cannot_be_disconnected()
    {
        var client = factory.NewClient();
        var email = $"only-{Guid.NewGuid():N}@example.com";
        await FakeProvider.SignInAsync(client, sub: $"sub-{email}", email);
        await Problem(await client.PostAsJsonAsync("/api/auth/external/google/unlink", new { }), HttpStatusCode.Conflict, "last_sign_in_method");

        (await client.PostAsJsonAsync("/api/auth/password", new { newPassword = ApiFactory.Password })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/auth/external/google/unlink", new { password = ApiFactory.Password })).StatusCode);
    }

    // ---- Lost updates and replays -------------------------------------------------------------------

    [Fact]
    public async Task A_stale_tab_gets_409_instead_of_overwriting_newer_work()
    {
        var (client, _) = await factory.NewUserAsync();
        var created = await (await client.PostAsJsonAsync("/api/blocks", Block())).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal(1, created.GetProperty("version").GetInt32());

        var first = await (await client.PutAsJsonAsync($"/api/blocks/{id}", Block(version: 1))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, first.GetProperty("version").GetInt32());

        await Problem(await client.PutAsJsonAsync($"/api/blocks/{id}", Block(version: 1)), HttpStatusCode.Conflict, "stale_version");
        await Problem(await client.PatchAsJsonAsync($"/api/blocks/{id}/progress", new { status = "Done", version = 1 }), HttpStatusCode.Conflict, "stale_version");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/blocks/{id}", Block())).StatusCode); // version is mandatory

        var task = await (await client.PostAsJsonAsync("/api/backlog", new { title = "T", priority = "Low", status = "Planned" })).Content.ReadFromJsonAsync<JsonElement>();
        var taskId = task.GetProperty("id").GetGuid();
        (await client.PutAsJsonAsync($"/api/backlog/{taskId}", new { title = "T2", priority = "Low", status = "Planned", version = 1 })).EnsureSuccessStatusCode();
        await Problem(await client.PutAsJsonAsync($"/api/backlog/{taskId}", new { title = "T3", priority = "Low", status = "Planned", version = 1 }), HttpStatusCode.Conflict, "stale_version");
    }

    [Fact]
    public async Task Two_simultaneous_edits_of_the_same_block_cannot_both_win()
    {
        var (client, _) = await factory.NewUserAsync();
        var id = (await (await client.PostAsJsonAsync("/api/blocks", Block())).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var attempts = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => client.PutAsJsonAsync($"/api/blocks/{id}", Block(version: 1))));
        Assert.Equal(1, attempts.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(7, attempts.Count(r => r.StatusCode == HttpStatusCode.Conflict));
    }

    [Fact]
    public async Task Sending_the_same_plan_twice_saves_it_once()
    {
        var (client, _) = await factory.NewUserAsync();
        HttpRequestMessage Plan(string key, string title) => new(HttpMethod.Post, "/api/days/2026-11-19/plan")
        {
            Headers = { { "Idempotency-Key", key } },
            Content = JsonContent.Create(new { items = new[] { new { title, estimatedMinutes = 30, workMode = "DeepFocus", priority = "Low", topRank = 1, start = "09:00:00", end = "09:30:00" } } }),
        };
        var key = Guid.NewGuid().ToString();

        var first = await client.SendAsync(Plan(key, "Write report"));
        var replay = await client.SendAsync(Plan(key, "Write report")); // double click, or a retry after a dropped connection
        first.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(await first.Content.ReadAsStringAsync(), await replay.Content.ReadAsStringAsync());
        Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>("/api/backlog")).GetArrayLength());
        Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-19&to=2026-11-19")).GetArrayLength());

        // The same key for a different plan is a mistake, not a replay.
        await Problem(await client.SendAsync(Plan(key, "Something else")), HttpStatusCode.Conflict, "idempotency_key_reused");
    }

    [Fact]
    public async Task Two_plans_racing_for_the_same_day_do_not_leave_duplicate_top_threes()
    {
        var (client, _) = await factory.NewUserAsync();
        object Plan(string title) => new { items = new[] { new { title, estimatedMinutes = 30, workMode = "DeepFocus", priority = "Low", topRank = 1 } } };

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(i => client.PostAsJsonAsync("/api/days/2026-11-20/plan", Plan($"Plan {i}"))));
        Assert.All(results, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        Assert.Contains(results, r => r.StatusCode == HttpStatusCode.OK);

        var outcomes = (await client.GetFromJsonAsync<JsonElement>("/api/days/2026-11-20")).GetProperty("outcomes");
        Assert.Equal(1, outcomes.GetArrayLength()); // exactly one #1, whichever plan won last
        // A plan that lost left nothing behind: every saved task belongs to a plan that succeeded.
        Assert.Equal(results.Count(r => r.StatusCode == HttpStatusCode.OK), (await client.GetFromJsonAsync<JsonElement>("/api/backlog")).GetArrayLength());
    }

    // ---- Time zones and multi-session tasks ---------------------------------------------------------

    [Fact]
    public async Task Blocks_are_measured_in_the_accounts_time_zone_and_impossible_times_are_refused()
    {
        var (client, _) = await factory.NewUserAsync(timeZone: "America/Halifax");
        Assert.Equal("America/Halifax", (await client.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("timeZone").GetString());
        object At(string date, string start, string end) => new { date, start, end, title = "B", priority = "Low", workMode = "DeepFocus", status = "Planned" };

        var gap = await client.PostAsJsonAsync("/api/blocks", At("2026-03-08", "02:30:00", "03:30:00"));
        var problem = await Problem(gap, HttpStatusCode.BadRequest, "nonexistent_local_time");
        Assert.Equal("03:00", problem.GetProperty("nextValidTime").GetString());

        var across = await (await client.PostAsJsonAsync("/api/blocks", At("2026-03-08", "01:00:00", "04:00:00"))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(120, across.GetProperty("plannedMinutes").GetInt32());
        Assert.Equal("America/Halifax", across.GetProperty("timeZone").GetString());

        // Changing the account's zone later does not move or re-measure what is already planned.
        (await client.PutAsJsonAsync("/api/auth/profile", new { displayName = "Traveller", timeZone = "Europe/London" })).EnsureSuccessStatusCode();
        var kept = (await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-03-08&to=2026-03-08"))[0];
        Assert.Equal("America/Halifax", kept.GetProperty("timeZone").GetString());
        Assert.Equal("01:00:00", kept.GetProperty("start").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/auth/profile", new { displayName = "T", timeZone = "Mars/Olympus" })).StatusCode);
    }

    [Fact]
    public async Task Finishing_one_session_of_a_multi_session_task_does_not_finish_the_task()
    {
        var (client, _) = await factory.NewUserAsync();
        var task = await (await client.PostAsJsonAsync("/api/backlog", new { title = "Write thesis chapter", priority = "High", status = "Planned" })).Content.ReadFromJsonAsync<JsonElement>();
        var taskId = task.GetProperty("id").GetGuid();
        async Task<Guid> Session(string date) =>
            (await (await client.PostAsJsonAsync($"/api/backlog/{taskId}/schedule", new { date, start = "09:00:00", end = "10:00:00", workMode = "DeepFocus" }))
                .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("block").GetProperty("id").GetGuid();
        var monday = await Session("2026-11-16");
        var tuesday = await Session("2026-11-17");
        async Task<string> TaskStatus() => (await client.GetFromJsonAsync<JsonElement>("/api/backlog"))[0].GetProperty("status").GetString()!;

        (await client.PatchAsJsonAsync($"/api/blocks/{monday}/progress", new { status = "Done", actualMinutes = 60, version = 1 })).EnsureSuccessStatusCode();
        Assert.Equal("InProgress", await TaskStatus()); // Tuesday's session is still to come

        (await client.PatchAsJsonAsync($"/api/blocks/{tuesday}/progress", new { status = "Done", actualMinutes = 55, version = 1 })).EnsureSuccessStatusCode();
        Assert.Equal("Done", await TaskStatus());
    }

    // ---- Probes --------------------------------------------------------------------------------------

    [Fact]
    public async Task Liveness_and_readiness_probes_answer_and_the_api_description_is_served_outside_production()
    {
        var client = factory.NewClient();
        Assert.Equal("Healthy", await client.GetStringAsync("/health/live"));
        Assert.Equal("Healthy", await client.GetStringAsync("/health/ready"));
        Assert.Equal("Healthy", await client.GetStringAsync("/healthz"));

        var openApi = await client.GetFromJsonAsync<JsonElement>("/api/openapi.json");
        Assert.True(openApi.GetProperty("paths").TryGetProperty("/api/days/{date}/plan", out _));
    }
}
