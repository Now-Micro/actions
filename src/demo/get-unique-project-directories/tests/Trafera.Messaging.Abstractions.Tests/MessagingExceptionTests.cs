using FluentAssertions;
using Trafera.Messaging.Abstractions.Exceptions;
using Xunit;

namespace Trafera.Messaging.Abstractions.Tests;

/// <summary>
/// Tests for <see cref="MessagingException"/>.
/// </summary>
public sealed class MessagingExceptionTests
{
    /// <summary>
    /// Verifies that the message is stored when constructed with only a message.
    /// </summary>
    [Fact]
    public void Ctor_WithMessage_AssignsMessage()
    {
        var exception = new TestMessagingException("failure");

        exception.Message.Should().Be("failure");
        exception.InnerException.Should().BeNull();
    }

    /// <summary>
    /// Verifies that the message and inner exception are stored.
    /// </summary>
    [Fact]
    public void Ctor_WithMessageAndInner_AssignsInnerException()
    {
        var innerException = new InvalidOperationException("inner");

        var exception = new TestMessagingException("failure", innerException);

        exception.Message.Should().Be("failure");
        exception.InnerException.Should().Be(innerException);
    }

    private sealed class TestMessagingException : MessagingException
    {
        public TestMessagingException(string message)
            : base(message) { }

        public TestMessagingException(string message, Exception innerException)
            : base(message, innerException) { }
    }
}
