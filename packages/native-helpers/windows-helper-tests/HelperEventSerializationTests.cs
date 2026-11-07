using System.Globalization;
using System.Text.Json;
using NUnit.Framework;
using WindowsHelper.Models;

namespace WindowsHelper.Tests;

[TestFixture]
[NonParallelizable]
public class HelperEventSerializationTests
{
    [Test]
    public void ToJson_WithJapaneseCalendar_UsesGregorianIsoTimestamp()
    {
        var originalCulture = CultureInfo.CurrentCulture;
        var japaneseCulture = new CultureInfo("ja-JP");
        japaneseCulture.DateTimeFormat.Calendar = new JapaneseCalendar();

        try
        {
            CultureInfo.CurrentCulture = japaneseCulture;
            var helperEvent = new HelperEvent
            {
                Type = HelperEventType.KeyDown,
                Timestamp = new DateTimeOffset(2026, 8, 19, 13, 6, 59, TimeSpan.Zero)
                    .AddTicks(1234567),
                Payload = new HelperEventPayload
                {
                    KeyCode = 65,
                    AltKey = false,
                    CtrlKey = true,
                    ShiftKey = true,
                    MetaKey = false,
                    FnKeyPressed = false
                }
            };

            using var document = JsonDocument.Parse(helperEvent.ToJson());

            Assert.That(
                document.RootElement.GetProperty("timestamp").GetString(),
                Is.EqualTo("2026-08-19T13:06:59.1234567+00:00"));
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }
}
