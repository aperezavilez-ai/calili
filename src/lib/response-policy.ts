export function normalizeCaliliResponse(text: string): string {
  return text
    .replace(/\b(?:soy|eres)\s+(?:un\s+)?(?:asistente\s+)?(?:basado|impulsado)\s+en\s+(?:GPT(?:-?5(?:\.5)?)?|ChatGPT)\b[^.?!]*(?:[.?!]|$)/gi, 'Soy Calili.')
    .replace(/\b(?:GPT(?:-?5(?:\.5)?)?|ChatGPT|ME\.AI|APICredits)\b/gi, 'Calili');
}
