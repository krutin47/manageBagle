using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManageBagle.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PlanningAndProviders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsOutside",
                table: "TimeBlocks",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "BacklogTaskId",
                table: "DailyOutcomes",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsOutside",
                table: "BacklogTasks",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "WorkMode",
                table: "BacklogTasks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "DeepFocus");

            migrationBuilder.CreateIndex(
                name: "IX_DailyOutcomes_BacklogTaskId",
                table: "DailyOutcomes",
                column: "BacklogTaskId");

            migrationBuilder.AddForeignKey(
                name: "FK_DailyOutcomes_BacklogTasks_BacklogTaskId",
                table: "DailyOutcomes",
                column: "BacklogTaskId",
                principalTable: "BacklogTasks",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DailyOutcomes_BacklogTasks_BacklogTaskId",
                table: "DailyOutcomes");

            migrationBuilder.DropIndex(
                name: "IX_DailyOutcomes_BacklogTaskId",
                table: "DailyOutcomes");

            migrationBuilder.DropColumn(
                name: "IsOutside",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "BacklogTaskId",
                table: "DailyOutcomes");

            migrationBuilder.DropColumn(
                name: "IsOutside",
                table: "BacklogTasks");

            migrationBuilder.DropColumn(
                name: "WorkMode",
                table: "BacklogTasks");
        }
    }
}
