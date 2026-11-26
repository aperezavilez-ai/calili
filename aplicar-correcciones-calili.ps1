# ============================================================
# CALILI - Aplicar correcciones (version robusta)
# Ejecutar desde: D:\PROGRAMAS IA\CALILI
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\aplicar-correcciones-calili.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CALILI - Aplicando correcciones" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Carpeta: $Root"
Write-Host ""

if (-not (Test-Path (Join-Path $Root "package.json"))) {
    Write-Host "ERROR: No se encontro package.json. Ejecuta este script desde la raiz de Calili." -ForegroundColor Red
    exit 1
}

# --- ZIP embebido (Base64) ---
$ZipB64 = @"
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
"@

Write-Host "[1/5] Decodificando correcciones..." -ForegroundColor Green
$zipBytes = [Convert]::FromBase64String(($ZipB64 -replace "\s",""))
$zipPath = Join-Path $env:TEMP "calili-fix.zip"
[System.IO.File]::WriteAllBytes($zipPath, $zipBytes)

$extractPath = Join-Path $env:TEMP "calili-fix-extract"
if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
New-Item -ItemType Directory -Path $extractPath -Force | Out-Null

Write-Host "[2/5] Extrayendo archivos..." -ForegroundColor Green
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractPath)

Write-Host "[3/5] Eliminando archivos obsoletos..." -ForegroundColor Green
$obsolete = @(
    "APLICAR-SQL-AHORA.sql",
    "APLICAR-SQL-URGENTE.txt",
    "RECONSTRUCCION.md",
    "GENERAR-ICONOS.md",
    "supabase\migrations\001_initial_schema.sql",
    "supabase\migrations\002_fase2_public_schema.sql",
    "supabase\migrations\003_memoria_largo_plazo.sql"
)
foreach ($f in $obsolete) {
    $p = Join-Path $Root $f
    if (Test-Path $p) {
        Remove-Item $p -Force
        Write-Host "  - Eliminado: $f" -ForegroundColor DarkYellow
    }
}

Write-Host "[4/5] Copiando archivos corregidos..." -ForegroundColor Green
Get-ChildItem -Path $extractPath -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($extractPath.Length).TrimStart("\", "/")
    $dest = Join-Path $Root $rel
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item $_.FullName $dest -Force
    Write-Host "  + $rel"
}

# Añadir script format a package.json si falta
Write-Host "[5/5] Actualizando package.json..." -ForegroundColor Green
$pkgPath = Join-Path $Root "package.json"
try {
    $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not ($pkg.scripts.PSObject.Properties.Name -contains "format")) {
        $pkg.scripts | Add-Member -NotePropertyName "format" -NotePropertyValue 'prettier --write "src/**/*.{ts,tsx,js,jsx,json,css,md}"' -Force
        $pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8
        Write-Host "  + package.json (script format)"
    } else {
        Write-Host "  = package.json ya tenia format"
    }
} catch {
    Write-Host "  ! No se pudo actualizar package.json: $_" -ForegroundColor Yellow
}

# Limpieza temporal
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Correcciones aplicadas con exito" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "SIGUIENTE PASO OBLIGATORIO:" -ForegroundColor Yellow
Write-Host "  1. Abre Supabase -> SQL Editor" -ForegroundColor White
Write-Host "  2. Abre el archivo:" -ForegroundColor White
Write-Host "     supabase\migrations\001_schema.sql" -ForegroundColor Cyan
Write-Host "  3. Copia TODO y ejecuta (Run)" -ForegroundColor White
Write-Host ""
Write-Host "Luego:" -ForegroundColor White
Write-Host "  npm install" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host ""
