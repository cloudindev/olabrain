/** Folder of the default video avatar (ADR-012): idle/talking/greeting/poster + face.jpg. */
export const DEFAULT_AVATAR = "/alba";

/**
 * Second at which each avatar's greeting clip has finished saying «Hola. ¿En qué te puedo
 * ayudar?» (measured on its audio): the microphone opens then, so the agent doesn't hear it.
 */
const GREETING_SPEECH_END: Record<string, number> = {
  "/alba": 4,
  "/lia": 3.5,
};

export function greetingSpeechEnd(avatar: string | null | undefined): number {
  return GREETING_SPEECH_END[avatar ?? DEFAULT_AVATAR] ?? 4;
}
