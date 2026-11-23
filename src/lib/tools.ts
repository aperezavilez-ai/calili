import { generateFile, type CreateFileArgs, type GeneratedFile } from '@/lib/file-generator';
import { createImage } from '@/lib/image-generator';
import { googleAiKey } from '@/lib/google-media';

// Herramientas que el modelo puede invocar (function calling, formato
// OpenAI). Se anuncian solo si el servidor tiene lo necesario para
// ejecutarlas: crear_archivo siempre; buscar_web solo con TAVILY_API_KEY;
// leer_repositorio siempre (GitHub público no requiere clave).

export interface ToolCapabilities {
  createFiles: boolean;
  webSearch: boolean;
  readRepos: boolean;
  imageGen: boolean;
  imageEdit: boolean;
  memory: boolean;
  googleMedia: boolean;
}

export function toolCapabilities(): ToolCapabilities {
  return {
    createFiles: true,
    webSearch: Boolean(process.env.TAVILY_API_KEY),
    readRepos: true,
    imageGen: true,
    imageEdit: Boolean(process.env.OPENAI_API_KEY) || Boolean(googleAiKey()),
    memory: true,
    googleMedia: Boolean(googleAiKey()),
  };
}

export function toolDefinitions(caps: ToolCapabilities) {
  const tools: unknown[] = [];

  if (caps.createFiles) {
    tools.push({
      type: 'function',
      function: {
        name: 'crear_archivo',
        description:
          'Crea un archivo real y descargable para el usuario. Úsala cuando pida un documento, un Word, un Excel, un PDF, un CSV o cualquier archivo. Para Excel/CSV con datos tabulares, manda columnas y filas.',
        parameters: {
          type: 'object',
          properties: {
            formato: { type: 'string', enum: ['docx', 'xlsx', 'pdf', 'csv', 'md', 'txt'] },
            nombre: { type: 'string', description: 'Nombre del archivo, sin extensión.' },
            titulo: { type: 'string', description: 'Título visible dentro del documento.' },
            contenido: {
              type: 'string',
              description: 'Contenido en Markdown sencillo (# títulos, - viñetas, tablas con |). En Excel/CSV puede ir vacío si mandas columnas y filas.',
            },
            columnas: { type: 'array', items: { type: 'string' }, description: 'Encabezados para Excel/CSV.' },
            filas: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: 'Filas de datos para Excel/CSV.',
            },
          },
          required: ['formato', 'nombre', 'contenido'],
        },
      },
    });
  }

  if (caps.imageGen) {
    tools.push({
      type: 'function',
      function: {
        name: 'crear_imagen',
        description:
          'Crea una imagen real (JPG/PNG) y se la muestra al usuario con opción de descarga. Úsala cuando pida una imagen, un logo, un flyer visual, una ilustración o recrear/modificar una imagen. Escribe el prompt en INGLÉS, muy detallado: sujeto, estilo, colores, composición, iluminación y formato. Si el usuario adjuntó una imagen y pide recrearla o cambiarla, marca usar_adjunta=true y describe en el prompt la imagen FINAL completa que quiere.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Descripción detallada de la imagen final, en inglés.' },
            usar_adjunta: { type: 'boolean', description: 'true si debe basarse en la imagen que el usuario adjuntó en este mensaje.' },
          },
          required: ['prompt'],
        },
      },
    });
  }

  if (caps.googleMedia) {
    tools.push({
      type: 'function',
      function: {
        name: 'crear_video',
        description:
          'Crea un VIDEO real de 8 segundos con audio (Google Veo) y se lo muestra al usuario con reproductor y descarga. Tarda entre 1 y 3 minutos en generarse. Úsala cuando pida un video, un clip, una animación o mover una imagen. Escribe la descripción en INGLÉS, muy detallada: escena, movimiento de cámara, acción, ambiente y sonido. Si adjuntó una imagen y quiere animarla, marca usar_adjunta=true.',
        parameters: {
          type: 'object',
          properties: {
            descripcion: { type: 'string', description: 'Descripción detallada del video, en inglés.' },
            usar_adjunta: { type: 'boolean', description: 'true si el video debe partir de la imagen adjunta.' },
          },
          required: ['descripcion'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'crear_musica',
        description:
          'Crea MÚSICA real en MP3 (Google Lyria) y se la muestra al usuario con reproductor y descarga. tipo="cancion" = canción completa de hasta ~3 minutos (con letra si la descripción la pide); tipo="clip" = clip instrumental de 30 segundos. Describe género, instrumentos, ritmo, ambiente y, si quiere letra, el tema de la letra y el idioma.',
        parameters: {
          type: 'object',
          properties: {
            descripcion: { type: 'string', description: 'Descripción de la música: género, instrumentos, ambiente y tema de la letra si aplica.' },
            tipo: { type: 'string', enum: ['cancion', 'clip'], description: 'cancion (completa) o clip (30 s instrumental).' },
          },
          required: ['descripcion'],
        },
      },
    });
  }

  if (caps.memory) {
    tools.push({
      type: 'function',
      function: {
        name: 'recordar',
        description:
          'Guarda un hecho durable sobre el usuario en su memoria de largo plazo, para recordarlo en TODAS las conversaciones futuras. Úsala en cuanto el usuario te diga su nombre, su negocio, un dato personal o profesional, una preferencia estable o te pida recordar algo. El hecho va en una sola frase clara en tercera persona (ej. "El usuario se llama Luis", "Su estudio de tatuajes se llama Rock My Body"). No guardes cosas pasajeras de esta conversación.',
        parameters: {
          type: 'object',
          properties: {
            hecho: { type: 'string', description: 'El hecho a recordar, en una frase.' },
          },
          required: ['hecho'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'olvidar',
        description:
          'Borra de la memoria de largo plazo un hecho que el usuario pida olvidar o corrija. Pásale el hecho tal como estaba guardado, o su idea central.',
        parameters: {
          type: 'object',
          properties: {
            hecho: { type: 'string', description: 'El hecho a olvidar.' },
          },
          required: ['hecho'],
        },
      },
    });
  }

  if (caps.webSearch) {
    tools.push({
      type: 'function',
      function: {
        name: 'buscar_web',
        description:
          'Busca información actual en internet y devuelve resultados con sus fuentes. Úsala para datos recientes, precios, noticias o cualquier hecho externo verificable.',
        parameters: {
          type: 'object',
          properties: {
            consulta: { type: 'string', description: 'La búsqueda, en palabras clave.' },
          },
          required: ['consulta'],
        },
      },
    });
  }

  if (caps.readRepos) {
    tools.push({
      type: 'function',
      function: {
        name: 'leer_repositorio',
        description:
          'Lee un repositorio público de GitHub: descripción, README y estructura de archivos. Úsala cuando el usuario comparta un enlace de GitHub o pida analizar un repositorio.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL del repositorio, p. ej. https://github.com/usuario/proyecto' },
          },
          required: ['url'],
        },
      },
    });
  }

  return tools;
}

