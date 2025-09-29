namespace Demo.Linting
{
    public class CodingStandards
    {
        // Demonstrates style rules (string interpolation preferred, braces required)
        public void StringStandards(IEnumerable<int> customerIds)
        {
            foreach (var customerId in customerIds)
            {
                // Case allowed 1
                Logger.LogDebug($"This approach is desirable: {customerId}");

                // Case Not Allowed 1
                Logger.LogDebug("This should not be used: " + customerId);

                //Case Not Allowed 2
                Logger.LogDebug(string.Format("This is also frowned upon {0}", customerId));

                //Case Not Allowed 3
                var message2 = "This should not be used: " + customerId;

                //Case Not Allowed 4
                var message = string.Format("This is also frowned upon {0}", customerId);
            }
        }

        public void BracesStandards()
        {
            // Always use braces for if statements
            if (true)
                throw new ArgumentException("Customer ID cannot be negative.");
        }
    }
}
