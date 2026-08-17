#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

async function setup() {
  console.log('\n🤖 CALILI - Setup Automático\n');
  console.log('Este script configurará Calili completamente.\n');

  // 1. Supabase
  console.log('📦 1. SUPABASE:');
  console.log('   Ve a: https://supabase.com');
  console.log('   Crea proyecto → Copia credenciales\n');

  const supabaseUrl = await question('   NEXT_PUBLIC_SUPABASE_URL: ');
  const supabaseKey = await question('   NEXT_PUBLIC_SUPABASE_ANON_KEY: ');

  // 2. GPT API
  console.log('\n🔑 2. API GPT:');
  console.log('   OpenAI: https://platform.openai.com/api-keys');
  console.log('   O tu proveedor alternativo\n');

  const gptUrl = await question('   GPT_API_URL [https://api.openai.com/v1/chat/completions]: ') || 'https://api.openai.com/v1/chat/completions';
  const gptKey = await question('   GPT_API_KEY: ');

  rl.close();

  // 3. Crear .env
  console.log('\n📝 3. Creando archivo .env...');
  const envContent = `# Supabase
NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${supabaseKey}

# API GPT
GPT_API_URL=${gptUrl}
GPT_API_KEY=${gptKey}

# App
NEXT_PUBLIC_APP_NAME=Calili
NEXT_PUBLIC_APP_SHORT_NAME=Calili
NEXT_PUBLIC_APP_DESCRIPTION=Tu asistente AI personal
NEXT_PUBLIC_APP_URL=http://localhost:3000
`;

  fs.writeFileSync('.env', envContent);
  console.log('   ✅ .env creado');

  // 4. Aplicar migración SQL
  console.log('\n🗄️  4. Aplicando migración SQL en Supabase...');
  console.log('   Abriendo SQL en navegador...');

  const sqlPath = './supabase/migrations/001_initial_schema.sql';
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  // Copiar SQL al portapapeles
  const platform = process.platform;
  if (platform === 'win32') {
    execSync(`echo ${sqlContent} | clip`, { stdio: 'inherit' });
    console.log('   ✅ SQL copiado al portapapeles');
  }

  // Abrir Supabase SQL Editor
  const supabaseProject = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (supabaseProject) {
    const sqlEditorUrl = `https://supabase.com/dashboard/project/${supabaseProject}/sql/new`;
    execSync(`start ${sqlEditorUrl}`, { stdio: 'inherit' });
    console.log('   📂 Abriendo SQL Editor...');
    console.log('   ⚠️  Pega el SQL (Ctrl+V) y ejecuta (RUN)');
  }

  // 5. Generar iconos placeholder
  console.log('\n🎨 5. Generando iconos PWA...');

  const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
  const publicDir = './public';

  // Crear SVG simple como placeholder
  const svgIcon = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#8B5CF6;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#EC4899;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#grad)" rx="80"/>
    <text x="256" y="340" font-family="Arial, sans-serif" font-size="300" font-weight="bold" fill="white" text-anchor="middle">C</text>
  </svg>`;

  // Guardar SVG
  fs.writeFileSync(`${publicDir}/icon.svg`, svgIcon);
  console.log('   ✅ Icono SVG generado');

  // Nota: Para PNGs reales necesitas ImageMagick o Sharp
  console.log('   ⚠️  Iconos PNG: Instala ImageMagick o genera manualmente');

  // 6. Iniciar servidor
  console.log('\n🚀 6. Iniciando servidor de desarrollo...');
  console.log('   Ejecuta: npm run dev');
  console.log('   Abre: http://localhost:3000\n');

  console.log('✅ SETUP COMPLETADO\n');
  console.log('Próximos pasos:');
  console.log('1. Ejecuta la migración SQL en Supabase SQL Editor');
  console.log('2. npm run dev');
  console.log('3. Abre http://localhost:3000\n');
}

setup().catch(console.error);
