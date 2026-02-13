using MassTransit;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using Trafera.Aspire.ServiceDefaults;
using Trafera.DICE.Shared.Events;
using Trafera.MassTransit;
using Trafera.Messaging.Aspire.MockConsumerOne.Consumers;
using Trafera.Warranty.Shared.Events;

const string DB_NAME = "testDb";
var builder = Host.CreateApplicationBuilder(args);
builder.AddTraferaServiceDefaults();

builder.Services.AddSingleton<IMongoClient>(sp => new MongoClient(
    builder.Configuration.GetConnectionString(DB_NAME)
));

builder.Services.AddSingleton(sp => sp.GetRequiredService<IMongoClient>().GetDatabase(DB_NAME));
builder.AddMassTransitHostApplicationBuilder(typeof(Program).Assembly);

var app = builder.Build();

app.Services.GetRequiredService<ILoggerFactory>()
    .CreateLogger("Startup")
    .LogInformation("Warranty mock consumer starting; waiting for WarrantyUpdated messages...");

await app.RunAsync();