export interface ToolExecution {
  resultForModel: string;
  file?: GeneratedFile;
  memoryEvent?: { action: 'add' | 'remove'; fact: string };
}

async function executeSearch(consulta: string): Promise<string> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query: consulta,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  if (!response.ok) return `La búsqueda falló (HTTP ${response.status}). Responde sin ella y avisa al usuario.`;
  const data = await response.json();
  const results = (data.results ?? []) as Array<{ title: string; url: string; content: string }>;
  if (results.length === 0) return 'La búsqueda no devolvió resultados.';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${(r.content ?? '').slice(0, 600)}`)
    .join('\n\n');
}

async function executeReadRepo(url: string): Promise<string> {
  const match = /github\.com\/([^/\s]+)\/([^/\s#?]+)/.exec(url);
  if (!match) return 'Esa URL no parece de GitHub. Pide al usuario que la revise.';
  const [, owner, repoRaw] = match;
  const repo = repoRaw.replace(/\.git$/, '');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Calili' };

  const [repoRes, readmeRes, treeRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: { ...headers, Accept: 'application/vnd.github.raw+json' },
    }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers }),
  ]);

  if (!repoRes.ok) return `No se pudo leer el repositorio ${owner}/${repo} (HTTP ${repoRes.status}). Puede ser privado o no existir.`;
  const info = await repoRes.json();
  const readme = readmeRes.ok ? (await readmeRes.text()).slice(0, 6000) : '(sin README)';
  let files = '';
  if (treeRes.ok) {
    const tree = await treeRes.json();
    files = ((tree.tree ?? []) as Array<{ path: string; type: string }>)
      .filter((t) => t.type === 'blob')
      .slice(0, 120)
      .map((t) => t.path)
      .join('\n');
  }

  return [
    `Repositorio: ${info.full_name}`,
    `Descripción: ${info.description ?? '(sin descripción)'}`,
    `Lenguaje principal: ${info.language ?? 'n/d'} · Estrellas: ${info.stargazers_count} · Ramas: ${info.default_branch}`,
    `Actualizado: ${info.updated_at}`,
    `\nARCHIVOS:\n${files || '(no se pudo listar)'}`,
    `\nREADME:\n${readme}`,
  ].join('\n');
}

export async function executeTool(name: string, rawArgs: string, context?: { images?: string[] }): Promise<ToolExecution> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return { resultForModel: 'Los argumentos de la herramienta llegaron con formato inválido.' };
  }

  try {
    switch (name) {
      case 'crear_archivo': {
        const file = await generateFile(args as unknown as CreateFileArgs);
        return {
          resultForModel: `Archivo creado: ${file.name}. Ya se le mostró al usuario su tarjeta de descarga. Confírmalo en una frase breve, sin pegar el contenido en el chat.`,
          file,
        };
      }
      case 'crear_imagen': {
        const result = await createImage(
          { prompt: String(args.prompt ?? ''), usar_adjunta: Boolean(args.usar_adjunta) },
          context?.images?.[0],
        );
        return {
          resultForModel: `Imagen creada: ${result.file.name} (motor: ${result.engine}). Ya se le mostró al usuario con vista previa y botón de descarga. ${result.note ?? ''} Confírmalo en una frase breve.`,
          file: result.file,
        };
      }
      case 'crear_video': {
        const { googleVideo } = await import('@/lib/google-media');
        const result = await googleVideo(
          String(args.descripcion ?? ''),
          args.usar_adjunta ? context?.images?.[0] : undefined,
        );
        return {
          resultForModel: 'Video creado (8 segundos, con audio): ya se le mostró al usuario con reproductor y botón de descarga. Confírmalo en una frase breve y menciona que tardó lo que tarda Veo en generarlo.',
          file: result.file,
        };
      }
      case 'crear_musica': {
        const { googleMusic } = await import('@/lib/google-media');
        const kind = args.tipo === 'clip' ? 'clip' : 'cancion';
        const result = await googleMusic(String(args.descripcion ?? ''), kind);
        return {
          resultForModel: `Música creada (${kind === 'clip' ? 'clip de 30 segundos' : 'canción completa'}): ya se le mostró al usuario con reproductor y botón de descarga.${result.lyrics ? ` La letra/estructura que devolvió el motor es: ${result.lyrics}` : ''} Confírmalo en una frase breve.`,
          file: result.file,
        };
      }
      case 'recordar': {
        const hecho = String(args.hecho ?? '').trim();
        if (!hecho) return { resultForModel: 'No llegó el hecho a recordar.' };
        return {
          resultForModel: `Hecho guardado en la memoria de largo plazo: "${hecho}". El usuario ya lo puede dar por recordado para siempre; confírmalo en una frase breve y natural.`,
          memoryEvent: { action: 'add', fact: hecho },
        };
      }
      case 'olvidar': {
        const hecho = String(args.hecho ?? '').trim();
        if (!hecho) return { resultForModel: 'No llegó el hecho a olvidar.' };
        return {
          resultForModel: `Hecho eliminado de la memoria de largo plazo: "${hecho}". Confírmalo en una frase breve.`,
          memoryEvent: { action: 'remove', fact: hecho },
        };
      }
      case 'buscar_web':
        return { resultForModel: await executeSearch(String(args.consulta ?? '')) };
      case 'leer_repositorio':
        return { resultForModel: await executeReadRepo(String(args.url ?? '')) };
      default:
        return { resultForModel: `Herramienta desconocida: ${name}` };
    }
  } catch (error) {
    return {
      resultForModel: `La herramienta ${name} falló: ${error instanceof Error ? error.message : 'error desconocido'}. Explícaselo al usuario en una frase.`,
    };
  }
}
