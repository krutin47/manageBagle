using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManageBagle.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TaskClosedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ClosedAt",
                table: "BacklogTasks",
                type: "timestamp with time zone",
                nullable: true);

            // Tasks already closed get "now", so they stay on the board for the next 30 days and then
            // age out, instead of vanishing at once. Open tasks keep null.
            migrationBuilder.Sql("""UPDATE "BacklogTasks" SET "ClosedAt" = now() WHERE "Status" IN ('Done', 'Skipped');""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClosedAt",
                table: "BacklogTasks");
        }
    }
}
