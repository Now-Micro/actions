namespace Trafera.Messaging.MassTransit.Options;

/// <summary>
/// Configuration options for Trafera MassTransit integration.
/// </summary>
public sealed class MassTransitOptions
{
    /// <summary>
    /// Gets or sets the RabbitMQ connection string.
    /// </summary>
    public required string RabbitMqConnectionString { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the MongoDB outbox is enabled.
    /// </summary>
    public bool EnableMongoOutbox { get; set; } = true;

    /// <summary>
    /// Gets or sets the MongoDB connection string used by the outbox.
    /// </summary>
    public string? MongoConnectionString { get; set; }

    /// <summary>
    /// Gets or sets the MongoDB database name used by the outbox.
    /// </summary>
    public string? MongoDatabaseName { get; set; }

    /// <summary>
    /// Gets or sets the MongoDB collection name for the outbox.
    /// </summary>
    public string MongoOutboxCollectionName { get; set; } = "outbox";
}
