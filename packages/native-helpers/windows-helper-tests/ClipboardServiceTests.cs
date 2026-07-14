using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Windows.Forms;
using NUnit.Framework;
using WindowsHelper.Services;
using ComDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;
using FormsDataObject = System.Windows.Forms.IDataObject;

namespace WindowsHelper.Tests;

[TestFixture]
[Apartment(ApartmentState.STA)]
public class ClipboardServiceTests
{
    private const int DvETymed = unchecked((int)0x80040069);
    private const string ExcludeFromMonitorProcessing = "ExcludeClipboardContentFromMonitorProcessing";
    private const string ClipboardViewerIgnore = "Clipboard Viewer Ignore";
    private const string CanIncludeInClipboardHistory = "CanIncludeInClipboardHistory";
    private const string CanUploadToCloudClipboard = "CanUploadToCloudClipboard";
    private const string PreferredDropEffect = "Preferred DropEffect";
    private const string UntrustedDragDrop = "UntrustedDragDrop";

    [Test]
    public void Capture_WhenWinFormsAdvertisesHGlobalAndIStream_UsesOnlyHGlobal()
    {
        const string expected = "ordinary clipboard text";
        var dataObject = new DataObject();
        dataObject.SetData(DataFormats.UnicodeText, autoConvert: false, expected);
        var oleDataObject = (ComDataObject)dataObject;

        var hGlobalQuery = CreateFormatEtc(DataFormats.UnicodeText, TYMED.TYMED_HGLOBAL);
        var streamQuery = CreateFormatEtc(DataFormats.UnicodeText, TYMED.TYMED_ISTREAM);
        Assert.That(oleDataObject.QueryGetData(ref hGlobalQuery), Is.Zero);
        Assert.That(oleDataObject.QueryGetData(ref streamQuery), Is.Zero);

        var recordingDataObject = new RecordingDataObject(oleDataObject);

        var captured = ClipboardService.TryCaptureSafeFormat(
            recordingDataObject,
            DataFormats.UnicodeText,
            out var bytes,
            out var dataType);

        Assert.That(captured, Is.True);
        Assert.That(dataType, Is.EqualTo(ClipboardService.StoredDataType.RawHGlobal));
        Assert.That(Encoding.Unicode.GetString(bytes).TrimEnd('\0'), Is.EqualTo(expected));
        Assert.That(recordingDataObject.QueriedMedia, Is.EqualTo(new[] { TYMED.TYMED_HGLOBAL }));
        Assert.That(recordingDataObject.RequestedMedia, Is.EqualTo(new[] { TYMED.TYMED_HGLOBAL }));
    }

    [Test]
    public void Capture_WhenBitmapIsAvailableAsGdi_DetachesItAsPng()
    {
        using var bitmap = new System.Drawing.Bitmap(1, 1);
        bitmap.SetPixel(0, 0, System.Drawing.Color.Red);
        var dataObject = new DataObject();
        dataObject.SetData(DataFormats.Bitmap, autoConvert: false, bitmap);
        var recordingDataObject = new RecordingDataObject((ComDataObject)dataObject);

        var captured = ClipboardService.TryCaptureSafeFormat(
            recordingDataObject,
            DataFormats.Bitmap,
            out var bytes,
            out var dataType);

        Assert.That(captured, Is.True);
        Assert.That(dataType, Is.EqualTo(ClipboardService.StoredDataType.Bitmap));
        Assert.That(bytes.AsSpan(0, 4).ToArray(), Is.EqualTo(new byte[] { 0x89, 0x50, 0x4E, 0x47 }));
        using var stream = new MemoryStream(bytes, writable: false);
        using var image = System.Drawing.Image.FromStream(stream);
        Assert.That(image.Size, Is.EqualTo(new System.Drawing.Size(1, 1)));
        Assert.That(recordingDataObject.QueriedMedia, Is.EqualTo(new[] { TYMED.TYMED_GDI }));
        Assert.That(recordingDataObject.RequestedMedia, Is.EqualTo(new[] { TYMED.TYMED_GDI }));
    }

