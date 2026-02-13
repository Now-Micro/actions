namespace Trafera.Messaging.Abstractions;

/// <summary>
/// Marks a command that is handled within a single service boundary.
/// </summary>
public interface IInternalCommand
{
}

/// <summary>
/// Marks a domain event that is raised within a single service boundary.
/// </summary>
public interface IDomainEvent
{
}

/// <summary>
/// Marks a command that is sent across service boundaries.
/// </summary>
public interface IExternalCommand
{
}

/// <summary>
/// Marks an event that is published across service boundaries.
/// </summary>
public interface IIntegrationEvent
{
}
