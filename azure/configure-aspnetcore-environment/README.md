# Configure ASPNETCORE_ENVIRONMENT

This action uses Azure CLI to set the `ASPNETCORE_ENVIRONMENT` app setting on an Azure Web App.

## Usage

```yaml
- name: Configure ASP.NET Core environment
  uses: ./azure/configure-aspnetcore-environment
  with:
    app-name: my-web-app
    resource-group-name: my-resource-group
    aspnet-environment: Production
```