    [Test]
    public void Capture_WhenOnlyIStreamExists_SkipsWithoutReading()
    {
        var dataObject = new StreamOnlyDataObject();

        var captured = ClipboardService.TryCaptureSafeFormat(
            dataObject,
            DataFormats.UnicodeText,
            out _,
            out _);

        Assert.That(captured, Is.False);
        Assert.That(dataObject.QueriedMedia, Is.EqualTo(new[] { TYMED.TYMED_HGLOBAL }));
        Assert.That(dataObject.GetDataCalled, Is.False);
    }

    [Test]
    public void Capture_WhenFormatIsEmbeddedObject_SkipsBeforeOleInspection()
    {
        var dataObject = new StreamOnlyDataObject();

        var captured = ClipboardService.TryCaptureSafeFormat(
            dataObject,
            "Embedded Object",
            out _,
            out _);

        Assert.That(captured, Is.False);
        Assert.That(dataObject.QueriedMedia, Is.Empty);
        Assert.That(dataObject.GetDataCalled, Is.False);
    }

    [Test]
    public void Capture_WhenExcludeMarkerIsAdvertised_DoesNotInvokeOleRenderer()
    {
        var dataObject = new StreamOnlyDataObject();

        var captured = ClipboardService.TryCaptureSafeFormat(
            dataObject,
            ExcludeFromMonitorProcessing,
            out var bytes,
            out var dataType);

        Assert.That(captured, Is.True);
        Assert.That(bytes, Is.EqualTo(new byte[] { 1 }));
        Assert.That(dataType, Is.EqualTo(ClipboardService.StoredDataType.RawHGlobal));
        Assert.That(dataObject.QueriedMedia, Is.Empty);
        Assert.That(dataObject.GetDataCalled, Is.False);
    }

    [Test]
    public void CaptureSnapshot_WithLegacyViewerIgnore_TranslatesToOfficialExclusion()
    {
        var dataObject = new DataObject();
        dataObject.SetData(DataFormats.UnicodeText, autoConvert: false, "ordinary clipboard text");
        dataObject.SetData(ClipboardViewerIgnore, autoConvert: false, new object());

        var content = ClipboardService.CaptureDataObject(dataObject);

        Assert.That(content.CaptureIncomplete, Is.True);
        Assert.That(content.Formats.ContainsKey(ClipboardViewerIgnore), Is.False);
        Assert.That(content.Formats[ExcludeFromMonitorProcessing].Data, Is.EqualTo(new byte[] { 1 }));
    }

    [TestCase(CanIncludeInClipboardHistory)]
    [TestCase(CanUploadToCloudClipboard)]
    [TestCase(PreferredDropEffect)]
    [TestCase(UntrustedDragDrop)]
    public void Capture_WhenDwordMetadataHasAllocationPadding_CopiesOnlyDword(string format)
    {
        var expected = new byte[] { 2, 0, 0, 0 };
        using var stream = new MemoryStream(new byte[] { 2, 0, 0, 0, 0xAA, 0xBB, 0xCC, 0xDD }, writable: false);
        var dataObject = new DataObject();
        dataObject.SetData(format, autoConvert: false, stream);
        var recordingDataObject = new RecordingDataObject((ComDataObject)dataObject);

        var captured = ClipboardService.TryCaptureSafeFormat(
            recordingDataObject,
            format,
            out var bytes,
            out var dataType);

        Assert.That(captured, Is.True);
        Assert.That(bytes, Is.EqualTo(expected));
        Assert.That(dataType, Is.EqualTo(ClipboardService.StoredDataType.RawHGlobal));
        Assert.That(recordingDataObject.QueriedMedia, Is.EqualTo(new[] { TYMED.TYMED_HGLOBAL }));
        Assert.That(recordingDataObject.RequestedMedia, Is.EqualTo(new[] { TYMED.TYMED_HGLOBAL }));
    }

