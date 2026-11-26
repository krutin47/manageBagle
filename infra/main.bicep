// manageBagle on Azure Container Apps (ADR-017). One template, deployed once per environment.
//
// Shared by UAT and production, to stay inside the Azure free tier for the first year:
//   Log Analytics (logs kept 30 days), the Container Apps environment, one PostgreSQL Flexible
//   Server (Burstable B1ms, backups kept 35 days).
// Per environment: its own database, the app (Container App) and a migration job.
//
// Deployed by .github/workflows/release.yml; see docs/azure-setup.md.

targetScope = 'resourceGroup'

@allowed(['uat', 'prod'])
param environmentName string
param location string = resourceGroup().location
@description('Image to run, e.g. ghcr.io/owner/managebagle@sha256:…')
param image string

@secure()
param postgresAdminPassword string
param postgresAdminLogin string = 'managebagle'

@description('Optional: a custom domain later; empty uses the Azure address.')
param publicUrl string = ''

param smtpHost string = ''
param smtpPort int = 587
param smtpUsername string = ''
@secure()
param smtpPassword string = ''
param smtpFrom string = ''

param googleClientId string = ''
@secure()
param googleClientSecret string = ''
param microsoftClientId string = ''
@secure()
param microsoftClientSecret string = ''

@secure()
param sentryDsn string = ''
@secure()
param anthropicApiKey string = ''
@description('Model for the AI brain dump; empty uses the app default (claude-opus-5-5).')
param aiModel string = ''

@description('Only if the image package is private: a GitHub token with read:packages.')
@secure()
param ghcrPullToken string = ''
param ghcrUsername string = ''

var prefix = 'managebagle'
var appName = '${prefix}-${environmentName}'
var databaseName = '${prefix}_${environmentName}'
var aspnetEnvironment = environmentName == 'prod' ? 'Production' : 'UAT'

// ---- Shared ------------------------------------------------------------------------------------

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30 // agreed retention for logs (docs/data-inventory.md)
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2022-12-01' = {
  name: '${prefix}-db-${uniqueString(resourceGroup().id)}'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 35, geoRedundantBackup: 'Disabled' } // agreed retention for backups
    highAvailability: { mode: 'Disabled' }
  }
}

// Container Apps without a private network reach the database over Azure's backbone; TLS is required
// by the server, and the password never leaves Azure and GitHub secrets.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// ---- This environment --------------------------------------------------------------------------

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2022-12-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

var fqdn = '${appName}.${containerEnv.properties.defaultDomain}'
var url = empty(publicUrl) ? 'https://${fqdn}' : publicUrl
var connectionString = 'Host=${postgres.properties.fullyQualifiedDomainName};Database=${databaseName};Username=${postgresAdminLogin};Password=${postgresAdminPassword};SSL Mode=Require'

// Optional settings are left out entirely when empty: an empty secret is rejected by Container Apps.
var allSecrets = [
  { name: 'db-connection', value: connectionString }
  { name: 'smtp-password', value: smtpPassword }
  { name: 'google-secret', value: googleClientSecret }
  { name: 'microsoft-secret', value: microsoftClientSecret }
  { name: 'sentry-dsn', value: sentryDsn }
  { name: 'anthropic-key', value: anthropicApiKey }
  { name: 'ghcr-token', value: ghcrPullToken }
]
var secrets = filter(allSecrets, s => !empty(s.value))
var hasSecret = toObject(secrets, s => s.name, s => true)

var plainEnv = [
  { name: 'ASPNETCORE_ENVIRONMENT', value: aspnetEnvironment }
  { name: 'App__PublicUrl', value: url }
  { name: 'AllowedHosts', value: empty(publicUrl) ? fqdn : '${fqdn};${replace(replace(publicUrl, 'https://', ''), '/', '')}' }
  // The app is reachable only through the Container Apps ingress, so the ingress is the one proxy to
  // trust; ForwardLimit stays 1, so only its own hop is believed.
  { name: 'ForwardedHeaders__KnownNetworks', value: '0.0.0.0/0,::/0' }
  // B1ms allows 50 connections: 2 environments × up to 2 replicas × 10, plus the migration job and admin.
  { name: 'Database__MaxPoolSize', value: '10' }
  { name: 'Retention__AuditMonths', value: '13' } // agreed retention for account activity
  { name: 'Smtp__Host', value: smtpHost }
  { name: 'Smtp__Port', value: string(smtpPort) }
  { name: 'Smtp__Username', value: smtpUsername }
  { name: 'Smtp__From', value: smtpFrom }
  { name: 'Authentication__Google__ClientId', value: googleClientId }
  { name: 'Authentication__Microsoft__ClientId', value: microsoftClientId }
  { name: 'Ai__Model', value: aiModel }
  { name: 'Push__Subject', value: url } // identifies the sender to browser push services
]
var secretEnv = [
  { name: 'ConnectionStrings__Default', secretRef: 'db-connection' }
  { name: 'Smtp__Password', secretRef: 'smtp-password' }
  { name: 'Authentication__Google__ClientSecret', secretRef: 'google-secret' }
  { name: 'Authentication__Microsoft__ClientSecret', secretRef: 'microsoft-secret' }
  { name: 'Sentry__Dsn', secretRef: 'sentry-dsn' }
  { name: 'Ai__AnthropicApiKey', secretRef: 'anthropic-key' }
]
var env = concat(filter(plainEnv, e => !empty(e.value)), filter(secretEnv, e => contains(hasSecret, e.secretRef)))
var registries = empty(ghcrPullToken) ? [] : [ { server: 'ghcr.io', username: ghcrUsername, passwordSecretRef: 'ghcr-token' } ]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single' // a new revision takes traffic only once it is ready
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      secrets: secrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: env
          probes: [
            { type: 'Liveness', httpGet: { path: '/health/live', port: 8080 }, periodSeconds: 30 }
            // Not ready until migrations are applied, so a new version takes no traffic before then.
            { type: 'Readiness', httpGet: { path: '/health/ready', port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
            { type: 'Startup', httpGet: { path: '/health/live', port: 8080 }, periodSeconds: 5, failureThreshold: 24 }
          ]
        }
      ]
      scale: {
        // UAT sleeps when unused (a few seconds to wake); production keeps one instance warm.
        minReplicas: environmentName == 'prod' ? 1 : 0
        maxReplicas: 2
        rules: [ { name: 'http', http: { metadata: { concurrentRequests: '50' } } } ]
      }
    }
  }
}

// Migrations are a release step (ADR-009): this job runs the same image with --migrate.
resource migrate 'Microsoft.App/jobs@2024-03-01' = {
  name: '${appName}-migrate'
  location: location
  properties: {
    environmentId: containerEnv.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      secrets: filter(secrets, s => s.name == 'db-connection' || s.name == 'ghcr-token')
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: image
          args: [ '--migrate' ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'ASPNETCORE_ENVIRONMENT', value: aspnetEnvironment }
            { name: 'ConnectionStrings__Default', secretRef: 'db-connection' }
          ]
        }
      ]
    }
  }
}

output appUrl string = url
output appName string = app.name
output migrationJobName string = migrate.name
