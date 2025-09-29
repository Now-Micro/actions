using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => Results.Json(new { message = "Hello from Demo API" }));
app.MapGet("/health", () => Results.Ok("OK"));
app.MapGet("/add/{a:int}/{b:int}", (int a, int b) => Results.Json(new { sum = a + b }));

app.Run();

public partial class Program { }