    [Test]
    public void CaptureSnapshot_WithSafeMetadataAndFileDrop_PreservesAllFormats()
    {
        const string expectedRtf = @"{\rtf1 test}";
        using var historyStream = CreatePaddedDwordStream(0);
        using var cloudStream = CreatePaddedDwordStream(0);
        using var dropEffectStream = CreatePaddedDwordStream(2);
        using var untrustedStream = CreatePaddedDwordStream(1);
        using var rtfStream = new MemoryStream(Encoding.ASCII.GetBytes(expectedRtf), writable: false);
        var dataObject = new DataObject();
        dataObject.SetData(DataFormats.UnicodeText, autoConvert: false, "ordinary clipboard text");
        dataObject.SetData(DataFormats.Rtf, autoConvert: false, rtfStream);
        dataObject.SetData(DataFormats.FileDrop, autoConvert: false, new[] { @"C:\example.txt" });
        dataObject.SetData(ExcludeFromMonitorProcessing, autoConvert: false, new object());
        dataObject.SetData(CanIncludeInClipboardHistory, autoConvert: false, historyStream);
        dataObject.SetData(CanUploadToCloudClipboard, autoConvert: false, cloudStream);
        dataObject.SetData(PreferredDropEffect, autoConvert: false, dropEffectStream);
        dataObject.SetData(UntrustedDragDrop, autoConvert: false, untrustedStream);

        var content = ClipboardService.CaptureDataObject(dataObject);

        Assert.That(content.SaveFailed, Is.False);
        Assert.That(content.CaptureIncomplete, Is.False);
        Assert.That(content.OriginalWasEmpty, Is.False);
        Assert.That(content.Formats[ExcludeFromMonitorProcessing].Data, Is.EqualTo(new byte[] { 1 }));
        Assert.That(content.Formats[CanIncludeInClipboardHistory].Data, Is.EqualTo(new byte[] { 0, 0, 0, 0 }));
        Assert.That(content.Formats[CanUploadToCloudClipboard].Data, Is.EqualTo(new byte[] { 0, 0, 0, 0 }));
        Assert.That(content.Formats[PreferredDropEffect].Data, Is.EqualTo(new byte[] { 2, 0, 0, 0 }));
        Assert.That(content.Formats[UntrustedDragDrop].Data, Is.EqualTo(new byte[] { 1, 0, 0, 0 }));
        Assert.That(content.Formats.ContainsKey(DataFormats.UnicodeText), Is.True);
        Assert.That(Encoding.ASCII.GetString(content.Formats[DataFormats.Rtf].Data), Does.StartWith(expectedRtf));

        var fileDropBytes = content.Formats[DataFormats.FileDrop].Data;
        var fileListOffset = BitConverter.ToInt32(fileDropBytes, 0);
        Assert.That(fileListOffset, Is.GreaterThan(0).And.LessThan(fileDropBytes.Length));
        var fileListByteCount = fileDropBytes.Length - fileListOffset;
        fileListByteCount -= fileListByteCount % sizeof(char);
        Assert.That(
            Encoding.Unicode.GetString(fileDropBytes, fileListOffset, fileListByteCount),
            Does.StartWith("C:\\example.txt\0"));
    }

    [Test]
    public void CaptureSnapshot_WithSupportedAndUnknownFormats_IsMarkedIncomplete()
    {
        const string unknownFormat = "Amical.Tests.VendorPrivateFormat";
        using var unknownStream = new MemoryStream(new byte[] { 1, 2, 3, 4 }, writable: false);
        var dataObject = new DataObject();
        dataObject.SetData(DataFormats.UnicodeText, autoConvert: false, "ordinary clipboard text");
        dataObject.SetData(unknownFormat, autoConvert: false, unknownStream);

        var content = ClipboardService.CaptureDataObject(dataObject);

        Assert.That(content.SaveFailed, Is.False);
        Assert.That(content.CaptureIncomplete, Is.True);
        Assert.That(content.OriginalWasEmpty, Is.False);
        Assert.That(content.Formats.ContainsKey(DataFormats.UnicodeText), Is.True);
        Assert.That(content.Formats.ContainsKey(unknownFormat), Is.False);
    }

