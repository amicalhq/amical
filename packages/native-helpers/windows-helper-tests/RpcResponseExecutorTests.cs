using NUnit.Framework;
using System.Text.Json;
using WindowsHelper.Models;

namespace WindowsHelper.Tests;

[TestFixture]
public class RpcResponseExecutorTests
{
    private sealed class CyclicResult
    {
        public CyclicResult? Self { get; set; }
    }

    private static async Task<RpcResponse> ExecuteAsync(
        string id,
        Func<Task<object?>> operation)
    {
        var json = await RpcResponseExecutor.ExecuteAsync(
            id,
            operation,
            Converter.Settings
        );
        return JsonSerializer.Deserialize<RpcResponse>(json, Converter.Settings)!;
    }

    [Test]
    public async Task ExecuteAsync_OnSuccess_PreservesRequestIdAndResult()
    {
        var response = await ExecuteAsync(
            "request-1",
            () => Task.FromResult<object?>(
                new StartRecordingResult { Success = true, Message = "Recording started" }
            )
        );
        var result = (JsonElement)response.Result;

        Assert.Multiple(() =>
        {
            Assert.That(response.Id, Is.EqualTo("request-1"));
            Assert.That(response.Error, Is.Null);
            Assert.That(result.GetProperty("success").GetBoolean(), Is.True);
            Assert.That(result.GetProperty("message").GetString(), Is.EqualTo("Recording started"));
        });
    }

    [Test]
    public async Task ExecuteAsync_OnInvalidParams_ReturnsInvalidParamsError()
    {
        var response = await ExecuteAsync(
            "request-2",
            () => throw new RpcDispatchException(
                -32602,
                "Missing params for startRecording"
            )
        );

        Assert.Multiple(() =>
        {
            Assert.That(response.Id, Is.EqualTo("request-2"));
            Assert.That(response.Result, Is.Null);
            Assert.That(response.Error?.Code, Is.EqualTo(-32602));
            Assert.That(
                response.Error?.Message,
                Is.EqualTo("Missing params for startRecording")
            );
        });
    }

    [Test]
    public async Task ExecuteAsync_OnUnexpectedFailure_ReturnsInternalError()
    {
        var response = await ExecuteAsync(
            "request-3",
            () => throw new InvalidOperationException("test failure")
        );

        Assert.Multiple(() =>
        {
            Assert.That(response.Id, Is.EqualTo("request-3"));
            Assert.That(response.Result, Is.Null);
            Assert.That(response.Error?.Code, Is.EqualTo(-32603));
        });
    }

    [Test]
    public async Task ExecuteAsync_OnResultEncodingFailure_ReturnsInternalErrorJson()
    {
        var cyclicResult = new CyclicResult();
        cyclicResult.Self = cyclicResult;

        var response = await ExecuteAsync(
            "request-4",
            () => Task.FromResult<object?>(cyclicResult)
        );

        Assert.Multiple(() =>
        {
            Assert.That(response.Id, Is.EqualTo("request-4"));
            Assert.That(response.Result, Is.Null);
            Assert.That(response.Error?.Code, Is.EqualTo(-32603));
            Assert.That(response.Error?.Message, Does.StartWith("Internal error:"));
        });
    }

    [Test]
    public async Task ExecuteAsync_WithConcurrentOperations_KeepsRequestIdsIndependent()
    {
        var releaseFirst = new TaskCompletionSource<object?>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        var first = ExecuteAsync("slow", () => releaseFirst.Task);
        var second = ExecuteAsync(
            "fast",
            () => Task.FromResult<object?>(null)
        );

        releaseFirst.SetResult(null);
        var responses = await Task.WhenAll(first, second);

        Assert.That(responses.Select(response => response.Id), Is.EqualTo(new[] { "slow", "fast" }));
        Assert.That(responses.All(response => response.Error == null), Is.True);
    }
}
