# Azure Deploy

This action downloads a build artifact, updates the Azure Web App environment setting, and deploys the package to Azure Web Apps.

## Usage

```yaml
- name: Deploy to Azure Web App
  uses: ./azure/deploy
  with:
    app-name: my-web-app
    resource-group-name: my-resource-group
    aspnet-environment: Production
    artifact-name: build-artifacts
    path-to-package: publish/MyApp.zip
    azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
    azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    azure-subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```