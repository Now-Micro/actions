using FluentValidation;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Trafera.Messaging.Abstractions;
using Trafera.Messaging.MediatR;

namespace Trafera.Messaging.MediatR.SampleApp;

public static class Program
{
    /// <summary>
    /// Demonstrates registering Trafera.Messaging.MediatR.
    /// </summary>
    /// <param name="args">Command-line arguments.</param>
    public static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        builder.Services.AddMessagingMediatR(assemblies: typeof(Program).Assembly);

        using var host = builder.Build();

        var mediator = host.Services.GetRequiredService<IMediator>();
        var response = await mediator
            .Send(new PingInternal("Hello"), CancellationToken.None)
            .ConfigureAwait(false);

        Console.WriteLine(response);
    }
}

/// <summary>
/// Represents a sample internal command.
/// </summary>
public sealed record PingInternal(string Message) : IInternalCommand, IRequest<string>;

/// <summary>
/// Handles the <see cref="PingInternal"/> command.
/// </summary>
public sealed class PingInternalHandler : IRequestHandler<PingInternal, string>
{
    /// <summary>
    /// Handles the request and returns a response message.
    /// </summary>
    /// <param name="request">The request instance.</param>
    /// <param name="cancellationToken">The cancellation token.</param>
    /// <returns>The response message.</returns>
    public Task<string> Handle(PingInternal request, CancellationToken cancellationToken)
    {
        return Task.FromResult($"Pong: {request.Message}");
    }
}

/// <summary>
/// Validates the <see cref="PingInternal"/> command.
/// </summary>
public sealed class PingInternalValidator : AbstractValidator<PingInternal>
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PingInternalValidator"/> class.
    /// </summary>
    public PingInternalValidator()
    {
        RuleFor(command => command.Message).NotEmpty();
    }
}
