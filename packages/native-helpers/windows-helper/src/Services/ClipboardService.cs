using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Handles clipboard operations on the main STA thread via Form.Invoke.
    /// Provides save/set/restore functionality for clipboard content.
    /// </summary>
    public class ClipboardService
    {
        [DllImport("user32.dll")]
        private static extern int GetClipboardSequenceNumber();

        private readonly Form mainForm;

        internal enum StoredDataType { Direct, Image, Stream }

        /// <summary>
        /// Holds cloned clipboard data to avoid COM object threading issues.
        /// Tracks original type so we can restore Image as Image, Stream as Stream.
        /// </summary>
        internal class ClipboardContent
        {
            public Dictionary<string, (object Data, StoredDataType Type)> Formats { get; } = new Dictionary<string, (object, StoredDataType)>();
            public bool OriginalWasEmpty { get; set; }
            public bool SaveFailed { get; set; }  // Track save failure separately - don't clear clipboard on restore
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
        /// Saves the current clipboard content to memory.
        /// </summary>
        internal ClipboardContent Save()
        {
            return InvokeOnMainThread(() => DoSave());
        }

        /// <summary>
        /// Sets the clipboard to the specified text.
        /// </summary>
        public void SetText(string text)
        {
            InvokeOnMainThread(() => Clipboard.SetText(text));
        }

        /// <summary>
        /// Restores previously saved clipboard content synchronously.
        /// Returns error message if restore failed, null on success.
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

                var formats = dataObject.GetFormats();
                content.OriginalWasEmpty = formats.Length == 0;

                foreach (var format in formats)
                {
                    try
                    {
                        var data = dataObject.GetData(format);
                        if (data == null) continue;

                        if (data is System.Drawing.Image img)
                        {
                            // COM object - must convert to bytes, track as Image
                            using (var ms = new MemoryStream())
                            {
                                img.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                                content.Formats[format] = (ms.ToArray(), StoredDataType.Image);
                            }
                        }
                        else if (data is MemoryStream ms)
                        {
                            // Stream - convert to bytes, track as Stream
                            content.Formats[format] = (ms.ToArray(), StoredDataType.Stream);
                        }
                        else if (data is string || data is byte[] || data is string[] ||
                                 data is System.Collections.Specialized.StringCollection)
                        {
                            // Already thread-safe - keep as-is
                            content.Formats[format] = (data, StoredDataType.Direct);
                        }
                        // Skip other COM objects we can't handle
                    }
                    catch (Exception ex)
                    {
                        LogToStderr($"Could not save clipboard format '{format}': {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Error saving clipboard: {ex.Message}");
                content.SaveFailed = true;  // Don't set OriginalWasEmpty - that would clear clipboard on restore
            }

            return content;
        }

        /// <summary>
        /// Returns null on success, error message on failure.
        /// </summary>
        private string? DoRestore(ClipboardContent content, int expectedSeq)
        {
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

                if (content.Formats.Count == 0)
                {
                    var msg = "No clipboard formats could be captured; cannot restore original content.";
                    LogToStderr(msg);
                    return msg;
                }

                var dataObject = new DataObject();

                foreach (var kvp in content.Formats)
                {
                    try
                    {
                        var (data, dataType) = kvp.Value;

                        switch (dataType)
                        {
                            case StoredDataType.Image:
                                // Restore as Image from PNG bytes
                                using (var ms = new MemoryStream((byte[])data))
                                {
                                    using (var img = System.Drawing.Image.FromStream(ms))
                                    {
                                        // Clone because Image.FromStream requires stream to stay open
                                        dataObject.SetData(kvp.Key, new System.Drawing.Bitmap(img));
                                    }
                                }
                                break;

                            case StoredDataType.Stream:
                                // Restore as MemoryStream
                                dataObject.SetData(kvp.Key, new MemoryStream((byte[])data));
                                break;

                            default:
                                // Direct types - pass through
                                dataObject.SetData(kvp.Key, data);
                                break;
                        }
                    }
                    catch (Exception ex)
                    {
                        LogToStderr($"Could not restore clipboard format '{kvp.Key}': {ex.Message}");
                        // Continue trying other formats
                    }
                }

                Clipboard.SetDataObject(dataObject, true);
                LogToStderr($"Original clipboard content restored ({content.Formats.Count} formats).");
                return null;
            }
            catch (Exception ex)
            {
                var msg = $"Error restoring clipboard: {ex.Message}";
                LogToStderr(msg);
                return msg;
            }
        }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [ClipboardService] {message}");
            Console.Error.Flush();
        }
    }
}
