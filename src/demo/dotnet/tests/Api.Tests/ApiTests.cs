using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Demo.Api.Tests
{
    public class ApiTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public ApiTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory.WithWebHostBuilder(_ => { });
        }

        [Fact]
        public async Task Root_Returns_Hello()
        {
            var client = _factory.CreateClient();
            var response = await client.GetAsync("/");
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains("Hello", body);
        }

        [Theory]
        [InlineData(1, 2, 3)]
        [InlineData(10, 5, 15)]
        public async Task Add_Returns_Sum(int a, int b, int expected)
        {
            var client = _factory.CreateClient();
            var response = await client.GetAsync($"/add/{a}/{b}");
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains($"{expected}", body);
        }
    }
}
