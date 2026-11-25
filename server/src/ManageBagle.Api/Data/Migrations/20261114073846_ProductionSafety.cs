using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManageBagle.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ProductionSafety : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PlannedMinutes",
                table: "TimeBlocks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "TimeBlocks",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "TimeBlocks",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "BacklogTasks",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "AspNetUsers",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "IdempotencyRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResponseJson = table.Column<string>(type: "text", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IdempotencyRecords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IdempotencyRecords_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IdempotencyRecords_ExpiresAt",
                table: "IdempotencyRecords",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_IdempotencyRecords_UserId_Key",
                table: "IdempotencyRecords",
                columns: new[] { "UserId", "Key" },
                unique: true);
                    // Existing blocks: fix their length from the wall clock, exactly as it was computed before
            // (an end before the start runs past midnight). No date or time is changed.
            migrationBuilder.Sql("""
                UPDATE "TimeBlocks"
                SET "PlannedMinutes" = ((CAST(EXTRACT(EPOCH FROM ("End" - "Start")) AS integer) / 60) + 1440) % 1440;
                """);

            // Accounts created before email confirmation existed keep working. This is safe because a
            // confirmed address no longer attaches outside identities to an account (see ADR-007).
            migrationBuilder.Sql("""UPDATE "AspNetUsers" SET "EmailConfirmed" = TRUE WHERE "EmailConfirmed" = FALSE;""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "IdempotencyRecords");

            migrationBuilder.DropColumn(
                name: "PlannedMinutes",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "BacklogTasks");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "AspNetUsers");
        }
    }
}
