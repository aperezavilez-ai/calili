const IDENTITY_REPLY = 'Soy Calili, un modelo de inteligencia artificial propio.';

// Candado de identidad: si una frase afirma que Calili pertenece a otra
// empresa, fue creado/desarrollado por ella o ES un modelo externo, la
// frase COMPLETA se sustituye por la identidad pública. Hablar DE esas
// empresas como tema (sin atribuírselas a Calili) no se toca.
const PROVIDERS = '(?:OpenAI|Groq|Google|Meta|Microsoft|Anthropic|ME\\s?AI|MeAI)';
const SENTENCE_END = '[^.?!]*(?:[.?!]|$)';

function scrubPlainText(text: string): string {
  return text
    .replace(
      new RegExp(`(^|[.?!]\s+)[^.?!]*\b(?:pertenezco|pertenece|pertenecemos)\s+a\s+${PROVIDERS}\b${SENTENCE_END}`, 'gi'),
      (_m, boundary: string) => `${boundary}${IDENTITY_REPLY}`,
    )
    .replace(
      new RegExp(`(^|[.?!]\s+)[^.?!]*\b(?:desarrollado|desarrollada|creado|creada|entrenado|entrenada)\s+por\s+${PROVIDERS}\b${SENTENCE_END}`, 'gi'),
      (_m, boundary: string) => `${boundary}${IDENTITY_REPLY}`,
    )
    .replace(
      new RegExp(`(^|[.?!]\s+)[^.?!]*\b(?:soy|eres|fui|fuiste)\s+(?:un\s+|una\s+)?(?:modelo|asistente|ia|inteligencia)\b[^.?!]*\b(?:OpenAI|Groq|GPT(?:-?[0-9]+)?|ChatGPT|Llama|Qwen|Gemini|Meta|Claude|Sonnet|GLM|ME\s?AI)\b${SENTENCE_END}`, 'gi'),
      (_m, boundary: string) => `${boundary}${IDENTITY_REPLY}`,
    )
    .replace(/\b(?:soy|eres)\s+(?:un\s+)?(?:asistente\s+)?(?:basado|impulsado)\s+en\s+(?:GPT(?:-?5(?:\.5)?)?|ChatGPT)\b[^.?!]*(?:[.?!]|$)/gi, 'Soy Calili.')
    .replace(/\bCalili\s*-?\s*(?:v?\d+(?:\.\d+)?)\b/gi, 'Calili')
    .replace(/\b(?:GPT(?:-?5(?:\.5)?)?|ChatGPT|ME\.AI|APICredits)\b/gi, 'Calili');
}

export function normalizeCaliliResponse(text: string): string {
  // El filtro NO toca bloques de codigo ni codigo en linea: ahi "GPT" o
  // cualquier nombre puede ser contenido legitimo del usuario.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts.map((part, i) => (i % 2 === 1 ? part : scrubPlainText(part))).join('');
}

// Los errores que llegan al usuario tampoco revelan proveedores ni
// detalles internos del motor: se sustituyen por lenguaje neutro.
export function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const clean = raw
    .replace(/\b(?:OpenAI|Groq|Google|Meta|Microsoft|Anthropic|Tavily|Pollinations|Llama|Qwen|Gemini|Veo|Lyria|Claude|Sonnet|GLM)\b/gi, 'el motor')
    .replace(/\bME\s?AI\b/gi, 'el motor')
    .replace(/api\.meai\.cloud/gi, 'el motor')
    .replace(/\bgpt-oss[^\s.,;]*/gi, 'el motor')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return clean || 'Ocurrió un error inesperado.';
}
