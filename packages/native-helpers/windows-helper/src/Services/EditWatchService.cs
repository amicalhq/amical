using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Interop.UIAutomationClient;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Holds the text element a paste went into and reads its whole value on
    /// request. One watch at a time; a new start replaces the previous one.
    /// The lock guards only the watch reference. UI Automation calls run
    /// outside it, one at a time per watch, so a hung read blocks only later
    /// reads of the same watch.
    /// Results carry field text: callers must log status, lengths and timings only.
    /// </summary>
    public class EditWatchService
    {
        private const int UIA_E_ELEMENTNOTAVAILABLE = unchecked((int)0x80040201);

        private sealed class Watch
        {
            public Watch(IUIAutomationElement element, TextReadPath readPath)
            {
                Id = Guid.NewGuid().ToString();
                Element = element;
                ReadPath = readPath;
            }

            public string Id { get; }
            public IUIAutomationElement Element { get; }
            public TextReadPath ReadPath { get; }
            public SemaphoreSlim ReadGate { get; } = new SemaphoreSlim(1, 1);

            // The placeholder check walks part of the element's subtree (calls
            // answered by the target app). Most reads see unchanged text, so the
            // answer is kept until the text changes. Reads are serialized by ReadGate.
            public string? PlaceholderCheckedText { get; set; }
            public bool PlaceholderShowing { get; set; }
        }

        private readonly object gate = new object();
        private Watch? current;

        public StartEditWatchResult Start()
        {
            var focusedElement = FocusService.GetFocusedElement();
            if (focusedElement == null)
            {
                return StartResult(StartStatus.NoElement);
            }

            if (SelectionExtractor.IsSecureField(focusedElement))
            {
                return StartResult(StartStatus.Secure);
            }

            var extractionElement =
                FocusService.FindTextCapableElement(focusedElement, editableOnly: true)?.Element
                ?? focusedElement;
            var resolved = SelectionExtractor.ResolveTextElement(
                focusedElement,
                extractionElement,
                new MetricsBuilder());
            if (resolved == null)
            {
                return StartResult(StartStatus.NoElement);
            }

            var element = resolved.Value.Element;
            if (SelectionExtractor.IsSecureField(element))
            {
                return StartResult(StartStatus.Secure);
            }

            // The first read proves the element has a readable value.
            var watch = new Watch(element, resolved.Value.ReadPath);
            var first = Read(watch);
            switch (first.ReadStatus)
            {
                case ReadStatus.Ok:
                    break;
                case ReadStatus.TooLong:
                    return StartResult(StartStatus.TooLong);
                default:
                    return StartResult(StartStatus.NoValue);
            }

            lock (gate)
            {
                current = watch;
            }

            return new StartEditWatchResult
            {
                WatchId = watch.Id,
                StartStatus = StartStatus.Ok
            };
        }

        public async Task<ReadEditWatchResult> ReadAsync(string watchId)
        {
            var watch = CurrentWatch(watchId);
            if (watch == null)
            {
                return ReadResult(ReadStatus.UnknownWatch, 0);
            }

            await watch.ReadGate.WaitAsync();
            try
            {
                // Stopped or replaced while this read waited for an earlier one.
                if (CurrentWatch(watchId) == null)
                {
                    return ReadResult(ReadStatus.UnknownWatch, 0);
                }

                return Read(watch);
            }
            finally
            {
                watch.ReadGate.Release();
            }
        }

        public StopEditWatchResult Stop(string watchId)
        {
            lock (gate)
            {
                var stopped = current != null && current.Id == watchId;
                if (stopped) current = null;
                return new StopEditWatchResult { Stopped = stopped };
            }
        }

        private Watch? CurrentWatch(string watchId)
        {
            lock (gate)
            {
                return current != null && current.Id == watchId ? current : null;
            }
        }

        private static bool IsPlaceholderShowing(Watch watch, string text)
        {
            if (watch.PlaceholderCheckedText != text)
            {
                watch.PlaceholderShowing = PlaceholderHelpers.IsPlaceholderShowing(watch.Element, text);
                watch.PlaceholderCheckedText = text;
            }
            return watch.PlaceholderShowing;
        }

        private static ReadEditWatchResult Read(Watch watch)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                string? text;
                Selection? selection = null;

                if (watch.ReadPath == TextReadPath.TextPattern)
                {
                    var textPattern = watch.Element.GetCurrentPattern(Constants.UIA_TextPatternId)
                        as IUIAutomationTextPattern;
                    var documentRange = textPattern?.DocumentRange;
                    if (textPattern == null || documentRange == null)
                    {
                        return ReadResult(ReadStatus.Error, sw.ElapsedMilliseconds);
                    }

                    text = StringHelpers.NormalizeNewlines(documentRange.GetText(-1));
                    selection = ReadSelection(textPattern, documentRange);
                }
                else
                {
                    var valuePattern = watch.Element.GetCurrentPattern(Constants.UIA_ValuePatternId)
                        as IUIAutomationValuePattern;
                    if (valuePattern == null)
                    {
                        return ReadResult(ReadStatus.Error, sw.ElapsedMilliseconds);
                    }

                    text = StringHelpers.NormalizeNewlines(valuePattern.CurrentValue);
                }

                // An empty field is a valid value (the paste may not be applied yet).
                text ??= "";
                if (text.Length > Constants.EDIT_WATCH_MAX_TEXT_LENGTH)
                {
                    return ReadResult(ReadStatus.TooLong, sw.ElapsedMilliseconds);
                }

                // A field that shows its placeholder is empty. The check only matters
                // when a value is present (web editors leak the placeholder in as the
                // value), and never when the user has a real selection.
                if (text.Length > 0 && (selection?.Length ?? 0) == 0 &&
                    IsPlaceholderShowing(watch, text))
                {
                    text = "";
                    selection = null;
                }

                return new ReadEditWatchResult
                {
                    ReadStatus = ReadStatus.Ok,
                    Text = text,
                    Selection = selection,
                    ReadMs = sw.ElapsedMilliseconds
                };
            }
            catch (COMException ex) when (ex.HResult == UIA_E_ELEMENTNOTAVAILABLE)
            {
                return ReadResult(ReadStatus.Gone, sw.ElapsedMilliseconds);
            }
            catch (Exception)
            {
                return ReadResult(ReadStatus.Error, sw.ElapsedMilliseconds);
            }
        }

        /// <summary>
        /// Selection or caret as offsets into the normalized document text, the
        /// way ExtractViaTextPattern computes them. Null when the element exposes none.
        /// </summary>
        private static Selection? ReadSelection(
            IUIAutomationTextPattern textPattern,
            IUIAutomationTextRange documentRange)
        {
            IUIAutomationTextRange? selectionRange = null;
            try
            {
                var selections = textPattern.GetSelection();
                if (selections != null && selections.Length > 0)
                {
                    selectionRange = selections.GetElement(0);
                }
            }
            catch (COMException ex) when (ex.HResult != UIA_E_ELEMENTNOTAVAILABLE)
            {
                // Provider without GetSelection support: fall through to the caret.
            }

            selectionRange ??= SelectionExtractor.GetCaretRange(textPattern);
            if (selectionRange == null) return null;

            var length = StringHelpers.NormalizeNewlines(selectionRange.GetText(-1))?.Length ?? 0;
            var location = SelectionExtractor.NormalizedOffset(documentRange, selectionRange);
            return new Selection { Location = location, Length = length };
        }

        private static StartEditWatchResult StartResult(StartStatus status)
        {
            return new StartEditWatchResult { StartStatus = status };
        }

        private static ReadEditWatchResult ReadResult(ReadStatus status, long readMs)
        {
            return new ReadEditWatchResult { ReadStatus = status, ReadMs = readMs };
        }
    }
}
