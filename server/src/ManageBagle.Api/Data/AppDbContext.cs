using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options), IDataProtectionKeyContext
{
    public DbSet<FocusArea> FocusAreas => Set<FocusArea>();
    public DbSet<TimeBlock> TimeBlocks => Set<TimeBlock>();
    public DbSet<BacklogTask> BacklogTasks => Set<BacklogTask>();
    public DbSet<DailyOutcome> DailyOutcomes => Set<DailyOutcome>();
    public DbSet<DailyReview> DailyReviews => Set<DailyReview>();
    public DbSet<DayTheme> DayThemes => Set<DayTheme>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<Routine> Routines => Set<Routine>();
    public DbSet<CalendarConnection> CalendarConnections => Set<CalendarConnection>();
    public DbSet<ExternalEvent> ExternalEvents => Set<ExternalEvent>();

    /// <summary>Every edit to a versioned row moves its version on, so a stale writer is detected (HTTP 409).</summary>
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        // Rows changed as a side effect (a task finished because its block was) move on here; rows
        // edited through an endpoint already claimed their next version in Versioning.Check.
        foreach (var entry in ChangeTracker.Entries<IVersioned>().Where(e => e.State == EntityState.Modified && !e.Property(v => v.Version).IsModified))
        {
            entry.Entity.Version = entry.Property(e => e.Version).OriginalValue + 1;
        }
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<AppUser>().Property(u => u.DisplayName).HasMaxLength(80);
        b.Entity<AppUser>().Property(u => u.TimeZoneId).HasMaxLength(64);
        b.Entity<AppUser>().Property(u => u.BreakColor).HasMaxLength(16);
        b.Entity<AppUser>().Property(u => u.CalendarFeedTokenProtected).HasMaxLength(500);
        b.Entity<AppUser>().Property(u => u.CalendarFeedTokenHash).HasMaxLength(64);
        b.Entity<AppUser>().HasIndex(u => u.CalendarFeedTokenHash).IsUnique().HasFilter("\"CalendarFeedTokenHash\" IS NOT NULL");

        b.Entity<FocusArea>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(60);
            e.Property(x => x.Color).HasMaxLength(16);
            e.Property(x => x.BreakPlacement).HasConversion<string>().HasMaxLength(8).HasDefaultValue(Domain.BreakPlacement.After).HasSentinel(Domain.BreakPlacement.After);
            e.HasIndex(x => new { x.UserId, x.SortOrder });
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TimeBlock>(e =>
        {
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Notes).HasMaxLength(2000);
            e.Property(x => x.Priority).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.WorkMode).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.TimeZoneId).HasMaxLength(64);
            e.Property(x => x.Version).IsConcurrencyToken().HasDefaultValue(1);
            e.HasIndex(x => new { x.UserId, x.Date });
            e.Property(x => x.StopNote).HasMaxLength(500);
            e.Ignore(x => x.TimerRunning);
            // One running timer per account is a database fact, not only a screen rule (ADR-013).
            e.HasIndex(x => x.UserId).IsUnique().HasFilter("\"TimerStartedAt\" IS NOT NULL").HasDatabaseName("IX_TimeBlocks_OneRunningTimer");
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.FocusArea).WithMany().HasForeignKey(x => x.FocusAreaId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.BacklogTask).WithMany().HasForeignKey(x => x.BacklogTaskId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<BacklogTask>(e =>
        {
            e.Property(x => x.Version).IsConcurrencyToken().HasDefaultValue(1);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.NextStep).HasMaxLength(200);
            e.Property(x => x.Priority).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.WorkMode).HasConversion<string>().HasMaxLength(16).HasDefaultValue(WorkMode.DeepFocus);
            e.Property(x => x.Impact).HasConversion<string>().HasMaxLength(16).HasDefaultValue(Priority.Medium).HasSentinel(Priority.Medium);
            e.HasIndex(x => new { x.UserId, x.Status });
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.FocusArea).WithMany().HasForeignKey(x => x.FocusAreaId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<DailyOutcome>(e =>
        {
            e.Property(x => x.Result).HasMaxLength(200);
            e.Property(x => x.NextAction).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(x => new { x.UserId, x.Date, x.Rank }).IsUnique();
            e.HasOne(x => x.BacklogTask).WithMany().HasForeignKey(x => x.BacklogTaskId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.FocusArea).WithMany().HasForeignKey(x => x.FocusAreaId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<DailyReview>(e =>
        {
            e.Property(x => x.BiggestWin).HasMaxLength(1000);
            e.Property(x => x.Interruptions).HasMaxLength(1000);
            e.Property(x => x.ChangeTomorrow).HasMaxLength(1000);
            e.HasIndex(x => new { x.UserId, x.Date }).IsUnique();
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CalendarConnection>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.UrlProtected).HasMaxLength(4000);
            e.Property(x => x.Host).HasMaxLength(255);
            e.Property(x => x.LastError).HasMaxLength(200);
            e.HasIndex(x => x.UserId);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Events).WithOne().HasForeignKey(x => x.ConnectionId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ExternalEvent>(e =>
        {
            e.Property(x => x.Title).HasMaxLength(200);
            e.HasIndex(x => new { x.UserId, x.StartUtc });
        });

        b.Entity<Routine>(e =>
        {
            e.Property(x => x.Title).HasMaxLength(80);
            e.Property(x => x.TaskPolicy).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Color).HasMaxLength(16);
            e.Property(x => x.Days).HasConversion<int>();
            e.HasIndex(x => x.UserId);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Areas).WithOne().HasForeignKey(x => x.RoutineId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RoutineArea>(e =>
        {
            e.HasKey(x => new { x.RoutineId, x.FocusAreaId });
            // Deleting a focus area removes it from routines that accepted it.
            e.HasOne<FocusArea>().WithMany().HasForeignKey(x => x.FocusAreaId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AuditEvent>(e =>
        {
            e.Property(x => x.Event).HasMaxLength(40);
            e.Property(x => x.Detail).HasMaxLength(100);
            e.HasIndex(x => new { x.UserId, x.At });
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<IdempotencyRecord>(e =>
        {
            e.Property(x => x.Key).HasMaxLength(64);
            e.Property(x => x.RequestHash).HasMaxLength(64);
            e.HasIndex(x => new { x.UserId, x.Key }).IsUnique();
            e.HasIndex(x => x.ExpiresAt);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<DayTheme>(e =>
        {
            e.Property(x => x.PrimaryFocus).HasMaxLength(80);
            e.Property(x => x.Outcome).HasMaxLength(200);
            e.Property(x => x.Review).HasMaxLength(500);
            e.Property(x => x.Day).HasConversion<string>().HasMaxLength(12);
            e.HasIndex(x => new { x.UserId, x.Day }).IsUnique();
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
