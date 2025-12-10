using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace WindowsHelper.Services
{
    public class AudioService
    {
        private WaveOutEvent? waveOut;
        private MMDeviceEnumerator? deviceEnumerator;
        private float originalVolume = 1.0f;
        private bool originalMuteState = false;

        // Preloaded audio data for faster playback
        private readonly Dictionary<string, byte[]> preloadedAudio = new();

        public event EventHandler<string>? SoundPlaybackCompleted;

        public AudioService()
        {
            try
            {
                deviceEnumerator = new MMDeviceEnumerator();

                // Preload audio files at startup for faster playback
                PreloadSound("rec-start");
                PreloadSound("rec-stop");
                LogToStderr("Audio files preloaded at startup");
            }
            catch (Exception ex)
            {
                LogToStderr($"Failed to initialize audio service: {ex.Message}");
            }
        }

        private void PreloadSound(string soundName)
        {
            try
            {
                var assembly = Assembly.GetExecutingAssembly();
                var resourceName = $"WindowsHelper.Resources.{soundName}.mp3";

                using var stream = assembly.GetManifestResourceStream(resourceName);
                if (stream != null)
                {
                    using var ms = new MemoryStream();
                    stream.CopyTo(ms);
                    preloadedAudio[soundName] = ms.ToArray();
                    LogToStderr($"Preloaded {soundName}.mp3 ({preloadedAudio[soundName].Length} bytes)");
                }
                else
                {
                    LogToStderr($"Resource not found for preloading: {resourceName}");
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Failed to preload {soundName}: {ex.Message}");
            }
        }

        public async Task PlaySound(string soundName, string requestId)
        {
            try
            {
                LogToStderr($"PlaySound called with soundName: {soundName}");

                // Stop any currently playing sound
                if (waveOut != null && waveOut.PlaybackState == PlaybackState.Playing)
                {
                    waveOut.Stop();
                    waveOut.Dispose();
                    waveOut = null;
                }

                // Use preloaded audio data (fast) or fall back to loading from resources
                byte[]? audioData;
                if (!preloadedAudio.TryGetValue(soundName, out audioData))
                {
                    LogToStderr($"Audio not preloaded, loading from resources: {soundName}");
                    var assembly = Assembly.GetExecutingAssembly();
                    var resourceName = $"WindowsHelper.Resources.{soundName}.mp3";

                    using var stream = assembly.GetManifestResourceStream(resourceName);
                    if (stream == null)
                    {
                        LogToStderr($"Resource not found: {resourceName}");
                        return;
                    }

                    using var ms = new MemoryStream();
                    await stream.CopyToAsync(ms);
                    audioData = ms.ToArray();
                }

                // Create memory stream from preloaded/loaded audio data
                using var memoryStream = new MemoryStream(audioData);
                using var audioFile = new Mp3FileReader(memoryStream);

                waveOut = new WaveOutEvent();
                waveOut.Init(audioFile);

                // Set up completion handler
                var completionSource = new TaskCompletionSource<bool>();
                waveOut.PlaybackStopped += (sender, args) =>
                {
                    LogToStderr($"Sound playback finished for {soundName}");
                    completionSource.TrySetResult(true);
                    SoundPlaybackCompleted?.Invoke(this, requestId);
                };

                // Start playback
                waveOut.Play();
                LogToStderr($"Playing sound: {soundName}.mp3");

                // Wait for completion
                await completionSource.Task;
            }
            catch (Exception ex)
            {
                LogToStderr($"Error playing sound {soundName}: {ex.Message}");
            }
            finally
            {
                if (waveOut != null)
                {
                    waveOut.Dispose();
                    waveOut = null;
                }
            }
        }

        public bool MuteSystemAudio()
        {
            try
            {
                LogToStderr("MuteSystemAudio called");
                
                if (deviceEnumerator == null) return false;
                
                var device = deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                if (device != null)
                {
                    // Store original state
                    originalVolume = device.AudioEndpointVolume.MasterVolumeLevelScalar;
                    originalMuteState = device.AudioEndpointVolume.Mute;
                    
                    // Mute the audio
                    device.AudioEndpointVolume.Mute = true;
                    
                    LogToStderr($"System audio muted. Original volume: {originalVolume}, Original mute: {originalMuteState}");
                    return true;
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Error muting system audio: {ex.Message}");
            }
            
            return false;
        }

        public bool RestoreSystemAudio()
        {
            try
            {
                LogToStderr("RestoreSystemAudio called");
                
                if (deviceEnumerator == null) return false;
                
                var device = deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                if (device != null)
                {
                    // Restore original state
                    device.AudioEndpointVolume.Mute = originalMuteState;
                    device.AudioEndpointVolume.MasterVolumeLevelScalar = originalVolume;
                    
                    LogToStderr($"System audio restored. Volume: {originalVolume}, Mute: {originalMuteState}");
                    return true;
                }
            }
            catch (Exception ex)
            {
                LogToStderr($"Error restoring system audio: {ex.Message}");
            }
            
            return false;
        }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [AudioService] {message}");
            Console.Error.Flush();
        }
    }
}