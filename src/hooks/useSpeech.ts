import { useEffect, useState } from "react";

export function useSpeech(voiceURI?: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  function speak(text: string, rate = 1) {
    if (!("speechSynthesis" in window)) {
      alert("Trình duyệt này chưa hỗ trợ Web Speech API.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = rate;
    utterance.voice = voices.find((voice) => voice.voiceURI === voiceURI) ?? voices.find((voice) => voice.lang.startsWith("en")) ?? null;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  return { voices, speak };
}
