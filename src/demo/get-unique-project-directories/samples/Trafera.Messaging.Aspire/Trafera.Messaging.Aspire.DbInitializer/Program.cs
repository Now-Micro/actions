using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Trafera.Aspire.ServiceDefaults;

namespace Trafera.Messaging.Aspire.DbInitializer;

public static class Program
{
    public static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);
        builder.AddTraferaServiceDefaults();

        builder.Services.AddSingleton<IMongoClient>(_ =>
        {
            var connectionString = builder.Configuration.GetConnectionString("mongoDb");
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                throw new InvalidOperationException(
                    "Mongo connection string 'mongoDb' is not configured."
                );
            }

            return new MongoClient(connectionString);
        });

        builder.Services.AddSingleton<IMongoDatabase>(sp =>
        {
            var client = sp.GetRequiredService<IMongoClient>();
            return client.GetDatabase("testDb");
        });

        builder.Services.AddHostedService<DatabaseInitializer>();

        using var app = builder.Build();
        await app.RunAsync().ConfigureAwait(false);
    }
}

internal sealed class DatabaseInitializer : IHostedService
{
    private static readonly IReadOnlyCollection<string> RequiredCollections = new[]
    {
        "testDbCollection",
    };

    private readonly IMongoDatabase database;
    private readonly ILogger<DatabaseInitializer> logger;

    public DatabaseInitializer(IMongoDatabase database, ILogger<DatabaseInitializer> logger)
    {
        this.database = database ?? throw new ArgumentNullException(nameof(database));
        this.logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var existingCollections = await database
            .ListCollectionNames()
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var collectionName in RequiredCollections)
        {
            if (existingCollections.Contains(collectionName, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            await database
                .CreateCollectionAsync(collectionName, cancellationToken: cancellationToken)
                .ConfigureAwait(false);
        }

        await EnsureIndexesAsync(cancellationToken).ConfigureAwait(false);

        logger.LogInformation("MongoDB collections and indexes ensured.");
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }

    private async Task EnsureIndexesAsync(CancellationToken cancellationToken)
    {
        var collection = database.GetCollection<WarrantyUpdateDocument>("testDbCollection");

        var indexKeys = Builders<WarrantyUpdateDocument>
            .IndexKeys.Ascending(x => x.SerialNumber)
            .Ascending(x => x.CustomerNumber);

        var indexModel = new CreateIndexModel<WarrantyUpdateDocument>(
            indexKeys,
            new CreateIndexOptions { Unique = true, Name = "serial_customer_unique" }
        );

        await collection
            .Indexes.CreateOneAsync(indexModel, cancellationToken: cancellationToken)
            .ConfigureAwait(false);
    }
}

internal sealed record WarrantyUpdateDocument(string SerialNumber, string CustomerNumber);
