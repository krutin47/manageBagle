using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

public record AreaRequest([Required, StringLength(60, MinimumLength = 1)] string Name, [Required] string Color);

public record AreaResponse(Guid Id, string Name, string Color, int SortOrder);

public record ReorderRequest([Required] Guid[] Ids);

public static class AreaEndpoints
{
    public const int MaxAreas = 12;

    public static void MapAreaEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/areas").RequireAuthorization().WithTags("Focus areas");

        g.MapGet("", async (ClaimsPrincipal user, AppDbContext db) =>
            await db.FocusAreas.Where(a => a.UserId == user.UserId()).OrderBy(a => a.SortOrder)
                .Select(a => new AreaResponse(a.Id, a.Name, a.Color, a.SortOrder)).ToListAsync());

        g.MapPost("", async (AreaRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (!AreaColors.All.Contains(req.Color)) return HttpExtensions.Invalid("color", "Pick one of the available colours.");
            var uid = user.UserId();
            var existing = await db.FocusAreas.Where(a => a.UserId == uid).Select(a => a.SortOrder).ToListAsync();
            if (existing.Count >= MaxAreas)
            {
                return HttpExtensions.Invalid("name", $"You can have up to {MaxAreas} focus areas. Fewer areas make for a clearer week.");
            }
            var area = new FocusArea { UserId = uid, Name = req.Name.Trim(), Color = req.Color, SortOrder = existing.Count == 0 ? 0 : existing.Max() + 1 };
            db.FocusAreas.Add(area);
            await db.SaveChangesAsync();
            return Results.Created($"/api/areas/{area.Id}", new AreaResponse(area.Id, area.Name, area.Color, area.SortOrder));
        });

        g.MapPut("/{id:guid}", async (Guid id, AreaRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (!AreaColors.All.Contains(req.Color)) return HttpExtensions.Invalid("color", "Pick one of the available colours.");
            var area = await db.FocusAreas.FirstOrDefaultAsync(a => a.Id == id && a.UserId == user.UserId());
            if (area is null) return Results.NotFound();
            area.Name = req.Name.Trim();
            area.Color = req.Color;
            await db.SaveChangesAsync();
            return Results.Ok(new AreaResponse(area.Id, area.Name, area.Color, area.SortOrder));
        });

        g.MapPut("/order", async (ReorderRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var areas = await db.FocusAreas.Where(a => a.UserId == user.UserId()).ToListAsync();
            foreach (var area in areas)
            {
                var index = Array.IndexOf(req.Ids, area.Id);
                if (index >= 0) area.SortOrder = index;
            }
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Blocks, tasks and outcomes that used the area are kept and become "unassigned".
        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var area = await db.FocusAreas.FirstOrDefaultAsync(a => a.Id == id && a.UserId == user.UserId());
            if (area is null) return Results.NotFound();
            db.FocusAreas.Remove(area);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    /// <summary>True when the id is null or names one of the caller's own areas.</summary>
    public static async Task<bool> OwnsAreaAsync(this AppDbContext db, Guid userId, Guid? areaId) =>
        areaId is null || await db.FocusAreas.AnyAsync(a => a.Id == areaId && a.UserId == userId);
}
