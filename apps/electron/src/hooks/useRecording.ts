import { useState, useEffect, useRef, useCallback } from 'react';
import { MicVAD } from '@ricky0123/vad-web';
import { Mutex } from 'async-mutex';

export interface UseRecordingParams {
  onAudioChunk: (arrayBuffer: ArrayBuffer, isFinalChunk: boolean) => Promise<void> | void;
  chunkDurationMs?: number;
  onRecordingStartCallback?: () => Promise<void> | void;
  onRecordingStopCallback?: () => Promise<void> | void;
}

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export interface UseRecordingOutput {
  recordingStatus: RecordingStatus; // For detailed state
  voiceDetected: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

const cleanupMediaResources = (
  vadInstance: MicVAD | null,
  streamInstance: MediaStream | null,
  mediaRecorderInstance: MediaRecorder | null,
  onDataHandler: ((event: BlobEvent) => Promise<void>) | null
) => {
  if (vadInstance) {
    try {
      vadInstance.destroy();
    } catch (e) {
      console.error('Error destroying VAD:', e);
    }
  }
  if (streamInstance) {
    streamInstance.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (e) {
        console.error('Error stopping stream track:', e);
      }
    });
  }
  if (mediaRecorderInstance && onDataHandler) {
    try {
      mediaRecorderInstance.removeEventListener('dataavailable', onDataHandler);
    } catch (e) {
      console.error('Error removing dataavailable listener:', e);
    }
  }
  console.log('Helper: Media resources cleaned up.');
};

