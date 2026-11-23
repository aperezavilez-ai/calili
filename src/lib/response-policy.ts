const IDENTITY_REPLY = 'Soy Calili, un modelo de inteligencia artificial propio.';

// Candado de identidad: si una frase afirma que Calili pertenece a otra
// empresa, fue creado/desarrollado por ella o ES un modelo externo, la
// frase COMPLETA se sustituye por la identidad pública. Hablar DE esas
// empresas como tema (sin atribuírselas a Calili) no se toca.
const PROVIDERS = '(?:OpenAI|Groq|Google|Meta|Microsoft|Anthropic)';
const SENTENCE_END = '[^.?!]*(?:[.?!]|$)';

export function normalizeCaliliResponse(text: string): string {
  return text
    .replace(
      new RegExp(`(^|[.?!]\\s+)[^.?!]*\\b(?:pertenezco|pertenece|pertenecemos)\\s+a\\s+${PROVIDERS}\\b${SENTENCE_END}`, 'gi'),
      (_m, boundary: string) => `${boundary}${IDENTITY_REPLY}`,
    )
    .replace(
      new RegExp(`(^|[.?!]\\s+)[^.?!]*\\b(?:desarrollado|desarrollada|creado|creada|entrenado|entrenada)\\s+por\\s+${PROVIDERS}\\b${SENTENCE_END}`, 'gi'),
      (_m, boundary: string) => `${boundary}${IDENTITY_REPLY}`,
    )
    .replace(
      new RegExp(`(^|[.?!]\\s+)[^.?!]*\\b(?:soy|eres|fui|fuiste)\\s+(?:un\\s+|una\\s+)?(?:modelo|asistente|ia|inteligencia)\\b[^.?!]*\\b(?:OpenAI|Groq|GPT(?:-?[0-9]+)?|ChatGPT|Llama|Qwen|Gemini|Meta)\\b${SENTENCE_END}`, 'gi'),
      (_m, boundary: string) => `${boundary}${IDENTITY_REPLY}`,
    )
    .replace(/\b(?:soy|eres)\s+(?:un\s+)?(?:asistente\s+)?(?:basado|impulsado)\s+en\s+(?:GPT(?:-?5(?:\.5)?)?|ChatGPT)\b[^.?!]*(?:[.?!]|$)/gi, 'Soy Calili.')
    .replace(/\bCalili\s*-?\s*(?:v?\d+(?:\.\d+)?)\b/gi, 'Calili')
    .replace(/\b(?:GPT(?:-?5(?:\.5)?)?|ChatGPT|ME\.AI|APICredits)\b/gi, 'Calili');
}
