using MassTransit;
using Trafera.DICE.Shared.Events;

namespace Trafera.Messaging.Aspire.MockConsumerOne.Consumers;

/// <summary>
/// Consumes device lifecycle events from the DICE system and processes them through the warranty intake pipeline.
/// Handles both DeviceCreated and DeviceUpdated events.
/// </summary>
public sealed class DeviceEventConsumer : IConsumer<DeviceCreated>, IConsumer<DeviceUpdated>
{
    public DeviceEventConsumer() { }

    public Task Consume(ConsumeContext<DeviceCreated> context) =>
        HandleDeviceEventAsync(context, "DeviceCreated", "DICE - DeviceCreated");

    public Task Consume(ConsumeContext<DeviceUpdated> context) =>
        HandleDeviceEventAsync(context, "DeviceUpdated", "DICE - DeviceUpdated");

    private sealed record NormalizedDeviceData(
        string SerialNumber,
        string Manufacturer,
        string CustomerNumber
    );

    private async Task HandleDeviceEventAsync<T>(
        ConsumeContext<T> context,
        string eventLabel,
        string sourceSystem
    )
        where T : class
    {
        Console.WriteLine("Hello World!");

        // Do things here based on inputs to simulate different cases (e.g. throw if serial is ..., succeed otherwise, etc.)
    }
}
