# Trafera.Warranty.Trigger

Trafera.Warranty.Trigger is a lightweight developer utility that lets you simulate RabbitMQ events that `Trafera.WarrantyService` consumes. Use its REST forms or automation helpers to publish `DeviceCreated` and `DeviceUpdated` messages without needing a full upstream system or message bus client library.

## Features

- Web-hosted UI that targets private RabbitMQ queues via MassTransit.
- `/api/device-created` and `/api/device-updated` endpoints that validate inputs and publish the corresponding MassTransit events.
- Bulk publish helper to flood the bus with sequential serial numbers for load or regression testing.
- Local-only HTML/JS interface shipped under `wwwroot/index.html` so you can fire events from the browser without touching the GraphQL service.

## Running locally

1. Ensure RabbitMQ is reachable (default connection string: `amqp://guest:guest@localhost:5672`).
2. From the solution root run:

```
dotnet run --project src/Trafera.Warranty.Trigger
```

1. Open `http://localhost:5000` (or the port reported by the console) to use the built-in UI. If you only need to hit the endpoints programmatically, POST to `/api/device-created` or `/api/device-updated` with a JSON body matching `DeviceEventRequest`.

## Configuration

All configuration is stored in `appsettings*.json`. The most important setting is the `ConnectionStrings:RabbitMQ` entry that points at your RabbitMQ broker. You can override it per-environment (e.g., `appsettings.Development.json`) or via `DOTNET_` environment variables.

```json
"ConnectionStrings": {
 "RabbitMQ": "amqp://guest:guest@localhost:5672"
}
```

Other defaults (logging, JSON serialization, Trafera service defaults) are pulled in automatically via `Trafera.Aspire.ServiceDefaults`.

## API contract

The two POST endpoints both accept the same schema:

```json
{
 "serialNumber": "string",       // required
 "customerNumber": "string",     // required
 "manufacturer": "string",       // required
 "sourceSystem": "string?",      // optional
 "requestedBy": "string?"        // optional
}
```

Responses mirror the published event metadata:

```json
{
 "published": "DeviceCreated",
 "serialNumber": "1BPX353",
 "customerNumber": "CUST-001",
 "manufacturer": "Dell"
}
```

HTTP 400 is returned when required fields are missing; the body contains the validation problem details.

## Frontend reference UI

`wwwroot/index.html` is a static experience that:

- Captures developer inputs for serial/customer/manufacturer/source/requestedBy.
- Hits `/api/device-created` and `/api/device-updated` to publish MassTransit events.
- Includes a log panel and bulk publish helper for rapid scenario iteration.

This HTML is self-hosted in the project, so you don’t need a separate SPA build step—just run the ASP.NET host and open it in your browser.

## Troubleshooting

- Verify RabbitMQ credentials and network reachability before hitting the trigger service.
- Watch the console or `dotnet watch` output for validation errors—missing `serialNumber`, `customerNumber`, or `manufacturer` will surface as validation problems.
- The MassTransit host URL must be a valid AMQP URI (`amqp://user:pass@host:port`).

## Testing

Currently this project does not include automated tests; validation happens at the endpoint level and relies on MassTransit’s wiring when publishing.
