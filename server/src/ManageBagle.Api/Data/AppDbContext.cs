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

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<AppUser>().Property(u => u.DisplayName).HasMaxLength(80);

        b.Entity<FocusArea>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(60);
            e.Property(x => x.Color).HasMaxLength(16);
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
            e.Ignore(x => x.PlannedMinutes);
            e.HasIndex(x => new { x.UserId, x.Date });
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.FocusArea).WithMany().HasForeignKey(x => x.FocusAreaId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.BacklogTask).WithMany().HasForeignKey(x => x.BacklogTaskId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<BacklogTask>(e =>
        {
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.NextStep).HasMaxLength(200);
            e.Property(x => x.Priority).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.WorkMode).HasConversion<string>().HasMaxLength(16).HasDefaultValue(WorkMode.DeepFocus);
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
