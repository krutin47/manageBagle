# syntax=docker/dockerfile:1

# 1. Build the React client
FROM node:22-alpine AS client
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# 2. Publish the API
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /src
COPY server/src/ManageBagle.Api/ManageBagle.Api.csproj server/src/ManageBagle.Api/
RUN dotnet restore server/src/ManageBagle.Api/ManageBagle.Api.csproj
COPY server/src/ server/src/
RUN dotnet publish server/src/ManageBagle.Api/ManageBagle.Api.csproj -c Release -o /app --no-restore

# 3. One small runtime image: the API serves the client from wwwroot
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=server /app ./
COPY --from=client /src/client/dist ./wwwroot
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_gcServer=0
EXPOSE 8080
USER $APP_UID
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["dotnet", "ManageBagle.Api.dll", "--healthcheck"]
ENTRYPOINT ["dotnet", "ManageBagle.Api.dll"]
