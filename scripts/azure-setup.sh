#!/usr/bin/env bash
# One-time Azure setup for deploying manageBagle from GitHub (docs/azure-setup.md).
# Run in Azure Cloud Shell (Bash):   bash scripts/azure-setup.sh [owner/repo] [region] [resource-group]
#
# Creates: a resource group; an Entra application that GitHub Actions signs in as, using OpenID
# Connect federated credentials (no password or key is created or stored anywhere); permission for
# that application to manage only this resource group. Safe to run again.
set -euo pipefail

REPO="${1:-krutin47/manageBagle}"
LOCATION="${2:-eastus}"
RG="${3:-managebagle}"
APP_NAME="managebagle-github-deploy"

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "Subscription: $(az account show --query name -o tsv) ($SUBSCRIPTION_ID)"

for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.DBforPostgreSQL; do
  az provider register --namespace "$ns" --wait > /dev/null
done

az group create -n "$RG" -l "$LOCATION" -o none

CLIENT_ID="$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)"
if [ -z "$CLIENT_ID" ]; then
  CLIENT_ID="$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)"
fi
az ad sp show --id "$CLIENT_ID" -o none 2>/dev/null || az ad sp create --id "$CLIENT_ID" -o none

# GitHub may sign in as this application only from the repository's "uat" and "production" environments.
for env in uat production; do
  if ! az ad app federated-credential list --id "$CLIENT_ID" --query "[?name=='github-$env'].name" -o tsv | grep -q .; then
    az ad app federated-credential create --id "$CLIENT_ID" -o none --parameters "{
      \"name\": \"github-$env\",
      \"issuer\": \"https://token.actions.githubusercontent.com\",
      \"subject\": \"repo:$REPO:environment:$env\",
      \"audiences\": [\"api://AzureADTokenExchange\"]
    }"
  fi
done

SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG"
if ! az role assignment list --assignee "$CLIENT_ID" --scope "$SCOPE" --role Contributor --query '[0].id' -o tsv | grep -q .; then
  az role assignment create --assignee "$CLIENT_ID" --role Contributor --scope "$SCOPE" -o none
fi

cat <<OUT

Done. Add these in GitHub → Settings → Environments, to BOTH "uat" and "production",
as *variables* (they are not secrets):

  AZURE_CLIENT_ID        $CLIENT_ID
  AZURE_TENANT_ID        $TENANT_ID
  AZURE_SUBSCRIPTION_ID  $SUBSCRIPTION_ID
  AZURE_RESOURCE_GROUP   $RG

And this *secret*, the same value in both environments (the database password; keep no other copy):

  POSTGRES_ADMIN_PASSWORD  $(openssl rand -base64 32 | tr -d '/+=' | head -c 32)

OUT
