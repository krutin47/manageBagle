using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManageBagle.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class FocusTimer : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ExtendedMinutes",
                table: "TimeBlocks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "FinishedAt",
                table: "TimeBlocks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "FirstStartedAt",
                table: "TimeBlocks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StopNote",
                table: "TimeBlocks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TimerStartedAt",
                table: "TimeBlocks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TrackedSeconds",
                table: "TimeBlocks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_TimeBlocks_OneRunningTimer",
                table: "TimeBlocks",
                column: "UserId",
                unique: true,
                filter: "\"TimerStartedAt\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TimeBlocks_OneRunningTimer",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "ExtendedMinutes",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "FinishedAt",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "FirstStartedAt",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "StopNote",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "TimerStartedAt",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "TrackedSeconds",
                table: "TimeBlocks");
        }
    }
}
