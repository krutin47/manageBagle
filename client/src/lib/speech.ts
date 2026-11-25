import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation with the browser's own speech recognition (P3-AI2, ADR-020): free, nothing to install.
 * In Chrome and Edge the audio is processed by the browser maker's speech service; Safari processes
 * it on Apple's. Firefox has none, so the microphone button is simply not shown there.
 */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}
type RecognitionConstructor = new () => Recognition;

const recognitionClass = (): RecognitionConstructor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const speechSupported = () => recognitionClass() !== undefined;

/** Calls `onText` with each finished phrase while listening. */
export function useDictation(onText: (text: string) => void, onError?: (reason: string) => void) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const handler = useRef(onText);
  useEffect(() => {
    handler.current = onText; // the latest callback, without restarting recognition
  });

  const stop = useCallback(() => recognition.current?.stop(), []);
  const start = useCallback(() => {
    const Class = recognitionClass();
    if (!Class || recognition.current) return;
    const r = new Class();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) handler.current(result[0].transcript.trim());
      }
    };
    r.onerror = (event) =>
      onError?.(
        event.error === "not-allowed"
          ? "The microphone is blocked for this site."
          : "Speech could not be recognised. Try again, or type.",
      );
    r.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = r;
    r.start();
    setListening(true);
  }, [onError]);

  useEffect(() => () => recognition.current?.stop(), []);
  return { supported: speechSupported(), listening, start, stop };
}