    [Test]
    public void CaptureSnapshot_WithOrphanedPreferredDropEffect_RemovesItAndMarksIncomplete()
    {
        using var dropEffectStream = CreatePaddedDwordStream(2);
        var dataObject = new DataObject();
        dataObject.SetData(DataFormats.UnicodeText, autoConvert: false, "ordinary clipboard text");
        dataObject.SetData(PreferredDropEffect, autoConvert: false, dropEffectStream);

        var content = ClipboardService.CaptureDataObject(dataObject);

        Assert.That(content.CaptureIncomplete, Is.True);
        Assert.That(content.Formats.ContainsKey(DataFormats.UnicodeText), Is.True);
        Assert.That(content.Formats.ContainsKey(PreferredDropEffect), Is.False);
    }

    [TestCase(CanIncludeInClipboardHistory, 0u)]
    [TestCase(CanUploadToCloudClipboard, 0u)]
    [TestCase(UntrustedDragDrop, 0x0000180Bu)]
    public void CaptureSnapshot_WhenSecurityDwordCannotRender_UsesRestrictiveFallback(string format, uint expected)
    {
        var dataObject = new StreamOnlyDataObject(format);

        var content = ClipboardService.CaptureDataObject(dataObject);

        Assert.That(content.CaptureIncomplete, Is.True);
        Assert.That(content.OriginalWasEmpty, Is.False);
        Assert.That(content.Formats[format].Data, Is.EqualTo(BitConverter.GetBytes(expected)));
        Assert.That(content.Formats[format].Type, Is.EqualTo(ClipboardService.StoredDataType.RawHGlobal));
        Assert.That(dataObject.QueriedMedia, Is.EqualTo(new[] { TYMED.TYMED_HGLOBAL }));
        Assert.That(dataObject.GetDataCalled, Is.False);
    }

    [TestCase("FileName")]
    [TestCase("FileNameW")]
    public void CaptureSnapshot_WithLegacyFilePayload_PreservesPreferredDropEffect(string fileFormat)
    {
        using var fileStream = new MemoryStream(new byte[] { 1, 2, 3, 4 }, writable: false);
        using var dropEffectStream = CreatePaddedDwordStream(2);
        var dataObject = new DataObject();
        dataObject.SetData(fileFormat, autoConvert: false, fileStream);
        dataObject.SetData(PreferredDropEffect, autoConvert: false, dropEffectStream);

        var content = ClipboardService.CaptureDataObject(dataObject);

        Assert.That(content.CaptureIncomplete, Is.False);
        Assert.That(content.Formats.ContainsKey(fileFormat), Is.True);
        Assert.That(content.Formats[PreferredDropEffect].Data, Is.EqualTo(new byte[] { 2, 0, 0, 0 }));
    }

    [Test]
    public void Capture_WhenFormatIsUnknown_SkipsBeforeOleInspection()
    {
        var dataObject = new StreamOnlyDataObject();

        var captured = ClipboardService.TryCaptureSafeFormat(
            dataObject,
            "Amical.Tests.UnknownFormat",
            out _,
            out _);

        Assert.That(captured, Is.False);
        Assert.That(dataObject.QueriedMedia, Is.Empty);
        Assert.That(dataObject.GetDataCalled, Is.False);
    }

    private static MemoryStream CreatePaddedDwordStream(uint value)
    {
        var bytes = new byte[8];
        BitConverter.GetBytes(value).CopyTo(bytes, 0);
        bytes[4] = 0xAA;
        bytes[5] = 0xBB;
        bytes[6] = 0xCC;
        bytes[7] = 0xDD;
        return new MemoryStream(bytes, writable: false);
    }

    private static FORMATETC CreateFormatEtc(string format, TYMED medium) => new()
    {
        cfFormat = unchecked((short)DataFormats.GetFormat(format).Id),
        dwAspect = DVASPECT.DVASPECT_CONTENT,
        lindex = -1,
        ptd = IntPtr.Zero,
        tymed = medium
    };

    private sealed class RecordingDataObject(ComDataObject inner) : ComDataObject
    {
        internal List<TYMED> QueriedMedia { get; } = new();
        internal List<TYMED> RequestedMedia { get; } = new();

        public int QueryGetData(ref FORMATETC formatetc)
        {
            QueriedMedia.Add(formatetc.tymed);
            return inner.QueryGetData(ref formatetc);
        }

