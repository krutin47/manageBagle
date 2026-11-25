using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ManageBagle.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CalendarFeedAndImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CalendarFeedTokenHash",
                table: "AspNetUsers",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CalendarFeedTokenProtected",
                table: "AspNetUsers",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CalendarConnections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    UrlProtected = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    Host = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    LastFetchedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EventCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CalendarConnections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CalendarConnections_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ExternalEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ConnectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExternalEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExternalEvents_CalendarConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalTable: "CalendarConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_CalendarFeedTokenHash",
                table: "AspNetUsers",
                column: "CalendarFeedTokenHash",
                unique: true,
                filter: "\"CalendarFeedTokenHash\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CalendarConnections_UserId",
                table: "CalendarConnections",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ExternalEvents_ConnectionId",
                table: "ExternalEvents",
                column: "ConnectionId");

            migrationBuilder.CreateIndex(
                name: "IX_ExternalEvents_UserId_StartUtc",
                table: "ExternalEvents",
                columns: new[] { "UserId", "StartUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExternalEvents");

            migrationBuilder.DropTable(
                name: "CalendarConnections");

            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_CalendarFeedTokenHash",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "CalendarFeedTokenHash",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "CalendarFeedTokenProtected",
                table: "AspNetUsers");
        }
    }
}
