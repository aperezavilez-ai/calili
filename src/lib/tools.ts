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
  preciseEdit: boolean;
  utilities: boolean;
  memory: boolean;
  googleMedia: boolean;
  avatarService: boolean;
  imageTools: boolean;
  narration: boolean;
}

export function toolCapabilities(): ToolCapabilities {
  return {
    createFiles: true,
    webSearch: Boolean(process.env.TAVILY_API_KEY),
    readRepos: true,
    imageGen: true,
    imageEdit: Boolean(process.env.OPENAI_API_KEY) || Boolean(googleAiKey()),
    preciseEdit: Boolean(googleAiKey()),
    utilities: true,
    memory: true,
    googleMedia: Boolean(googleAiKey()),
    avatarService: Boolean(process.env.AVATAR_SERVICE_URL),
    // Clonar/transformar/ampliar/extraer trabajan sobre la imagen
    // adjunta con sharp y la visión ya conectadas: sin llaves nuevas.
    imageTools: true,
    // La narración usa la misma voz Dalia de /api/speak (sin clave).
    narration: true,
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
          'Crea un archivo real y descargable para el usuario. Úsala cuando pida un documento, un Word, un Excel, un PDF, un CSV, un archivo de código o datos (SQL, JSON, HTML, XML, Python, JavaScript, TypeScript, CSS) o cualquier archivo. Para Excel/CSV con datos tabulares, manda columnas y filas. En los formatos de código el contenido se escribe EXACTO, sin convertirlo a Markdown.',
        parameters: {
          type: 'object',
          properties: {
            formato: { type: 'string', enum: ['docx', 'xlsx', 'pdf', 'csv', 'md', 'txt', 'sql', 'json', 'html', 'xml', 'py', 'js', 'ts', 'css'] },
            nombre: { type: 'string', description: 'Nombre del archivo, sin extensión.' },
            titulo: { type: 'string', description: 'Título visible dentro del documento (solo formatos de documento; en código se ignora).' },
            contenido: {
              type: 'string',
              description: 'En documentos: Markdown sencillo (# títulos, - viñetas, tablas con |). En formatos de código (sql, json, html, xml, py, js, ts, css): el código EXACTO y completo, tal cual debe quedar en el archivo. En Excel/CSV puede ir vacío si mandas columnas y filas.',
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
          'Crea una imagen real (JPG/PNG) y se la muestra al usuario con opción de descarga. Úsala cuando pida una imagen, un logo, un flyer visual, una ilustración o recrear/modificar una imagen. Escribe el prompt en INGLÉS, muy detallado: sujeto, estilo, colores, composición, iluminación y formato. Si el usuario adjuntó una imagen y pide recrearla o cambiarla, marca usar_adjunta=true y describe en el prompt la imagen FINAL completa que quiere. REGLA PARA FLYERS Y DISEÑOS CON TEXTO: si el encargo es un flyer, póster, anuncio o diseño que lleva textos (nombre del negocio, teléfono, precio, frases), el prompt debe ser el diseño COMPLETO: empieza con promotional flyer design e incluye CADA texto EXACTO entre comillas (verbatim text: "..."), su posición y su jerarquía (titular grande arriba, datos de contacto abajo). NUNCA reduzcas un encargo de diseño a solo el dibujo o la foto del sujeto: un flyer sin sus textos no cumple el encargo. REGLA PARA LOGOS: si el encargo es un logo o marca, el prompt debe pedir un diseño de logo limpio y profesional (flat vector logo design, centered composition, solid background del color que pida el usuario o el de su diseño) con el texto de la marca EXACTO entre comillas como ÚNICO texto de la imagen (the only text in the image is the exact brand name "..."), el estilo de letra (bold 3D gold letters, brush script…), los colores y los elementos (corona, casa, instrumento…) descritos uno por uno. Si el usuario pide cambiar SOLO una palabra de su logo adjunto, describe la imagen final COMPLETA con la palabra nueva ya puesta (recreación fiel del mismo diseño, no un parche): misma composición, mismos colores, mismo estilo, solo cambia esa palabra.',
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

  if (caps.preciseEdit) {
    tools.push({
      type: 'function',
      function: {
        name: 'editar_imagen',
        description:
          'Edición PRECISA de la imagen adjunta: cambia SOLO el elemento indicado y conserva el resto de la imagen píxel a píxel (el fondo, los adornos y lo demás no se repintan). El resultado se VERIFICA antes de entregarse: si el cambio no quedó aplicado, la herramienta lo declara y no entrega nada. Úsala cuando el usuario pida cambiar, quitar o corregir UNA cosa de su imagen o logo manteniendo lo demás igual: cambiar una palabra del logo, corregir un texto, quitar un elemento. Es la herramienta correcta para logos existentes; crear_imagen en cambio RECREA la imagen completa y sirve para diseños nuevos. elemento = el elemento visible a localizar, descrito con su texto exacto (ej.: the word "COOL-ICHIS"). cambio = la instrucción de edición en INGLÉS, completa (ej.: replace the word "COOL-ICHIS" with "Culichis" in the identical gold 3D lettering style). Requiere que el usuario haya adjuntado la imagen en este mensaje.',
        parameters: {
          type: 'object',
          properties: {
            elemento: { type: 'string', description: 'El elemento visible a cambiar, con su texto exacto si es texto.' },
            cambio: { type: 'string', description: 'La instrucción de edición en inglés: qué poner en su lugar, con el mismo estilo.' },
          },
          required: ['elemento', 'cambio'],
        },
      },
    });
  }

  if (caps.imageTools) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'clonar_imagen',
          description:
            'CLONA la imagen que el usuario adjuntó en este mensaje. Úsala cuando pida clonar, duplicar, copiar fielmente o hacer una versión de su imagen. modo="exacto": devuelve la imagen IDÉNTICA, píxel a píxel, sin pasar por ningún motor de IA (es una copia real del archivo). modo="variacion": genera UNA variante fiel a partir de la adjunta (misma composición, sujeto, colores y estilo; cambios solo si el usuario los pide en cambios). Para UNA variante por llamada: si pide varias, llama la herramienta varias veces. cambios va en INGLÉS cuando modo="variacion". Requiere la imagen adjunta en este mensaje.',
          parameters: {
            type: 'object',
            properties: {
              modo: { type: 'string', enum: ['exacto', 'variacion'], description: 'exacto = copia idéntica del archivo; variacion = versión generada fiel a la original.' },
              cambios: { type: 'string', description: 'Solo en variacion: los cambios pedidos, en inglés. Vacío = variante fiel sin cambios.' },
            },
            required: ['modo'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'transformar_imagen',
          description:
            'Transforma la imagen adjunta de forma EXACTA y determinista (sin IA, sin repintar): convierte el formato (png, jpg, webp), redimensiona a un ancho/alto en píxeles y/o rota (0, 90, 180, 270). Úsala cuando pidan convertir, redimensionar, achicar, girar o cambiar el formato de su imagen. Requiere la imagen adjunta en este mensaje.',
          parameters: {
            type: 'object',
            properties: {
              formato: { type: 'string', enum: ['png', 'jpg', 'webp'], description: 'Formato de salida (opcional).' },
              ancho: { type: 'number', description: 'Ancho de salida en píxeles (opcional, 16-8000).' },
              alto: { type: 'number', description: 'Alto de salida en píxeles (opcional, 16-8000).' },
              rotar: { type: 'number', enum: [0, 90, 180, 270], description: 'Grados de rotación (opcional).' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ampliar_imagen',
          description:
            'Amplía la imagen adjunta (upscale determinista con sharp, sin IA): la escala al factor pedido (2 por defecto, máximo 4) o al ancho objetivo. Úsala cuando pidan agrandar una imagen, subir su resolución o hacerla más grande para imprimir. No inventa detalle: interpola con la mejor calidad. Requiere la imagen adjunta en este mensaje.',
          parameters: {
            type: 'object',
            properties: {
              factor: { type: 'number', description: 'Factor de escala 1.5-4 (opcional; por defecto 2).' },
              ancho_objetivo: { type: 'number', description: 'Ancho final en píxeles (opcional; manda sobre factor).' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'extraer_texto',
          description:
            'Extrae TODO el texto visible de la imagen adjunta (OCR con el modelo de visión): letras de un logo, un documento fotografiado, una captura, un letrero. Devuelve la transcripción literal para que la entregues tal cual. Úsala cuando pidan leer, transcribir o sacar el texto de una imagen. Requiere la imagen adjunta en este mensaje.',
          parameters: { type: 'object', properties: {} },
        },
      },
    );
  }

  if (caps.narration) {
    tools.push({
      type: 'function',
      function: {
        name: 'narrar_texto',
        description:
          'Convierte un texto en AUDIO narrado (MP3, voz femenina en español) y se lo muestra al usuario con reproductor y descarga. Úsala cuando pidan escuchar un texto, una narración, un audio de un guion o que les leas algo en un archivo de audio. Máximo ~1200 caracteres por llamada. El texto va EXACTO como debe escucharse.',
        parameters: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'El texto exacto a narrar.' },
          },
          required: ['texto'],
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
          'Crea un VIDEO real con audio y se lo muestra al usuario con reproductor y descarga. Tarda entre 1 y 3 minutos en generarse. Úsala cuando pida un video, un clip, una animación o mover una imagen. Escribe la descripción en INGLÉS, muy detallada: escena, movimiento de cámara, acción, ambiente y sonido. Si adjuntó una imagen y quiere animarla, marca usar_adjunta=true. REGLA CINEMATOGRÁFICA (siempre): escribe la descripción como la indicación de un director de fotografía, no como una frase suelta — incluye tipo de plano (wide shot, close-up, aerial…), UN movimiento de cámara claro (slow dolly-in, smooth pan, orbiting…), la iluminación (golden hour, dramatic side light, neon glow…), la paleta y el acabado (cinematic color grade, shallow depth of field, subtle film grain) y el ambiente sonoro. Si es animación de una foto, describe qué elementos se mueven y cómo (el brillo recorre las letras, las partículas flotan, la cámara se acerca lento) conservando la imagen original como primer cuadro.',
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
          'Crea MÚSICA real en MP3 y se la muestra al usuario con reproductor y descarga. tipo="cancion" = canción completa de hasta ~3 minutos (con letra si la descripción la pide); tipo="clip" = clip instrumental de 30 segundos. Describe género, instrumentos, ritmo, ambiente y, si quiere letra, el tema de la letra y el idioma.',
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

  if (caps.utilities) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'leer_pagina',
          description:
            'Lee el contenido de texto de una página web (un artículo, una noticia, la página de un negocio) y te lo entrega para resumirlo o responder sobre él. Úsala cuando el usuario comparta un enlace que NO sea de GitHub y pida leerlo, resumirlo o analizarlo.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'La URL completa de la página.' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'clima',
          description:
            'Consulta el clima real de una ciudad: temperatura actual, condiciones y pronóstico de 3 días. Úsala cuando pregunten por el clima o el tiempo en algún lugar.',
          parameters: {
            type: 'object',
            properties: {
              ciudad: { type: 'string', description: 'Ciudad y, si se sabe, estado/país (ej.: Culiacán, Sinaloa).' },
            },
            required: ['ciudad'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'tipo_cambio',
          description:
            'Consulta el tipo de cambio real entre dos monedas (USD, MXN, EUR…) y convierte una cantidad si la dan. Úsala cuando pregunten cuánto vale una moneda o cuánto es X en otra moneda.',
          parameters: {
            type: 'object',
            properties: {
              de: { type: 'string', description: 'Moneda origen en código ISO (USD, MXN, EUR).' },
              a: { type: 'string', description: 'Moneda destino en código ISO.' },
              cantidad: { type: 'number', description: 'Cantidad a convertir (opcional).' },
            },
            required: ['de', 'a'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'calcular',
          description:
            'Calculadora exacta: evalúa una expresión aritmética (+, -, *, /, %, ^, paréntesis, sqrt(), abs(), round()) sin errores de redondeo mental. Úsala para cuentas con varios pasos, porcentajes encadenados o cifras grandes, y entrega el resultado de la herramienta.',
          parameters: {
            type: 'object',
            properties: {
              expresion: { type: 'string', description: 'La expresión, ej.: (1250 * 0.16) + 340 / 2' },
            },
            required: ['expresion'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fecha_actual',
          description:
            'Te dice la fecha y hora actual reales (día de la semana, fecha y hora). Úsala cuando la respuesta dependa de qué día es hoy o de la hora, o cuando te lo pregunten.',
          parameters: {
            type: 'object',
            properties: {
              zona: { type: 'string', description: 'Zona horaria IANA opcional (ej.: America/Mazatlan, America/Mexico_City).' },
            },
          },
        },
      },
    );
  }

  if (caps.createFiles) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'crear_qr',
          description:
            'Crea un código QR real en PNG (para un enlace, un teléfono, un WhatsApp, un texto) y se lo muestra al usuario con descarga. Úsala cuando pidan un QR.',
          parameters: {
            type: 'object',
            properties: {
              contenido: { type: 'string', description: 'El enlace o texto que llevará el QR.' },
            },
            required: ['contenido'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crear_presentacion',
          description:
            'Crea una presentación PowerPoint (.pptx) real y descargable: portada con el título y una diapositiva por tema con sus viñetas. Úsala cuando pidan una presentación, diapositivas o un pitch en PowerPoint.',
          parameters: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'Título de la presentación (portada).' },
              subtitulo: { type: 'string', description: 'Subtítulo de la portada (opcional).' },
              diapositivas: {
                type: 'array',
                description: 'Las diapositivas de contenido.',
                items: {
                  type: 'object',
                  properties: {
                    titulo: { type: 'string' },
                    puntos: { type: 'array', items: { type: 'string' }, description: 'Viñetas de la diapositiva (3-6).' },
                  },
                  required: ['titulo', 'puntos'],
                },
              },
            },
            required: ['titulo', 'diapositivas'],
          },
        },
      },
    );
  }

  if (caps.avatarService) {
    tools.push({
      type: 'function',
      function: {
        name: 'crear_video_hablado',
        description:
          'Crea un VIDEO HABLADO: la persona de la foto que el usuario adjuntó habla el guion con los labios sincronizados a la voz. Tarda varios minutos. Úsala SOLO cuando el usuario adjunte la foto de una persona y pida que hable, diga un texto, presente algo o grabe un mensaje en video. Escribe el guion EXACTO que debe decir, en el idioma del usuario, máximo ~60 segundos de voz (unas 130 palabras). Si el usuario pide fondo musical, marca musica=true y describe la musica en pocas palabras.',
        parameters: {
          type: 'object',
          properties: {
            guion: { type: 'string', description: 'El texto exacto que la persona dice en el video.' },
            musica: { type: 'boolean', description: 'true si debe llevar musica de fondo.' },
            descripcion_musica: { type: 'string', description: 'Si musica=true: genero y ambiente de la musica de fondo.' },
          },
          required: ['guion'],
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
          'Lee un repositorio público de GitHub: descripción, README, estructura y el CÓDIGO de sus archivos clave (manifiestos y puntos de entrada). Si el usuario pregunta por un archivo concreto, vuelve a llamarla con su ruta en «archivo» para leer ese archivo. Úsala cuando el usuario comparta un enlace de GitHub o pida analizar un repositorio.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL del repositorio, p. ej. https://github.com/usuario/proyecto' },
            archivo: { type: 'string', description: 'Opcional: ruta de un archivo concreto a leer, p. ej. src/index.ts' },
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return `La búsqueda falló (HTTP ${response.status}). Responde sin ella y avisa al usuario.`;
  const data = await response.json();
  const results = (data.results ?? []) as Array<{ title: string; url: string; content: string }>;
  if (results.length === 0) return 'La búsqueda no devolvió resultados.';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${(r.content ?? '').slice(0, 600)}`)
    .join('\n\n');
}

// Qué archivos leer de un repo: el pedido explícito manda; si no, los
// manifiestos y puntos de entrada primero y luego el código más
// superficial. Fuera binarios, lockfiles, pruebas y carpetas de build.
const REPO_SKIP_RE = /(^|\/)(node_modules|dist|build|out|vendor|\.git)\/|(\.lock$|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)|\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|eot|mp3|mp4|mov|zip|tar|gz|pdf|min\.js|map)$/i;
const REPO_MANIFEST_RE = /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|composer\.json|Gemfile|pom\.xml)$/i;
const REPO_ENTRY_RE = /(^|\/)(index|main|app|page|server|cli)\.(ts|tsx|js|jsx|mjs|py|go|rs|php|rb)$/i;
const REPO_SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|php|rb|md)$/i;
function pickRepoFiles(paths: string[], archivo?: string): string[] {
  if (archivo) return [archivo.replace(/^\/+/, '')];
  const usable = paths.filter((p) => !REPO_SKIP_RE.test(p));
  const depth = (p: string) => p.split('/').length;
  const manifests = usable.filter((p) => REPO_MANIFEST_RE.test(p)).sort((a, b) => depth(a) - depth(b));
  const entries = usable.filter((p) => REPO_ENTRY_RE.test(p) && !manifests.includes(p)).sort((a, b) => depth(a) - depth(b));
  const sources = usable.filter((p) => REPO_SOURCE_RE.test(p) && !manifests.includes(p) && !entries.includes(p)).sort((a, b) => depth(a) - depth(b));
  return [...manifests, ...entries, ...sources].slice(0, 6);
}

async function executeReadRepo(url: string, archivo?: string): Promise<string> {
  const match = /github\.com\/([^/\s]+)\/([^/\s#?]+)/.exec(url);
  if (!match) return 'Esa URL no parece de GitHub. Pide al usuario que la revise.';
  const [, owner, repoRaw] = match;
  const repo = repoRaw.replace(/\.git$/, '');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Calili' };

  const repoSignal = AbortSignal.timeout(20_000);
  const [repoRes, readmeRes, treeRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: repoSignal }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: { ...headers, Accept: 'application/vnd.github.raw+json' },
      signal: repoSignal,
    }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers, signal: repoSignal }),
  ]);

  if (!repoRes.ok) return `No se pudo leer el repositorio ${owner}/${repo} (HTTP ${repoRes.status}). Puede ser privado o no existir.`;
  const info = await repoRes.json();
  const readme = readmeRes.ok ? (await readmeRes.text()).slice(0, 6000) : '(sin README)';
  let paths: string[] = [];
  if (treeRes.ok) {
    const tree = await treeRes.json();
    paths = ((tree.tree ?? []) as Array<{ path: string; type: string }>)
      .filter((t) => t.type === 'blob')
      .map((t) => t.path);
  }
  const files = paths.slice(0, 120).join('\n');

  // v3.4.6: antes esto era solo la ficha (README + nombres de archivo);
  // Luis preguntó si Calili podía ANALIZAR un repo y la respuesta era
  // que no. Ahora se lee el código de los archivos clave (o el archivo
  // pedido) con presupuesto total de caracteres.
  const picks = pickRepoFiles(paths, archivo);
  let codeSection = '';
  if (archivo && paths.length > 0 && !paths.includes(archivo.replace(/^\/+/, ''))) {
    codeSection = `\n\nNOTA: el archivo pedido (${archivo}) no aparece en la estructura del repositorio.`;
  }
  if (picks.length > 0) {
    const contents = await Promise.all(picks.map(async (path) => {
      try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
          headers: { ...headers, Accept: 'application/vnd.github.raw+json' },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return null;
        return { path, text: await res.text() };
      } catch {
        return null;
      }
    }));
    const chunks: string[] = [];
    let budget = 20000;
    for (const item of contents) {
      if (!item || budget <= 0) continue;
      const slice = item.text.slice(0, Math.min(3500, budget));
      budget -= slice.length;
      chunks.push(`### ${item.path}\n${slice}`);
    }
    if (chunks.length > 0) {
      codeSection = `\n\nCÓDIGO DE ARCHIVOS CLAVE:\n\n${chunks.join('\n\n')}`;
    }
  }

  return [
    `Repositorio: ${info.full_name}`,
    `Descripción: ${info.description ?? '(sin descripción)'}`,
    `Lenguaje principal: ${info.language ?? 'n/d'} · Estrellas: ${info.stargazers_count} · Ramas: ${info.default_branch}`,
    `Actualizado: ${info.updated_at}`,
    `\nARCHIVOS:\n${files || '(no se pudo listar)'}`,
    `\nREADME:\n${readme}`,
    codeSection,
  ].join('\n');
}

async function executeReadPage(rawUrl: string): Promise<string> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return 'La URL no es válida: debe empezar con http:// o https://';
  if (process.env.TAVILY_API_KEY) {
    try {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
        body: JSON.stringify({ urls: [url], extract_depth: 'basic' }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.results?.[0]?.raw_content || data?.results?.[0]?.content || '';
        if (text) return `Contenido de ${url}:\n\n${String(text).slice(0, 9000)}`;
      }
    } catch { /* se cae a la lectura directa */ }
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Calili/1.0)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return `La página respondió ${res.status}; no se pudo leer.`;
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'La página no devolvió texto legible (puede requerir JavaScript o inicio de sesión).';
  return `Contenido de ${url}:\n\n${text.slice(0, 9000)}`;
}

const WMO_ES: Record<number, string> = {
  0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'niebla', 48: 'niebla con escarcha', 51: 'llovizna ligera', 53: 'llovizna', 55: 'llovizna intensa',
  61: 'lluvia ligera', 63: 'lluvia', 65: 'lluvia fuerte', 71: 'nieve ligera', 73: 'nieve', 75: 'nieve fuerte',
  80: 'chubascos ligeros', 81: 'chubascos', 82: 'chubascos fuertes', 95: 'tormenta', 96: 'tormenta con granizo', 99: 'tormenta con granizo fuerte',
};

async function executeWeather(ciudad: string): Promise<string> {
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ciudad)}&count=1&language=es&format=json`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!geo.ok) throw new Error(`geocoding respondió ${geo.status}`);
  const geoData = await geo.json();
  const place = geoData?.results?.[0];
  if (!place) return `No encontré la ciudad «${ciudad}». Pide el nombre con estado o país.`;
  const fc = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!fc.ok) throw new Error(`pronóstico respondió ${fc.status}`);
  const data = await fc.json();
  const cur = data?.current ?? {};
  const daily = data?.daily ?? {};
  const lines = [
    `Clima en ${place.name}${place.admin1 ? `, ${place.admin1}` : ''} (${place.country ?? ''}):`,
    `Ahora: ${cur.temperature_2m}°C, ${WMO_ES[cur.weather_code] ?? 'condición no clasificada'}, humedad ${cur.relative_humidity_2m}%, viento ${cur.wind_speed_10m} km/h.`,
  ];
  const days: string[] = Array.isArray(daily.time) ? daily.time : [];
  days.forEach((day: string, i: number) => {
    lines.push(`${day}: máx ${daily.temperature_2m_max?.[i]}°C · mín ${daily.temperature_2m_min?.[i]}°C · ${WMO_ES[daily.weather_code?.[i]] ?? ''}`);
  });
  return lines.join('\n');
}

async function executeFx(deRaw: string, aRaw: string, cantidad?: number): Promise<string> {
  const de = deRaw.trim().toUpperCase();
  const a = aRaw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(de) || !/^[A-Z]{3}$/.test(a)) return 'Las monedas deben ir en código ISO de 3 letras (USD, MXN, EUR…).';
  const res = await fetch(`https://api.frankfurter.app/latest?from=${de}&to=${a}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`tipo de cambio respondió ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.[a];
  if (typeof rate !== 'number') return `No hay tipo de cambio disponible para ${de} → ${a}.`;
  const base = `Tipo de cambio (${data.date ?? 'hoy'}): 1 ${de} = ${rate} ${a}.`;
  if (typeof cantidad === 'number' && Number.isFinite(cantidad)) {
    const converted = cantidad * rate;
    return `${base}\n${cantidad} ${de} = ${converted.toLocaleString('es-MX', { maximumFractionDigits: 2 })} ${a}.`;
  }
  return base;
}

// Calculadora segura: descenso recursivo sobre la expresión; cualquier
// token fuera de la gramática aritmética aborta. Nada de eval.
function safeEval(rawExpr: string): number {
  const expr = rawExpr.replace(/\s+/g, '');
  if (!expr || expr.length > 200) throw new Error('expresión vacía o demasiado larga');
  if (!/^[0-9a-zA-Z+\-*/%^().,]+$/.test(expr)) throw new Error('la expresión trae caracteres no permitidos');
  let pos = 0;
  const peek = () => expr[pos];
  const eat = (ch?: string) => { if (ch && expr[pos] !== ch) throw new Error(`se esperaba «${ch}»`); return expr[pos++]; };
  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = eat();
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = eat();
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
    }
    return value;
  }
  function parseFactor(): number {
    let base = parseUnary();
    if (peek() === '^') { eat(); base = Math.pow(base, parseFactor()); }
    return base;
  }
  function parseUnary(): number {
    if (peek() === '-') { eat(); return -parseUnary(); }
    if (peek() === '+') { eat(); return parseUnary(); }
    return parseAtom();
  }
  function parseAtom(): number {
    if (peek() === '(') { eat(); const v = parseExpr(); eat(')'); return v; }
    const rest = expr.slice(pos);
    const fn = rest.match(/^(sqrt|abs|round|floor|ceil)\(/);
    if (fn) {
      pos += fn[0].length;
      const v = parseExpr();
      eat(')');
      switch (fn[1]) {
        case 'sqrt': return Math.sqrt(v);
        case 'abs': return Math.abs(v);
        case 'round': return Math.round(v);
        case 'floor': return Math.floor(v);
        default: return Math.ceil(v);
      }
    }
    if (/^pi\b/.test(rest)) { pos += 2; return Math.PI; }
    const num = rest.match(/^\d+(?:[.,]\d+)?/);
    if (num) { pos += num[0].length; return parseFloat(num[0].replace(',', '.')); }
    throw new Error(`no se entiende «${rest.slice(0, 12)}»`);
  }
  const result = parseExpr();
  if (pos !== expr.length) throw new Error('la expresión no se pudo evaluar completa');
  if (!Number.isFinite(result)) throw new Error('el resultado no es un número finito');
  return result;
}

function currentDateTime(zonaRaw?: string): string {
  const zona = (zonaRaw || 'America/Mazatlan').trim();
  try {
    const fmt = new Intl.DateTimeFormat('es-MX', {
      timeZone: zona, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    return `Fecha y hora actual en ${zona}: ${fmt.format(new Date())}.`;
  } catch {
    return 'La zona horaria indicada no es válida; usa un nombre IANA como America/Mazatlan.';
  }
}

function parseImageDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  return match ? { mime: match[1], buffer: Buffer.from(match[2], 'base64') } : null;
}

function imageExt(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
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
          resultForModel: `Imagen creada: ${result.file.name}. Ya se le mostró al usuario con vista previa y botón de descarga. ${result.note ?? ''} Confírmalo en una frase breve, sin mencionar motores ni proveedores.`,
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
          resultForModel: 'Video creado (con audio): ya se le mostró al usuario con reproductor y botón de descarga. Confírmalo en una frase breve y sin mencionar motores ni proveedores.',
          file: result.file,
        };
      }
      case 'crear_video_hablado': {
        const image = context?.images?.[0];
        if (!image) {
          return { resultForModel: 'Para el video hablado necesito que el usuario adjunte primero la foto de la persona. Pidesela en una frase.' };
        }
        const { synthesizeNarration } = await import('@/lib/tts');
        const { createTalkingVideo } = await import('@/lib/avatar-studio');
        const narration = await synthesizeNarration(String(args.guion ?? ''));
        let musicBase64: string | undefined;
        let musicMime: string | undefined;
        if (args.musica) {
          try {
            const { googleMusic } = await import('@/lib/google-media');
            const music = await googleMusic(String(args.descripcion_musica || 'musica de fondo suave e instrumental'), 'clip');
            musicBase64 = music.file.base64;
            musicMime = music.file.mime;
          } catch {
            // Sin musica si el motor musical falla: el video hablado manda.
          }
        }
        const result = await createTalkingVideo({
          imageDataUrl: image,
          audioBase64: narration.base64,
          audioMime: narration.mime,
          musicBase64,
          musicMime,
        });
        return {
          resultForModel: 'Video hablado creado: la persona de la foto dice el guion con los labios sincronizados y ya se le mostro al usuario con reproductor y descarga. Confirmalo en una frase breve y sin mencionar motores ni proveedores.',
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
        const hecho = String(args.hecho ?? '').trim().slice(0, 300);
        if (!hecho) return { resultForModel: 'No llegó el hecho a recordar.' };
        return {
          resultForModel: `Hecho guardado en la memoria de largo plazo: "${hecho}". El usuario ya lo puede dar por recordado para siempre; confírmalo en una frase breve y natural.`,
          memoryEvent: { action: 'add', fact: hecho },
        };
      }
      case 'olvidar': {
        const hecho = String(args.hecho ?? '').trim().slice(0, 300);
        if (!hecho) return { resultForModel: 'No llegó el hecho a olvidar.' };
        return {
          resultForModel: `Hecho eliminado de la memoria de largo plazo: "${hecho}". Confírmalo en una frase breve.`,
          memoryEvent: { action: 'remove', fact: hecho },
        };
      }
      case 'buscar_web':
        return { resultForModel: await executeSearch(String(args.consulta ?? '')) };
      case 'leer_repositorio':
        return { resultForModel: await executeReadRepo(String(args.url ?? ''), typeof args.archivo === 'string' ? args.archivo : undefined) };
      case 'editar_imagen': {
        const image = context?.images?.[0];
        if (!image) {
          return { resultForModel: 'Para editar con precisión necesito que el usuario adjunte la imagen en este mensaje. Pídesela en una frase.' };
        }
        const { localizedEdit } = await import('@/lib/localized-edit');
        const result = await localizedEdit({
          imageDataUrl: image,
          elemento: String(args.elemento ?? ''),
          cambio: String(args.cambio ?? ''),
        });
        if (result.failed || !result.file) {
          return {
            resultForModel: 'La edición precisa NO se logró: el elemento no se pudo localizar o el cambio no quedó verificado en el resultado tras dos intentos. NO hay archivo que mostrar. Dilo honestamente en una o dos frases, sin inventar un resultado, y ofrece la alternativa real: recrear la imagen completa con crear_imagen (avisando que es una recreación y puede variar del original) si el usuario lo pide.',
          };
        }
        return {
          resultForModel: `Imagen editada con precisión y VERIFICADA: ${result.file.name}. El cambio pedido se comprobó visible en el resultado y el resto de la imagen quedó intacto; ya se le mostró al usuario con vista previa y descarga. Confírmalo en una frase breve.`,
          file: result.file,
        };
      }
      case 'leer_pagina':
        return { resultForModel: await executeReadPage(String(args.url ?? '')) };
      case 'clima':
        return { resultForModel: await executeWeather(String(args.ciudad ?? '')) };
      case 'tipo_cambio':
        return { resultForModel: await executeFx(String(args.de ?? ''), String(args.a ?? ''), typeof args.cantidad === 'number' ? args.cantidad : undefined) };
      case 'calcular': {
        const expr = String(args.expresion ?? '');
        const value = safeEval(expr);
        const shown = Number.isInteger(value) ? String(value) : value.toLocaleString('es-MX', { maximumFractionDigits: 6 });
        return { resultForModel: `Resultado exacto de ${expr} = ${shown}. Entrégalo tal cual, sin recalcular.` };
      }
      case 'fecha_actual':
        return { resultForModel: currentDateTime(typeof args.zona === 'string' ? args.zona : undefined) };
      case 'crear_qr': {
        const contenido = String(args.contenido ?? '').trim();
        if (!contenido) return { resultForModel: 'Falta el contenido del QR.' };
        const QRCode = (await import('qrcode')).default;
        const buffer = await QRCode.toBuffer(contenido, {
          type: 'png', width: 720, margin: 2,
          color: { dark: '#111827', light: '#ffffff' },
        });
        return {
          resultForModel: 'Código QR creado: ya se le mostró al usuario con vista previa y botón de descarga. Confírmalo en una frase breve.',
          file: { name: 'qr-calili.png', mime: 'image/png', base64: buffer.toString('base64') },
        };
      }
      case 'crear_presentacion': {
        const PptxGenJS = (await import('pptxgenjs')).default;
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'CALILI_16x9', width: 13.33, height: 7.5 });
        pptx.layout = 'CALILI_16x9';
        const titulo = String(args.titulo ?? 'Presentación').slice(0, 120);
        const subtitulo = typeof args.subtitulo === 'string' ? args.subtitulo.slice(0, 200) : '';
        const portada = pptx.addSlide();
        portada.background = { color: '111827' };
        portada.addText(titulo, { x: 0.7, y: 2.4, w: 11.9, h: 1.6, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
        if (subtitulo) portada.addText(subtitulo, { x: 0.7, y: 4.1, w: 11.9, h: 0.8, fontSize: 20, color: '9CA3AF', fontFace: 'Arial' });
        const slides = Array.isArray(args.diapositivas) ? args.diapositivas.slice(0, 20) : [];
        for (const slide of slides) {
          const s = (slide ?? {}) as { titulo?: unknown; puntos?: unknown };
          const diapo = pptx.addSlide();
          diapo.background = { color: '1F2937' };
          diapo.addText(String(s.titulo ?? 'Sin título').slice(0, 120), { x: 0.7, y: 0.5, w: 11.9, h: 0.9, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
          const puntos = Array.isArray(s.puntos) ? s.puntos.slice(0, 8).map((p) => String(p).slice(0, 300)) : [];
          if (puntos.length) {
            diapo.addText(
              puntos.map((p) => ({ text: p, options: { bullet: true, breakLine: true } })),
              { x: 0.9, y: 1.7, w: 11.5, h: 5.2, fontSize: 20, color: 'E5E7EB', fontFace: 'Arial', lineSpacingMultiple: 1.3 },
            );
          }
        }
        const out = await pptx.write({ outputType: 'nodebuffer' });
        const buffer = Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
        return {
          resultForModel: `Presentación creada: presentacion-calili.pptx con portada y ${slides.length} diapositivas. Ya se le mostró al usuario su tarjeta de descarga. Confírmalo en una frase breve.`,
          file: { name: 'presentacion-calili.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', base64: buffer.toString('base64') },
        };
      }
      case 'clonar_imagen': {
        const image = context?.images?.[0];
        if (!image) {
          return { resultForModel: 'Para clonar necesito que el usuario adjunte la imagen en este mensaje. Pídesela en una frase.' };
        }
        if (args.modo !== 'variacion') {
          // Clon EXACTO: el archivo viaja tal cual, sin motor de IA.
          // Es la única vía con fidelidad del 100%.
          const parsed = parseImageDataUrl(image);
          if (!parsed) return { resultForModel: 'La imagen adjunta no se pudo leer para clonarla.' };
          const ext = imageExt(parsed.mime);
          return {
            resultForModel: `Imagen clonada EXACTA (copia idéntica del archivo original, píxel a píxel): clon-calili.${ext}. Ya se le mostró al usuario con vista previa y descarga. Confírmalo en una frase breve.`,
            file: { name: `clon-calili.${ext}`, mime: parsed.mime, base64: parsed.buffer.toString('base64') },
          };
        }
        const cambios = String(args.cambios ?? '').trim();
        const result = await createImage(
          {
            prompt: cambios
              ? `Faithful clone of the attached image with these changes only: ${cambios}. Keep everything else exactly the same: identical composition, subject, colors, style, lighting and every text verbatim.`
              : 'Faithful clone of the attached image: identical composition, subject, colors, style, lighting and every text verbatim. Recreate it as closely as possible to the original.',
            usar_adjunta: true,
          },
          image,
        );
        return {
          resultForModel: `Variante clonada creada: ${result.file.name}. Es una recreación fiel generada a partir de la original (no una copia píxel a píxel); ya se le mostró al usuario con vista previa y descarga. ${result.note ?? ''} Confírmalo en una frase breve y honesta.`,
          file: result.file,
        };
      }
      case 'transformar_imagen': {
        const image = context?.images?.[0];
        if (!image) {
          return { resultForModel: 'Para transformar necesito que el usuario adjunte la imagen en este mensaje. Pídesela en una frase.' };
        }
        const parsed = parseImageDataUrl(image);
        if (!parsed) return { resultForModel: 'La imagen adjunta no se pudo leer para transformarla.' };
        const sharp = (await import('sharp')).default;
        let pipeline = sharp(parsed.buffer);
        const rotar = typeof args.rotar === 'number' ? args.rotar : 0;
        if ([90, 180, 270].includes(rotar)) pipeline = pipeline.rotate(rotar);
        const ancho = typeof args.ancho === 'number' && Number.isFinite(args.ancho) ? Math.min(8000, Math.max(16, Math.round(args.ancho))) : undefined;
        const alto = typeof args.alto === 'number' && Number.isFinite(args.alto) ? Math.min(8000, Math.max(16, Math.round(args.alto))) : undefined;
        if (ancho || alto) pipeline = pipeline.resize({ width: ancho, height: alto, fit: 'inside', withoutEnlargement: false });
        const formato = args.formato === 'jpg' || args.formato === 'webp' || args.formato === 'png'
          ? args.formato
          : imageExt(parsed.mime);
        const out = formato === 'jpg'
          ? await pipeline.jpeg({ quality: 92 }).toBuffer()
          : formato === 'webp'
            ? await pipeline.webp({ quality: 92 }).toBuffer()
            : await pipeline.png().toBuffer();
        const meta = await sharp(out).metadata();
        const mime = formato === 'jpg' ? 'image/jpeg' : formato === 'webp' ? 'image/webp' : 'image/png';
        return {
          resultForModel: `Imagen transformada de forma exacta (sin IA): imagen-transformada.${formato}, ${meta.width}x${meta.height}px. Ya se le mostró al usuario con vista previa y descarga. Confírmalo en una frase breve.`,
          file: { name: `imagen-transformada.${formato}`, mime, base64: out.toString('base64') },
        };
      }
      case 'ampliar_imagen': {
        const image = context?.images?.[0];
        if (!image) {
          return { resultForModel: 'Para ampliar necesito que el usuario adjunte la imagen en este mensaje. Pídesela en una frase.' };
        }
        const parsed = parseImageDataUrl(image);
        if (!parsed) return { resultForModel: 'La imagen adjunta no se pudo leer para ampliarla.' };
        const sharp = (await import('sharp')).default;
        const metaIn = await sharp(parsed.buffer).metadata();
        if (!metaIn.width) return { resultForModel: 'No se pudo leer el tamaño de la imagen adjunta.' };
        let targetWidth: number;
        if (typeof args.ancho_objetivo === 'number' && Number.isFinite(args.ancho_objetivo)) {
          targetWidth = Math.min(8000, Math.max(metaIn.width + 1, Math.round(args.ancho_objetivo)));
        } else {
          const factor = typeof args.factor === 'number' && Number.isFinite(args.factor)
            ? Math.min(4, Math.max(1.5, args.factor))
            : 2;
          targetWidth = Math.min(8000, Math.round(metaIn.width * factor));
        }
        const formato = imageExt(parsed.mime);
        let pipeline = sharp(parsed.buffer).resize({ width: targetWidth, kernel: 'lanczos3' });
        const out = formato === 'jpg'
          ? await pipeline.jpeg({ quality: 92 }).toBuffer()
          : formato === 'webp'
            ? await pipeline.webp({ quality: 92 }).toBuffer()
            : await pipeline.png().toBuffer();
        const meta = await sharp(out).metadata();
        const mime = formato === 'jpg' ? 'image/jpeg' : formato === 'webp' ? 'image/webp' : 'image/png';
        return {
          resultForModel: `Imagen ampliada (sin IA, interpolación de máxima calidad): de ${metaIn.width}x${metaIn.height} a ${meta.width}x${meta.height}px. Ya se le mostró al usuario con vista previa y descarga. Confírmalo en una frase breve, sin prometer detalle nuevo: ampliar no inventa detalle.`,
          file: { name: `imagen-ampliada.${formato}`, mime, base64: out.toString('base64') },
        };
      }
      case 'extraer_texto': {
        const image = context?.images?.[0];
        if (!image) {
          return { resultForModel: 'Para extraer el texto necesito que el usuario adjunte la imagen en este mensaje. Pídesela en una frase.' };
        }
        const { streamVisionChat } = await import('@/lib/nexus-gateway');
        const messages = [
          { role: 'system', content: 'Eres un OCR exacto. Transcribes SOLO el texto visible, sin comentarios ni explicaciones.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe literalmente TODO el texto visible en esta imagen, en su orden de lectura, conservando mayúsculas y líneas. Si no hay texto legible, responde exactamente: SIN TEXTO LEGIBLE.' },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ];
        let text = '';
        for await (const chunk of streamVisionChat(messages)) text += chunk;
        const clean = text.trim();
        if (!clean) return { resultForModel: 'La visión no devolvió texto de la imagen. Dilo en una frase.' };
        return { resultForModel: `Texto extraído de la imagen (transcripción literal; entrégalo al usuario tal cual, en un bloque de cita o código, sin corregirlo ni resumirlo):\n\n${clean.slice(0, 8000)}` };
      }
      case 'narrar_texto': {
        const texto = String(args.texto ?? '').trim();
        if (!texto) return { resultForModel: 'No llegó el texto a narrar.' };
        const { synthesizeNarration } = await import('@/lib/tts');
        const narration = await synthesizeNarration(texto);
        return {
          resultForModel: 'Narración creada en MP3: ya se le mostró al usuario con reproductor y botón de descarga. Confírmalo en una frase breve.',
          file: { name: 'narracion-calili.mp3', mime: narration.mime, base64: narration.base64 },
        };
      }
      default:
        return { resultForModel: `Herramienta desconocida: ${name}` };
    }
  } catch (error) {
    // El error real NUNCA debe perderse: va al registro del servidor
    // (Vercel Runtime Logs) antes de convertirse en texto para el modelo.
    // Sin esta línea, un fallo de Veo/Google se volvía una disculpa
    // genérica y la causa era invisible (pasó el 2026-11-24).
    console.error(`Calili: herramienta ${name} falló`, error);
    return {
      resultForModel: `La herramienta ${name} falló: ${error instanceof Error ? error.message : 'error desconocido'}. Explícaselo al usuario en una frase.`,
    };
  }
}
