using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManageBagle.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TaskImpact : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Impact",
                table: "BacklogTasks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Medium");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Impact",
                table: "BacklogTasks");
        }
    }
}
