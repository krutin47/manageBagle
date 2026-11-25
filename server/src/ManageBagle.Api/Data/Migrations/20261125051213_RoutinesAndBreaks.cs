using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManageBagle.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RoutinesAndBreaks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BreakAfterMinutes",
                table: "TimeBlocks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "BreakBeforeMinutes",
                table: "TimeBlocks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "BreakMinutes",
                table: "FocusAreas",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "BreakPlacement",
                table: "FocusAreas",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "After");

            migrationBuilder.AddColumn<int>(
                name: "BreakMinutes",
                table: "BacklogTasks",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "DayEnd",
                table: "AspNetUsers",
                type: "time without time zone",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "DayStart",
                table: "AspNetUsers",
                type: "time without time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WaterReminderMinutes",
                table: "AspNetUsers",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Routines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Days = table.Column<int>(type: "integer", nullable: false),
                    Start = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    End = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    TaskPolicy = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IsMeal = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Routines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Routines_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RoutineArea",
                columns: table => new
                {
                    RoutineId = table.Column<Guid>(type: "uuid", nullable: false),
                    FocusAreaId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoutineArea", x => new { x.RoutineId, x.FocusAreaId });
                    table.ForeignKey(
                        name: "FK_RoutineArea_FocusAreas_FocusAreaId",
                        column: x => x.FocusAreaId,
                        principalTable: "FocusAreas",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RoutineArea_Routines_RoutineId",
                        column: x => x.RoutineId,
                        principalTable: "Routines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RoutineArea_FocusAreaId",
                table: "RoutineArea",
                column: "FocusAreaId");

            migrationBuilder.CreateIndex(
                name: "IX_Routines_UserId",
                table: "Routines",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RoutineArea");

            migrationBuilder.DropTable(
                name: "Routines");

            migrationBuilder.DropColumn(
                name: "BreakAfterMinutes",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "BreakBeforeMinutes",
                table: "TimeBlocks");

            migrationBuilder.DropColumn(
                name: "BreakMinutes",
                table: "FocusAreas");

            migrationBuilder.DropColumn(
                name: "BreakPlacement",
                table: "FocusAreas");

            migrationBuilder.DropColumn(
                name: "BreakMinutes",
                table: "BacklogTasks");

            migrationBuilder.DropColumn(
                name: "DayEnd",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "DayStart",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "WaterReminderMinutes",
                table: "AspNetUsers");
        }
    }
}
