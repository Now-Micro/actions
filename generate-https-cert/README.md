# Generate HTTPS Certificate

This action creates a self-signed HTTPS certificate for local or CI use with .NET applications.

## Usage

```yaml
- name: Generate HTTPS certificate
  uses: ./generate-https-cert
  with:
    cert-path: certs/aspnetapp.pfx
    cert-password: ${{ secrets.CERT_PASSWORD }}
    working-directory: src/MyApp
```