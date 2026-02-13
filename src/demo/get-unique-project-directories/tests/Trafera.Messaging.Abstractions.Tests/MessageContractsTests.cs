using FluentAssertions;
using Trafera.Messaging.Abstractions;
using Xunit;

namespace Trafera.Messaging.Abstractions.Tests;

/// <summary>
/// Tests for messaging contract marker interfaces.
/// </summary>
public sealed class MessageContractsTests
{
    /// <summary>
    /// Verifies that a command type implements <see cref="IInternalCommand"/>.
    /// </summary>
    [Fact]
    public void InternalCommand_MarkerIsAssignable()
    {
        var instance = new TestInternalCommand();

        instance.Should().BeAssignableTo<IInternalCommand>();
    }

    /// <summary>
    /// Verifies that a domain event type implements <see cref="IDomainEvent"/>.
    /// </summary>
    [Fact]
    public void DomainEvent_MarkerIsAssignable()
    {
        var instance = new TestDomainEvent();

        instance.Should().BeAssignableTo<IDomainEvent>();
    }

    /// <summary>
    /// Verifies that a command contract type implements <see cref="IExternalCommand"/>.
    /// </summary>
    [Fact]
    public void ExternalCommand_MarkerIsAssignable()
    {
        var instance = new TestExternalCommand();

        instance.Should().BeAssignableTo<IExternalCommand>();
    }

    /// <summary>
    /// Verifies that an integration event type implements <see cref="IIntegrationEvent"/>.
    /// </summary>
    [Fact]
    public void IntegrationEvent_MarkerIsAssignable()
    {
        var instance = new TestIntegrationEvent();

        instance.Should().BeAssignableTo<IIntegrationEvent>();
    }

    private sealed class TestInternalCommand : IInternalCommand { }

    private sealed class TestDomainEvent : IDomainEvent { }

    private sealed class TestExternalCommand : IExternalCommand { }

    private sealed class TestIntegrationEvent : IIntegrationEvent { }
}