        public void GetData(ref FORMATETC formatetc, out STGMEDIUM medium)
        {
            RequestedMedia.Add(formatetc.tymed);
            inner.GetData(ref formatetc, out medium);
        }

        public void GetDataHere(ref FORMATETC formatetc, ref STGMEDIUM medium) =>
            inner.GetDataHere(ref formatetc, ref medium);

        public int GetCanonicalFormatEtc(ref FORMATETC formatetcIn, out FORMATETC formatetcOut) =>
            inner.GetCanonicalFormatEtc(ref formatetcIn, out formatetcOut);

        public void SetData(ref FORMATETC formatetc, ref STGMEDIUM medium, bool release) =>
            inner.SetData(ref formatetc, ref medium, release);

        public IEnumFORMATETC EnumFormatEtc(DATADIR direction) => inner.EnumFormatEtc(direction);

        public int DAdvise(ref FORMATETC formatetc, ADVF advf, IAdviseSink adviseSink, out int connection) =>
            inner.DAdvise(ref formatetc, advf, adviseSink, out connection);

        public void DUnadvise(int connection) => inner.DUnadvise(connection);

        public int EnumDAdvise(out IEnumSTATDATA? enumAdvise) => inner.EnumDAdvise(out enumAdvise);
    }

    private sealed class StreamOnlyDataObject(string? advertisedFormat = null) : ComDataObject, FormsDataObject
    {
        internal List<TYMED> QueriedMedia { get; } = new();
        internal bool GetDataCalled { get; private set; }

        public int QueryGetData(ref FORMATETC formatetc)
        {
            QueriedMedia.Add(formatetc.tymed);
            return formatetc.tymed == TYMED.TYMED_ISTREAM ? 0 : DvETymed;
        }

        public void GetData(ref FORMATETC formatetc, out STGMEDIUM medium)
        {
            GetDataCalled = true;
            medium = default;
            throw new NotSupportedException();
        }

        public void GetDataHere(ref FORMATETC formatetc, ref STGMEDIUM medium) =>
            throw new NotSupportedException();

        public int GetCanonicalFormatEtc(ref FORMATETC formatetcIn, out FORMATETC formatetcOut)
        {
            formatetcOut = default;
            return 0;
        }

        public void SetData(ref FORMATETC formatetc, ref STGMEDIUM medium, bool release) =>
            throw new NotSupportedException();

        public IEnumFORMATETC EnumFormatEtc(DATADIR direction) => throw new NotSupportedException();

        public int DAdvise(ref FORMATETC formatetc, ADVF advf, IAdviseSink adviseSink, out int connection)
        {
            connection = 0;
            return 0;
        }

        public void DUnadvise(int connection) => throw new NotSupportedException();

        public int EnumDAdvise(out IEnumSTATDATA? enumAdvise)
        {
            enumAdvise = null;
            return 0;
        }

        object? FormsDataObject.GetData(string format, bool autoConvert) => throw new NotSupportedException();

        object? FormsDataObject.GetData(string format) => throw new NotSupportedException();

        object? FormsDataObject.GetData(Type format) => throw new NotSupportedException();

        bool FormsDataObject.GetDataPresent(string format, bool autoConvert) => format == advertisedFormat;

        bool FormsDataObject.GetDataPresent(string format) => format == advertisedFormat;

        bool FormsDataObject.GetDataPresent(Type format) => false;

        string[] FormsDataObject.GetFormats(bool autoConvert) =>
            advertisedFormat == null ? Array.Empty<string>() : new[] { advertisedFormat };

        string[] FormsDataObject.GetFormats() =>
            advertisedFormat == null ? Array.Empty<string>() : new[] { advertisedFormat };

        void FormsDataObject.SetData(string format, bool autoConvert, object? data) => throw new NotSupportedException();

        void FormsDataObject.SetData(string format, object? data) => throw new NotSupportedException();

        void FormsDataObject.SetData(Type format, object? data) => throw new NotSupportedException();

        void FormsDataObject.SetData(object? data) => throw new NotSupportedException();
    }
}
