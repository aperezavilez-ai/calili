// Prueba de humo del motor NEXUS — SE CORRE en la máquina de Luis:
//   node scripts/smoke-nexus.mjs
// Lee .env.local (o .env), llama al primer proveedor configurado
// (Groq si hay GROQ_API_KEY; si no, el local) y muestra la respuesta.
// No imprime la clave, solo si está presente.

import { readFileSync, existsSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const providers = [];
if (process.env.GROQ_API_KEY) {
  providers.push({
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.NEXUS_MODEL || 'openai/gpt-oss-120b',
  });
}
if (process.env.NEXUS_LOCAL_URL) {
  providers.push({
    id: 'local',
    baseUrl: process.env.NEXUS_LOCAL_URL.replace(/\/+$/, ''),
    apiKey: process.env.NEXUS_LOCAL_API_KEY || 'local-no-key',
    model: process.env.NEXUS_LOCAL_MODEL || 'nexus',
  });
}

if (providers.length === 0) {
  console.error('SIN CONFIGURACIÓN: falta GROQ_API_KEY o NEXUS_LOCAL_URL en .env.local');
  process.exit(1);
}

const provider = process.env.NEXUS_PRIMARY === 'local' && providers.length > 1
  ? providers[providers.length - 1]
  : providers[0];

console.log(`Probando NEXUS vía ${provider.id} · modelo ${provider.model} · clave presente: sí`);

const response = await fetch(`${provider.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  },
  body: JSON.stringify({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Responde en español, en una sola frase.' },
      { role: 'user', content: 'Di tu nombre y que estás funcionando.' },
    ],
    max_completion_tokens: 200,
  }),
});

if (!response.ok) {
  console.error(`FALLO: HTTP ${response.status}`);
  console.error((await response.text()).slice(0, 500));
  process.exit(1);
}

const data = await response.json();
const content = data.choices?.[0]?.message?.content ?? '(sin contenido)';
console.log('RESPUESTA:', content.trim());
console.log(`USO: ${JSON.stringify(data.usage ?? {})}`);
console.log('SMOKE OK');
