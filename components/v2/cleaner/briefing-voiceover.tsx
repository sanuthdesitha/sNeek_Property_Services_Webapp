"use client";

/**
 * Voiceover control for the cleaner daily briefing — "Listen to your briefing".
 *
 * Uses the Web Speech API (speechSynthesis). Renders nothing when the API is
 * unavailable (SSR or unsupported browsers). Voice selection prefers a
 * natural/neural voice, then en-AU, then en-GB, then the default. The script is
 * spoken sentence-by-sentence to avoid the engine's long-utterance cut-off, and
 * everything is torn down on unmount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

type PlaybackState = "idle" | "playing" | "paused";

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const natural = voices.find((v) => /natural|neural/i.test(v.name));
  if (natural) return natural;
  const auVoice = voices.find((v) => /en[-_]AU/i.test(v.lang));
  if (auVoice) return auVoice;
  const gbVoice = voices.find((v) => /en[-_]GB/i.test(v.lang));
  if (gbVoice) return gbVoice;
  const anyEnglish = voices.find((v) => /^en/i.test(v.lang));
  return anyEnglish ?? voices[0];
}

export function BriefingVoiceover({ script }: { script: string }) {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

  const [state, setState] = useState<PlaybackState>("idle");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const sentencesRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  // Guards against stale onend callbacks (from a prior play) resuming playback.
  const runIdRef = useRef(0);

  const sentences = useMemo(() => splitSentences(script), [script]);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    runIdRef.current += 1; // invalidate any in-flight onend
    window.speechSynthesis.cancel();
    indexRef.current = 0;
    setState("idle");
  }, [supported]);

  // Cleanup on unmount — never leave the engine speaking after navigation.
  useEffect(() => {
    return () => {
      if (supported) {
        runIdRef.current += 1;
        window.speechSynthesis.cancel();
      }
    };
  }, [supported]);

  const speakFrom = useCallback(
    (startIndex: number) => {
      if (!supported) return;
      const runId = ++runIdRef.current;
      const voice = pickVoice(voices);
      const queue = sentencesRef.current;

      const speakNext = (i: number) => {
        if (runId !== runIdRef.current) return; // superseded
        if (i >= queue.length) {
          indexRef.current = 0;
          setState("idle");
          return;
        }
        indexRef.current = i;
        const utter = new SpeechSynthesisUtterance(queue[i]);
        utter.rate = 1.0;
        utter.pitch = 1.0;
        if (voice) {
          utter.voice = voice;
          utter.lang = voice.lang;
        }
        utter.onend = () => {
          if (runId !== runIdRef.current) return;
          speakNext(i + 1);
        };
        utter.onerror = () => {
          if (runId !== runIdRef.current) return;
          speakNext(i + 1);
        };
        window.speechSynthesis.speak(utter);
      };

      speakNext(startIndex);
    },
    [supported, voices]
  );

  const play = useCallback(() => {
    if (!supported || sentences.length === 0) return;
    // Resume a paused utterance in place.
    if (state === "paused") {
      window.speechSynthesis.resume();
      setState("playing");
      return;
    }
    window.speechSynthesis.cancel();
    sentencesRef.current = sentences;
    indexRef.current = 0;
    setState("playing");
    speakFrom(0);
  }, [supported, sentences, state, speakFrom]);

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setState("paused");
  }, [supported]);

  if (!supported || sentences.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <Volume2 className="h-3.5 w-3.5" /> Listen to your briefing
      </span>
      {state === "playing" ? (
        <EButton type="button" variant="outline" size="sm" onClick={pause}>
          <Pause className="h-4 w-4" /> Pause
        </EButton>
      ) : (
        <EButton type="button" variant="outline" size="sm" onClick={play}>
          <Play className="h-4 w-4" /> {state === "paused" ? "Resume" : "Play"}
        </EButton>
      )}
      {state !== "idle" ? (
        <EButton type="button" variant="ghost" size="sm" onClick={stop} aria-label="Stop">
          <Square className="h-4 w-4" /> Stop
        </EButton>
      ) : null}
    </div>
  );
}
