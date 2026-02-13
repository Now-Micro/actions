using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using MassTransit;
using Microsoft.AspNetCore.Mvc;
using Trafera.Aspire.ServiceDefaults;
using Trafera.DICE.Shared.Events;

var builder = WebApplication.CreateBuilder(args);

builder.AddTraferaServiceDefaults();

builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddMassTransit(x =>
{
    x.UsingRabbitMq(
        (context, cfg) =>
        {
            var rabbitMqConnectionString = builder.Configuration.GetConnectionString("RabbitMQ");
            if (string.IsNullOrWhiteSpace(rabbitMqConnectionString))
            {
                throw new InvalidOperationException(
                    "RabbitMQ connection string is not configured."
                );
            }
            cfg.Host(new Uri(rabbitMqConnectionString));
        }
    );
});

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.WriteIndented = false;
});

var app = builder.Build();

app.UseExceptionHandler("/error");
app.UseStatusCodePages();
app.UseDefaultFiles();
app.UseStaticFiles();

app.Map("/error", () => Results.Problem("An unexpected error occurred."));

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/api/device-created", PublishDeviceEvent<DeviceCreated>("DeviceCreated"));
app.MapPost("/api/device-updated", PublishDeviceEvent<DeviceUpdated>("DeviceUpdated"));

app.MapFallbackToFile("index.html");

app.Run();

Delegate PublishDeviceEvent<T>(string eventName)
    where T : class
{
    return async (
        [FromBody] DeviceEventRequest request,
        IPublishEndpoint publisher,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken
    ) =>
    {
        var payload = new
        {
            SerialNumber = request.SerialNumber,
            CustomerNumber = request.CustomerNumber,
            Manufacturer = request.Manufacturer,
            SourceSystem = string.IsNullOrWhiteSpace(request.SourceSystem)
                ? "Trigger"
                : request.SourceSystem,
            RequestedBy = string.IsNullOrWhiteSpace(request.RequestedBy)
                ? "Trigger"
                : request.RequestedBy,
        };

        await publisher.Publish<T>(payload, cancellationToken).ConfigureAwait(false);

        var logger = loggerFactory.CreateLogger("TriggerPublisher");
        logger.LogInformation(
            "Published {EventName} for serial {Serial}, customer {Customer}",
            eventName,
            payload.SerialNumber,
            payload.CustomerNumber
        );

        return Results.Ok(
            new
            {
                published = eventName,
                payload.SerialNumber,
                payload.CustomerNumber,
                payload.Manufacturer,
            }
        );
    };
}

internal sealed record DeviceEventRequest
{
    [Required]
    public string SerialNumber { get; init; } = string.Empty;

    [Required]
    public string CustomerNumber { get; init; } = string.Empty;

    [Required]
    public string Manufacturer { get; init; } = "Unknown";

    public string? SourceSystem { get; init; } = "Trigger";

    public string? RequestedBy { get; init; } = "Trigger";
}
