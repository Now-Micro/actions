using AspireMongoReplicaSet.Replica;

var builder = DistributedApplication.CreateBuilder(args);

// Determine if we're in publish mode (deploying) vs run mode (local development)
var isPublishMode = builder.ExecutionContext.IsPublishMode;

// MongoDB
var mongoPort = 49998;
var username = builder.AddParameter("mongo-user", "admin");
var password = builder.AddParameter("mongo-password", "admin");
var mongo = builder
    .AddMongoDB("mongo", mongoPort, username, password)
    .WithLifetime(ContainerLifetime.Persistent)
    .WithReplicaSet("./AspireMongoReplicaSet");

var db = mongo.AddDatabase("testDb");
var mongoReplicaSet = builder.AddMongoReplicaSet("mongoDb", db.Resource);

// Everything inside this block will only be run when running locally
if (!isPublishMode)
{
    var rabbitUsername = builder.AddParameter("RabbitMqUsername", "admin", secret: true);
    var rabbitPassword = builder.AddParameter("RabbitMqPassword", "admin", secret: true);
    var rabbitMq = builder
        .AddRabbitMQ("rabbitmq", rabbitUsername, rabbitPassword)
        .WithManagementPlugin();

    builder
        .AddProject<Projects.Trafera_Messaging_Aspire_Trigger>("Trigger")
        .WithReference(rabbitMq)
        .WaitFor(rabbitMq);

    builder
        .AddProject<Projects.Trafera_Messaging_Aspire_MockConsumerOne>("MockConsumerOne")
        .WithEnvironment("MassTransit__EnableTransactionalMongoDbOutbox", "true")
        .WithReference(rabbitMq)
        .WithReference(mongoReplicaSet)
        .WithReference(db)
        .WaitFor(rabbitMq)
        .WaitFor(mongoReplicaSet)
        .WaitFor(db);

     builder
        .AddProject<Projects.Trafera_Messaging_Aspire_MockConsumerTwo>("MockConsumerTwo")
        .WithEnvironment("MassTransit__EnableTransactionalMongoDbOutbox", "true")
        .WithReference(rabbitMq)
        .WithReference(mongoReplicaSet)
        .WithReference(db)
        .WaitFor(rabbitMq)
        .WaitFor(mongoReplicaSet)
        .WaitFor(db);

     builder
        .AddProject<Projects.Trafera_Messaging_Aspire_MockConsumerThree>("MockConsumerThree")
        .WithEnvironment("MassTransit__EnableTransactionalMongoDbOutbox", "true")
        .WithReference(rabbitMq)
        .WithReference(mongoReplicaSet)
        .WithReference(db)
        .WaitFor(rabbitMq)
        .WaitFor(mongoReplicaSet)
        .WaitFor(db);

    builder
        .AddProject<Projects.Trafera_Messaging_Aspire_DbInitializer>("DbInitializer")
        .WithReference(mongoReplicaSet)
        .WithReference(db)
        .WaitFor(mongoReplicaSet)
        .WaitFor(db);
}

builder.Build().Run();
