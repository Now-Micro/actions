using System.Collections.Generic;
using System.Threading.Tasks;

namespace Demo.Linting;

public class FixesNeeded
{
    private readonly List<int> _customerIds = new() { 1, 2, 3 };

    private async Task<string> GetCustomerAsync(int id)
    {
        await Task.Delay(10).ConfigureAwait(false); // Simulate I/O
        return id.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    // Intentional sequential awaits for analyzer testing
    public async Task SequentialExecutionAsync()
    {
        var results = new List<string>();
        foreach (var id in _customerIds)
        {
            var result = await GetCustomerAsync(id).ConfigureAwait(false); // Sequential await
            results.Add(result);
        }
    }
}
