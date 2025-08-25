namespace Demo.Linting;

public class CodingStandards
{
    // Demonstrates style rules (string interpolation preferred, braces required)
    public void StringStandards(IEnumerable<int> customerIds)
    {
        foreach (var customerId in customerIds)
        {
            // Case allowed 1
            Logger.LogDebug($"This approach is desirable: {customerId}");
        }
    }

    public void BracesStandards()
    {
        // Always use braces for if statements
        if (true)
        {
            throw new ArgumentException("Customer ID cannot be negative.");
        }
    }
}