export const useRecording = ({
  onAudioChunk,
  chunkDurationMs = 28000,
  onRecordingStartCallback,
  onRecordingStopCallback,
}: UseRecordingParams): UseRecordingOutput => {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [voiceDetected, setVoiceDetected] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const onDataHandlerRef = useRef<((event: BlobEvent) => Promise<void>) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<MicVAD | null>(null);

  // Use a single mutex for all start/stop operations
  const operationMutexRef = useRef(new Mutex());

  const internalStopRecording = useCallback(
    async (callStopCallback: boolean) => {
      // This function assumes mutex is already acquired or not needed (e.g. unmount)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        console.log('Hook: Internal: Calling mediaRecorder.stop().');
        mediaRecorderRef.current.stop(); // Triggers final 'dataavailable'
        // onRecordingStopCallback will be called by handleDataAvailable
      } else {
        // If no active media recorder, or already inactive
        cleanupMediaResources(
          vadRef.current,
          streamRef.current,
          mediaRecorderRef.current,
          onDataHandlerRef.current
        );
        vadRef.current = null;
        streamRef.current = null;
        mediaRecorderRef.current = null;
        onDataHandlerRef.current = null;

        setRecordingStatus('idle');
        setVoiceDetected(false);
        if (callStopCallback && onRecordingStopCallback) {
          try {
            await onRecordingStopCallback();
            console.log('Hook: onRecordingStopCallback executed (no active recorder).');
          } catch (e) {
            console.error('Hook: Error in onRecordingStopCallback (no active recorder):', e);
          }
        }
      }
      // isRecording is set to false by the public stopRecording or by handleDataAvailable
    },
    [onRecordingStopCallback]
  );

  const startRecording = useCallback(async () => {
    await operationMutexRef.current.runExclusive(async () => {
      // Check status instead of just isRecording for more accurate state
      if (recordingStatus !== 'idle' && recordingStatus !== 'error') {
        console.log(`Hook: Start denied. Current status: ${recordingStatus}`);
        return;
      }

      setRecordingStatus('starting');
      console.log('Hook: Attempting to start recording (status: starting)...');

      let localStream: MediaStream | null = null;
      let localVad: MicVAD | null = null;
      let localMediaRecorder: MediaRecorder | null = null;
      let localOnDataHandler: ((event: BlobEvent) => Promise<void>) | null = null;

      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (onRecordingStartCallback) {
          await onRecordingStartCallback();
          console.log('Hook: onRecordingStartCallback executed.');
        }

        streamRef.current = localStream; // Assign to ref after callback

        localMediaRecorder = new MediaRecorder(localStream);
        mediaRecorderRef.current = localMediaRecorder;

        localOnDataHandler = async (event: BlobEvent) => {
          const isFinalEvent = mediaRecorderRef.current?.state === 'inactive';
          if (event.data.size > 0) {
            const arrayBuffer = await event.data.arrayBuffer();
            try {
              await onAudioChunk(arrayBuffer, isFinalEvent);
            } catch (error) {
              console.error('Hook: Error processing audio chunk:', error);
            }
          }

          if (isFinalEvent) {
            console.log('Hook: MediaRecorder inactive, final chunk processed.');
            // Mutex should not be needed here as this is event-driven from an existing recorder
            cleanupMediaResources(
              vadRef.current,
              streamRef.current,
              mediaRecorderRef.current,
              onDataHandlerRef.current
            );
            vadRef.current = null;
            streamRef.current = null;
            mediaRecorderRef.current = null;
            onDataHandlerRef.current = null;

            setRecordingStatus('idle');
            setVoiceDetected(false);
            if (onRecordingStopCallback) {
              try {
                await onRecordingStopCallback();
                console.log('Hook: onRecordingStopCallback executed after final chunk.');
              } catch (e) {
                console.error('Hook: Error in onRecordingStopCallback after final chunk:', e);
              }
            }
          }
        };
        onDataHandlerRef.current = localOnDataHandler;
        localMediaRecorder.addEventListener('dataavailable', localOnDataHandler);
        localMediaRecorder.start(chunkDurationMs);
        console.log(
          `Hook: MediaRecorder started (status: starting), chunk duration ${chunkDurationMs}ms.`
        );

        localVad = await MicVAD.new({
          stream: localStream,
          model: 'v5',
          onSpeechStart: () => {
            console.log('VAD: Speech started');
            setVoiceDetected(true);
          },
          onSpeechEnd: () => {
            console.log('VAD: Speech ended');
            setVoiceDetected(false);
          },
        });
        vadRef.current = localVad;
        localVad.start();
        console.log('Hook: VAD started (status: starting).');

        setRecordingStatus('recording');
        console.log('Hook: Recording fully started (status: recording).');
      } catch (err) {
        console.error('Hook: Error starting recording:', err);
        cleanupMediaResources(localVad, localStream, localMediaRecorder, localOnDataHandler);
        streamRef.current = null; // Ensure refs are cleared on error
        vadRef.current = null;
        mediaRecorderRef.current = null;
        onDataHandlerRef.current = null;

        setRecordingStatus('error');
        setVoiceDetected(false);
        if (onRecordingStopCallback) {
          // If start callback was called, call stop callback
          try {
            await onRecordingStopCallback();
          } catch (e) {
            console.error('Hook: Error in onRecordingStopCallback during start error:', e);
          }
        }
      }
    });
  }, [
    onAudioChunk,
    chunkDurationMs,
    onRecordingStartCallback,
    onRecordingStopCallback,
    recordingStatus,
  ]);

  const stopRecording = useCallback(async () => {
    await operationMutexRef.current.runExclusive(async () => {
      // Check status for more accurate state
      if (recordingStatus !== 'recording' && recordingStatus !== 'starting') {
        console.log(`Hook: Stop called but status is ${recordingStatus}.`);
        // If it's 'stopping', we are already on it. If 'idle' or 'error', nothing to stop.
        return;
      }

      console.log('Hook: Attempting to stop recording (status: stopping)...');
      setRecordingStatus('stopping');
      // internalStopRecording will handle the rest, including setting isAwaitingFinalChunk
      await internalStopRecording(true); // true to callStopCallback if applicable
    });
  }, [internalStopRecording, recordingStatus]);

  useEffect(() => {
    // Capture refs and callbacks needed for cleanup at the time the effect is established.
    const capturedOperationMutex = operationMutexRef.current;
    const capturedMediaRecorderRef = mediaRecorderRef;
    const capturedStreamRef = streamRef;
    const capturedVadRef = vadRef;
    const capturedOnDataHandlerRef = onDataHandlerRef;
    const capturedOnRecordingStopCallback = onRecordingStopCallback;

    // We need to know if recording was active *at the time of unmount setup*
    // to decide if onRecordingStopCallback should be called.
    // However, state variables are not stable in the cleanup function's closure
    // if the dependency array is empty.
    // The most robust way is to rely on the refs or call a "stop" function that handles it.

    // Let's simplify: the primary goal of unmount is to release browser resources.
    // The mutex-protected stopRecording should handle application-level state and callbacks.
    // If the component unmounts abruptly, we prioritize resource release.

    return () => {
      console.log('Hook: Unmounting...');

      // Directly clean up resources using captured refs.
      // This avoids issues with stale state in async mutex operations during unmount.
      const mr = capturedMediaRecorderRef.current;
      const str = capturedStreamRef.current;
      const vad = capturedVadRef.current;
      const odh = capturedOnDataHandlerRef.current;

      if (mr && mr.state !== 'inactive') {
        console.log('Hook: Unmount: Active MediaRecorder found. Attempting to stop.');
        try {
          mr.stop(); // Best effort to trigger final data
        } catch (e) {
          console.error('Hook: Unmount: Error stopping media recorder:', e);
        }
      }
      // Regardless of MediaRecorder state, clean up VAD and Stream.
      cleanupMediaResources(vad, str, mr, odh);

      // Nullify refs after cleanup
      capturedMediaRecorderRef.current = null;
      capturedStreamRef.current = null;
      capturedVadRef.current = null;
      capturedOnDataHandlerRef.current = null;

      // Note: Calling setIsRecording(false) etc. here has no effect as the component is unmounted.
      // onRecordingStopCallback might not be reliably called here if stop() was async and didn't complete.
      // The expectation is that the user of the hook calls stopRecording and awaits it before unmounting
      // if graceful shutdown with all callbacks is critical.
      // This unmount is a "best effort" to release browser resources.
      console.log('Hook: Unmount cleanup finished.');
    };
  }, []); // EMPTY DEPENDENCY ARRAY FOR UNMOUNT CLEANUP

  console.log('Hook: Render. status:', recordingStatus, 'voice:', voiceDetected);
  return {
    recordingStatus,
    voiceDetected,
    startRecording,
    stopRecording,
  };
};
