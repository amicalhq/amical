using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using ComTypes = System.Runtime.InteropServices.ComTypes;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Handles clipboard operations on the main STA thread via Form.Invoke.
    /// Provides save/set/restore functionality for clipboard content.
    /// </summary>
    public class ClipboardService
    {
        private const string ExcludeFromMonitorProcessingFormat = "ExcludeClipboardContentFromMonitorProcessing";
        private const string ClipboardViewerIgnoreFormat = "Clipboard Viewer Ignore";
        private const string CanIncludeInClipboardHistoryFormat = "CanIncludeInClipboardHistory";
        private const string CanUploadToCloudClipboardFormat = "CanUploadToCloudClipboard";
        private const string PreferredDropEffectFormat = "Preferred DropEffect";
        private const string UntrustedDragDropFormat = "UntrustedDragDrop";

        [DllImport("user32.dll")]
        private static extern int GetClipboardSequenceNumber();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern UIntPtr GlobalSize(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalLock(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalUnlock(IntPtr hMem);

        [DllImport("ole32.dll")]
        private static extern void ReleaseStgMedium(ref ComTypes.STGMEDIUM medium);

        private static readonly HashSet<string> NonDetachableClipboardFormats = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Embed Source",
            "Embedded Object",
            "Link Source",
            "Custom Link Source",
            "Object Descriptor",
            "Link Source Descriptor",
            "Ole Private Data",
            "FileContents",
            "FileGroupDescriptor",
            "FileGroupDescriptorW",
            "Native",
            "ObjectLink",
            "OwnerLink",
            "DataObject"
        };

        private static readonly HashSet<string> DetachableRegisteredClipboardFormats = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            DataFormats.Rtf,
            DataFormats.Html,
            DataFormats.CommaSeparatedValue,
            "FileName",
            "FileNameW",
            "PNG",
            "JFIF",
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/bmp",
            "image/tiff"
        };

        private static readonly HashSet<string> PresenceOnlyClipboardFormats = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ExcludeFromMonitorProcessingFormat
        };

        private static readonly HashSet<string> DwordClipboardFormats = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            CanIncludeInClipboardHistoryFormat,
            CanUploadToCloudClipboardFormat,
            PreferredDropEffectFormat,
            UntrustedDragDropFormat
        };

        private readonly Form mainForm;

        internal enum StoredDataType { RawHGlobal, Bitmap }

        /// <summary>
        /// Holds detached clipboard data so no source COM object reaches restoration.
        /// HGLOBAL payloads are copied as raw bytes, with bounded semantic metadata
        /// canonicalized as needed; Bitmap is stored as detached PNG bytes.
        /// </summary>
        internal class ClipboardContent
        {
            public Dictionary<string, (byte[] Data, StoredDataType Type)> Formats { get; } = new Dictionary<string, (byte[], StoredDataType)>();
            public bool OriginalWasEmpty { get; set; }
            public bool SaveFailed { get; set; }  // Track save failure separately - don't clear clipboard on restore
            public bool CaptureIncomplete { get; set; }
        }

        public ClipboardService(Form mainForm)
        {
            this.mainForm = mainForm ?? throw new ArgumentNullException(nameof(mainForm));
        }
        
        private T InvokeOnMainThread<T>(Func<T> action)
        {
            if (mainForm.InvokeRequired)
            {
                return (T)mainForm.Invoke(action);
            }
            return action();
        }
        
        private void InvokeOnMainThread(Action action)
        {
            if (mainForm.InvokeRequired)
            {
                mainForm.Invoke(action);
            }
            else
            {
                action();
            }
        }

        /// <summary>
        /// Gets the current clipboard sequence number.
        /// </summary>
        public int GetSequenceNumber()
        {
            return GetClipboardSequenceNumber();
        }

        /// <summary>
        /// Saves detachable clipboard formats to memory for a temporary clipboard transaction.
        /// </summary>
        internal ClipboardContent SaveForClipboardTransaction()
        {
            return InvokeOnMainThread(DoSave);
        }

        /// <summary>
        /// Sets the clipboard to the specified text.
        /// </summary>
        public void SetText(string text)
        {
            InvokeOnMainThread(() => Clipboard.SetText(text));
        }

        /// <summary>
        /// Reads clipboard text, or null when the clipboard holds no text format.
        /// </summary>
        public string? GetTextOrNull()
        {
            return InvokeOnMainThread(() => Clipboard.ContainsText() ? Clipboard.GetText() : (string?)null);
        }

        /// <summary>
        /// Restores previously saved clipboard content synchronously.
        /// Returns a warning/error message when preservation was incomplete, null on full success.
        /// </summary>
        internal string? RestoreSync(ClipboardContent content, int expectedSeq)
        {
            return InvokeOnMainThread(() => DoRestore(content, expectedSeq));
        }

        private ClipboardContent DoSave()
        {
            var content = new ClipboardContent();

            try
            {
                var dataObject = Clipboard.GetDataObject();

                if (dataObject == null)
                {
                    // Can't read clipboard - might be busy/locked, NOT necessarily empty
                    // Mark as failed so we don't wipe it on restore
                    LogToStderr("Clipboard.GetDataObject() returned null - clipboard may be busy");
                    content.SaveFailed = true;
                    return content;
                }

                return CaptureDataObject(dataObject);
            }
            catch (Exception ex)
            {
                LogToStderr($"Error saving clipboard: {ex.Message}");
                content.SaveFailed = true;  // Don't set OriginalWasEmpty - that would clear clipboard on restore
            }

            return content;
        }

        internal static ClipboardContent CaptureDataObject(IDataObject dataObject)
        {
            var content = new ClipboardContent();
            var formats = dataObject.GetFormats(autoConvert: false);
            content.OriginalWasEmpty = formats.Length == 0;

            if (dataObject is not ComTypes.IDataObject oleDataObject)
            {
                if (!content.OriginalWasEmpty)
                {
                    content.CaptureIncomplete = true;
                }
                LogToStderr("Clipboard data object does not expose OLE format metadata; skipping format preservation.");
                return content;
            }

            string? preferredDropEffectFormat = null;
            var capturedFilePayload = false;

            foreach (var format in formats)
            {
                try
                {
                    if (format.Equals(ClipboardViewerIgnoreFormat, StringComparison.OrdinalIgnoreCase))
                    {
                        content.Formats[ExcludeFromMonitorProcessingFormat] = (new byte[] { 1 }, StoredDataType.RawHGlobal);
                        content.CaptureIncomplete = true;
                        LogToStderr("Translated legacy 'Clipboard Viewer Ignore' to the official clipboard-monitor exclusion format.");
                        continue;
                    }

                    if (TryCaptureSafeFormat(oleDataObject, format, out var data, out var dataType))
                    {
                        content.Formats[format] = (data, dataType);
                        capturedFilePayload |= IsFilePayloadFormat(format);
                        if (format.Equals(PreferredDropEffectFormat, StringComparison.OrdinalIgnoreCase))
                        {
                            preferredDropEffectFormat = format;
                        }
                    }
                    else
                    {
                        content.CaptureIncomplete = true;
                        if (TryAddRestrictiveSecurityFallback(content, format))
                        {
                            LogToStderr($"Could not capture security clipboard format '{format}'; using a restrictive fallback.");
                        }
                        else
                        {
                            LogToStderr($"Skipping unsupported or non-detachable clipboard format: '{format}'");
                        }
                    }
                }
                catch (Exception ex)
                {
                    content.CaptureIncomplete = true;
                    if (TryAddRestrictiveSecurityFallback(content, format))
                    {
                        LogToStderr($"Could not save security clipboard format '{format}'; using a restrictive fallback: {ex.Message}");
                    }
                    else
                    {
                        LogToStderr($"Could not save clipboard format '{format}': {ex.Message}");
                    }
                }
            }

            if (preferredDropEffectFormat != null && !capturedFilePayload)
            {
                content.Formats.Remove(preferredDropEffectFormat);
                content.CaptureIncomplete = true;
                LogToStderr("Skipping 'Preferred DropEffect' because no file payload was captured.");
            }

            return content;
        }

        internal static bool TryCaptureSafeFormat(
            ComTypes.IDataObject dataObject,
            string format,
            out byte[] data,
            out StoredDataType dataType)
        {
            data = Array.Empty<byte>();
            dataType = default;

            // This format's payload has no semantics; its presence protects the
            // whole clipboard item. Avoid invoking a renderer and store a bounded,
            // non-empty replacement so WinForms can publish it as HGLOBAL.
            if (PresenceOnlyClipboardFormats.Contains(format))
            {
                data = new byte[] { 1 };
                dataType = StoredDataType.RawHGlobal;
                return true;
            }

            if (!TryGetSafeMedium(format, out var requestedMedium))
            {
                return false;
            }

            var formatEtc = new ComTypes.FORMATETC
            {
                cfFormat = unchecked((short)DataFormats.GetFormat(format).Id),
                dwAspect = ComTypes.DVASPECT.DVASPECT_CONTENT,
                lindex = -1,
                ptd = IntPtr.Zero,
                tymed = requestedMedium
            };

            // A positive exact-medium query avoids asking a storage- or stream-only
            // source to render. GetData below repeats the same single-medium request.
            if (dataObject.QueryGetData(ref formatEtc) != 0)
            {
                return false;
            }

            var medium = default(ComTypes.STGMEDIUM);
            try
            {
                dataObject.GetData(ref formatEtc, out medium);

                if (medium.tymed != requestedMedium || medium.unionmember == IntPtr.Zero)
                {
                    return false;
                }

                if (requestedMedium == ComTypes.TYMED.TYMED_GDI)
                {
                    using (var sourceImage = System.Drawing.Image.FromHbitmap(medium.unionmember))
                    using (var bitmap = new System.Drawing.Bitmap(sourceImage))
                    using (var stream = new MemoryStream())
                    {
                        bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
                        data = stream.ToArray();
                    }
                    dataType = StoredDataType.Bitmap;
                    return true;
                }

                var size = GlobalSize(medium.unionmember).ToUInt64();
                var bytesToCopy = 0;
                if (DwordClipboardFormats.Contains(format))
                {
                    if (size < sizeof(uint))
                    {
                        return false;
                    }
                    bytesToCopy = sizeof(uint);
                }
                else
                {
                    if (size == 0 || size > int.MaxValue)
                    {
                        return false;
                    }
                    bytesToCopy = (int)size;
                }

                var pointer = GlobalLock(medium.unionmember);
                if (pointer == IntPtr.Zero)
                {
                    return false;
                }

                try
                {
                    data = new byte[bytesToCopy];
                    Marshal.Copy(pointer, data, 0, data.Length);
                }
                finally
                {
                    GlobalUnlock(medium.unionmember);
                }

                dataType = StoredDataType.RawHGlobal;
                return true;
            }
            finally
            {
                if (medium.tymed != ComTypes.TYMED.TYMED_NULL)
                {
                    ReleaseStgMedium(ref medium);
                }
            }
        }

        private static bool TryGetSafeMedium(string format, out ComTypes.TYMED medium)
        {
            medium = ComTypes.TYMED.TYMED_NULL;

            if (NonDetachableClipboardFormats.Contains(format))
            {
                return false;
            }

            var formatId = DataFormats.GetFormat(format).Id & 0xFFFF;
            switch (formatId)
            {
                // Self-contained standard HGLOBAL formats: text, TIFF, DIB,
                // file drop, locale, and DIBV5 (which WinForms names Format17).
                case 1:  // CF_TEXT
                case 6:  // CF_TIFF
                case 7:  // CF_OEMTEXT
                case 8:  // CF_DIB
                case 13: // CF_UNICODETEXT
                case 15: // CF_HDROP
                case 16: // CF_LOCALE
                case 17: // CF_DIBV5
                    medium = ComTypes.TYMED.TYMED_HGLOBAL;
                    return true;

                case 2: // CF_BITMAP
                    medium = ComTypes.TYMED.TYMED_GDI;
                    return true;
            }

            if (DetachableRegisteredClipboardFormats.Contains(format))
            {
                medium = ComTypes.TYMED.TYMED_HGLOBAL;
                return true;
            }

            if (PresenceOnlyClipboardFormats.Contains(format) || DwordClipboardFormats.Contains(format))
            {
                medium = ComTypes.TYMED.TYMED_HGLOBAL;
                return true;
            }

            return false;
        }

        private static bool IsFilePayloadFormat(string format)
        {
            return (DataFormats.GetFormat(format).Id & 0xFFFF) == 15 ||
                format.Equals("FileName", StringComparison.OrdinalIgnoreCase) ||
                format.Equals("FileNameW", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsMetadataFormat(string format)
        {
            return PresenceOnlyClipboardFormats.Contains(format) || DwordClipboardFormats.Contains(format);
        }

        private static bool IsSecurityPolicyFormat(string format)
        {
            return PresenceOnlyClipboardFormats.Contains(format) ||
                format.Equals(CanIncludeInClipboardHistoryFormat, StringComparison.OrdinalIgnoreCase) ||
                format.Equals(CanUploadToCloudClipboardFormat, StringComparison.OrdinalIgnoreCase) ||
                format.Equals(UntrustedDragDropFormat, StringComparison.OrdinalIgnoreCase);
        }

        private static bool TryAddRestrictiveSecurityFallback(ClipboardContent content, string format)
        {
            byte[]? data = null;
            if (format.Equals(CanIncludeInClipboardHistoryFormat, StringComparison.OrdinalIgnoreCase) ||
                format.Equals(CanUploadToCloudClipboardFormat, StringComparison.OrdinalIgnoreCase))
            {
                data = new byte[sizeof(uint)];
            }
            else if (format.Equals(UntrustedDragDropFormat, StringComparison.OrdinalIgnoreCase))
            {
                // URLACTION_SHELL_ENHANCED_DRAGDROP_SECURITY (0x0000180B).
                data = new byte[] { 0x0B, 0x18, 0, 0 };
            }

            if (data == null)
            {
                return false;
            }

            content.Formats[format] = (data, StoredDataType.RawHGlobal);
            return true;
        }

        private static bool HasSubstantiveFormat(ClipboardContent content)
        {
            foreach (var format in content.Formats.Keys)
            {
                if (!IsMetadataFormat(format))
                {
                    return true;
                }
            }

            return false;
        }

        private static void AddRestoredFormat(
            DataObject dataObject,
            string format,
            byte[] data,
            StoredDataType dataType,
            List<IDisposable> restoreResources)
        {
            if (dataType == StoredDataType.Bitmap)
            {
                using (var stream = new MemoryStream(data, writable: false))
                using (var image = System.Drawing.Image.FromStream(stream))
                {
                    var bitmap = new System.Drawing.Bitmap(image);
                    restoreResources.Add(bitmap);
                    dataObject.SetData(format, autoConvert: false, bitmap);
                }
            }
            else
            {
                // WinForms writes Stream contents verbatim to HGLOBAL. Keeping
                // auto-conversion off offers only the captured exact format.
                var stream = new MemoryStream(data, writable: false);
                restoreResources.Add(stream);
                dataObject.SetData(format, autoConvert: false, stream);
            }
        }

        /// <summary>
        /// Returns a warning/error message when preservation was incomplete, null on full success.
        /// </summary>
        private string? DoRestore(ClipboardContent content, int expectedSeq)
        {
            var restoreResources = new List<IDisposable>();
            var clipboardMayOwnRestoreResources = false;
            try
            {
                // If save failed, don't touch the clipboard - we don't know what was there
                if (content.SaveFailed)
                {
                    var msg = "Save failed earlier; skipping restore to avoid data loss.";
                    LogToStderr(msg);
                    return msg;
                }

                int currentSeq = GetClipboardSequenceNumber();

                // Only restore if our temporary content is still on the clipboard
                if (currentSeq != expectedSeq)
                {
                    // Not an error - clipboard was changed by user/another app
                    LogToStderr($"Clipboard changed by another process (expected: {expectedSeq}, current: {currentSeq}); not restoring.");
                    return null;
                }

                if (content.OriginalWasEmpty)
                {
                    Clipboard.Clear();
                    LogToStderr("Clipboard cleared (original was empty).");
                    return null;
                }

                if (!HasSubstantiveFormat(content))
                {
                    var msg = "No substantive clipboard formats could be captured; cannot restore original content.";
                    LogToStderr(msg);
                    return msg;
                }

                var dataObject = new DataObject();
                var restoredFormatCount = 0;
                var restoredSubstantiveFormatCount = 0;
                var restoredFilePayload = false;
                var restoredPartially = content.CaptureIncomplete;

                foreach (var kvp in content.Formats)
                {
                    if (IsMetadataFormat(kvp.Key))
                    {
                        continue;
                    }

                    try
                    {
                        var (data, dataType) = kvp.Value;
                        AddRestoredFormat(dataObject, kvp.Key, data, dataType, restoreResources);
                        restoredFormatCount++;
                        restoredSubstantiveFormatCount++;
                        restoredFilePayload |= IsFilePayloadFormat(kvp.Key);
                    }
                    catch (Exception ex)
                    {
                        restoredPartially = true;
                        LogToStderr($"Could not restore clipboard format '{kvp.Key}': {ex.Message}");
                        // Continue trying other formats
                    }
                }

                if (restoredSubstantiveFormatCount == 0)
                {
                    var msg = "No substantive clipboard formats could be reconstructed; cannot restore original content.";
                    LogToStderr(msg);
                    return msg;
                }

                foreach (var kvp in content.Formats)
                {
                    if (!IsMetadataFormat(kvp.Key))
                    {
                        continue;
                    }

                    if (kvp.Key.Equals(PreferredDropEffectFormat, StringComparison.OrdinalIgnoreCase) && !restoredFilePayload)
                    {
                        restoredPartially = true;
                        LogToStderr("Could not restore 'Preferred DropEffect' because no file payload was reconstructed.");
                        continue;
                    }

                    try
                    {
                        var (data, dataType) = kvp.Value;
                        AddRestoredFormat(dataObject, kvp.Key, data, dataType, restoreResources);
                        restoredFormatCount++;
                    }
                    catch (Exception ex)
                    {
                        if (IsSecurityPolicyFormat(kvp.Key))
                        {
                            var msg = $"Could not reconstruct security clipboard format '{kvp.Key}'; refusing to restore content without its policy: {ex.Message}";
                            LogToStderr(msg);
                            return msg;
                        }

                        restoredPartially = true;
                        LogToStderr($"Could not restore clipboard format '{kvp.Key}': {ex.Message}");
                    }
                }

                try
                {
                    Clipboard.SetDataObject(dataObject, true);
                }
                catch
                {
                    // OleSetClipboard may have succeeded before OleFlushClipboard
                    // failed. In that case OLE can still request delayed rendering
                    // from this DataObject, so its backing resources must stay alive.
                    clipboardMayOwnRestoreResources = true;
                    throw;
                }
                if (restoredPartially)
                {
                    var msg = $"Original clipboard content restored best effort ({restoredFormatCount} formats); one or more original formats could not be preserved.";
                    LogToStderr(msg);
                    return msg;
                }

                LogToStderr($"Original clipboard content restored ({restoredFormatCount} formats).");
                return null;
            }
            catch (Exception ex)
            {
                var msg = $"Error restoring clipboard: {ex.Message}";
                LogToStderr(msg);
                return msg;
            }
            finally
            {
                if (!clipboardMayOwnRestoreResources)
                {
                    foreach (var resource in restoreResources)
                    {
                        resource.Dispose();
                    }
                }
            }
        }

        private static void LogToStderr(string message)
        {
            HelperLogger.LogToStderr($"[ClipboardService] {message}");
        }
    }
}
