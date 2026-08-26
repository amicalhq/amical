using System;
using System.Threading;
using System.Threading.Tasks;

namespace WindowsHelper.Services
{
    internal sealed class RecordingAmbianceController
    {
        private readonly SemaphoreSlim gate = new(1, 1);
        private readonly Func<string, Task> playSound;
        private readonly Func<bool> muteSystemAudio;
        private readonly Func<bool> restoreSystemAudio;
        private readonly Action<string> log;

        internal RecordingAmbianceController(
            Func<string, Task> playSound,
            Func<bool> muteSystemAudio,
            Func<bool> restoreSystemAudio,
            Action<string> log)
        {
            this.playSound = playSound;
            this.muteSystemAudio = muteSystemAudio;
            this.restoreSystemAudio = restoreSystemAudio;
            this.log = log;
        }

        internal async Task<bool> StartRecordingAsync(bool shouldMute, bool muteSounds)
        {
            await gate.WaitAsync();
            try
            {
                if (!muteSounds)
                {
                    await PlayBestEffortAsync("rec-start");
                }

                return !shouldMute || muteSystemAudio();
            }
            finally
            {
                gate.Release();
            }
        }

        internal async Task<bool> StopRecordingAsync(bool wasMuted, bool muteSounds)
        {
            await gate.WaitAsync();
            try
            {
                var success = !wasMuted || restoreSystemAudio();
                if (!muteSounds)
                {
                    await PlayBestEffortAsync("rec-stop");
                }

                return success;
            }
            finally
            {
                gate.Release();
            }
        }

        private async Task PlayBestEffortAsync(string soundName)
        {
            try
            {
                await playSound(soundName);
            }
            catch (Exception ex)
            {
                log($"[RpcHandler] Error playing {soundName}: {ex.Message}");
            }
        }
    }
}
