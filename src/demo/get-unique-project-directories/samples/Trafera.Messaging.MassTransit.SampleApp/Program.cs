using MassTransit;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Trafera.Messaging.Abstractions;
using Trafera.Messaging.MassTransit;
using Trafera.Messaging.MassTransit.Consumers;
using Trafera.Messaging.MediatR;

namespace Trafera.Messaging.MassTransit.SampleApp;

public static class Program
{
    /// <summary>
    /// Demonstrates registering Trafera.Messaging.MassTransit with zero-logic consumers.
    /// </summary>
    /// <param name="args">Command-line arguments.</param>
    public static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        builder.Services.AddMessagingMediatR(assemblies: typeof(Program).Assembly);

        var mongoConnection = Environment.GetEnvironmentVariable("MONGODB_CONNECTION");
        var mongoDatabase = Environment.GetEnvironmentVariable("MONGODB_DATABASE");

        builder.Services.AddMessagingMassTransit(
            options =>
            {
                options.RabbitMqConnectionString =
                    Environment.GetEnvironmentVariable("RABBITMQ_CONNECTION")
                    ?? "amqp://guest:guest@localhost:5672/";

                if (
                    !string.IsNullOrWhiteSpace(mongoConnection)
                    && !string.IsNullOrWhiteSpace(mongoDatabase)
                )
                {
                    options.MongoConnectionString = mongoConnection;
                    options.MongoDatabaseName = mongoDatabase;
                }
                else
                {
                    options.EnableMongoOutbox = false;
                }
            },
            typeof(Program).Assembly
        );

        using var host = builder.Build();

        await host.StartAsync().ConfigureAwait(false);

        var publishEndpoint = host.Services.GetRequiredService<IPublishEndpoint>();
        await publishEndpoint
            .Publish<IOrderShipped>(new { OrderId = Guid.NewGuid() })
            .ConfigureAwait(false);

        await host.StopAsync().ConfigureAwait(false);
    }
}

/// <summary>
/// Represents an external integration event contract.
/// </summary>
public interface IOrderShipped : IIntegrationEvent
{
    /// <summary>
    /// Gets the order identifier.
    /// </summary>
    Guid OrderId { get; }
}

/// <summary>
/// Represents a sample internal command.
/// </summary>
public sealed record FlagOrderInternal(Guid OrderId) : IInternalCommand, IRequest;

/// <summary>
/// Handles the <see cref="FlagOrderInternal"/> command.
/// </summary>
public sealed class FlagOrderInternalHandler : IRequestHandler<FlagOrderInternal>
{
    /// <summary>
    /// Handles the request.
    /// </summary>
    /// <param name="request">The request instance.</param>
    /// <param name="cancellationToken">The cancellation token.</param>
    /// <returns>A completed task.</returns>
    public Task Handle(FlagOrderInternal request, CancellationToken cancellationToken)
    {
        Console.WriteLine($"Received order {request.OrderId}");
        return Task.CompletedTask;
    }
}

/// <summary>
/// Consumes external messages and dispatches internal commands.
/// </summary>
public sealed class OrderShippedConsumer : ExternalMessageConsumer<IOrderShipped, FlagOrderInternal>
{
    /// <summary>
    /// Initializes a new instance of the <see cref="OrderShippedConsumer"/> class.
    /// </summary>
    /// <param name="mediator">The mediator used for dispatching.</param>
    public OrderShippedConsumer(IMediator mediator)
        : base(mediator) { }

    /// <summary>
    /// Maps the external message to an internal command.
    /// </summary>
    /// <param name="message">The external message.</param>
    /// <returns>The internal command.</returns>
    protected override FlagOrderInternal MapToCommand(IOrderShipped message)
    {
        return new FlagOrderInternal(message.OrderId);
    }
}
