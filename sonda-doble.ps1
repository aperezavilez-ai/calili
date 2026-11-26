# SONDA DE REPLICACION: el encargo DUPLICADO (dos turnos user seguidos).
# La app manda prompt_tokens=28; la sonda limpia manda 17. La diferencia
# (~11 tok) es casi exactamente el encargo repetido. Si esta sonda
# reproduce el texto exacto "- [] - []" (54 caracteres), el mecanismo
# queda probado: la app esta incluyendo el mensaje actual TAMBIEN en
# el historial, y el modelo recibe "Usuario: X / Usuario: X", un
# formato que nunca vio en su entrenamiento.
$ErrorActionPreference = 'Stop'
$base = 'D:\PROGRAMAS IA\EDITCORE-MODEL'
$port = 11437
$url = "http://127.0.0.1:$port"
$py = Join-Path $base '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }
$logOut = Join-Path $env:TEMP 'nexus-doble-out.txt'
$logErr = Join-Path $env:TEMP 'nexus-doble-err.txt'

$p = Start-Process -FilePath $py -PassThru -WindowStyle Hidden `
  -ArgumentList @('inference\serve.py','--ckpt','checkpoints\base-sft-v5\epoch-2','--port',"$port") `
  -WorkingDirectory $base -RedirectStandardOutput $logOut -RedirectStandardError $logErr
try {
  $vivo = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try { $h = Invoke-RestMethod "$url/health" -TimeoutSec 3; if ($h.ok) { $vivo = $true; break } } catch {}
  }
  if (-not $vivo) { Write-Host 'EL SERVIDOR NO ARRANCO'; Get-Content $logErr -Tail 20; exit 1 }
  Write-Host ("SERVIDOR OK pid={0} ckpt={1}" -f $h.pid, $h.checkpoint)

  $sys = 'Eres EditCore Nexus, el agente de EditCoreAI.'
  $encargo = 'lista los archivos de la ra' + [char]0x00ED + 'z del proyecto'
  $toolDef = @{ type='function'; function=@{ name='list_files'; description='Lista archivos y carpetas de una ruta del proyecto.'; parameters=@{ type='object'; properties=@{ path=@{ type='string' } } } } }

  # CONTROL: el encargo una sola vez (debe dar 17 tok y el bloque)
  $bodySimple = @{ model='editcore-nexus'; temperature=0.1; stream=$false; max_tokens=256; tools=@($toolDef)
    messages=@( @{role='system';content=$sys}, @{role='user';content=$encargo} ) } | ConvertTo-Json -Depth 8 -Compress
  $r1 = Invoke-RestMethod "$url/v1/chat/completions" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($bodySimple)) -TimeoutSec 180
  Write-Host '--- CONTROL (una vez) ---'
  Write-Host $r1.choices[0].message.content

  # REPLICA: el encargo DOS veces, como llegaria si el historial lo incluye
  $bodyDoble = @{ model='editcore-nexus'; temperature=0.1; stream=$false; max_tokens=256; tools=@($toolDef)
    messages=@( @{role='system';content=$sys}, @{role='user';content=$encargo}, @{role='user';content=$encargo} ) } | ConvertTo-Json -Depth 8 -Compress
  $r2 = Invoke-RestMethod "$url/v1/chat/completions" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyDoble)) -TimeoutSec 180
  Write-Host '--- REPLICA (duplicado) ---'
  Write-Host $r2.choices[0].message.content

  Write-Host '--- LINEAS DEL SERVIDOR (prompt_tokens de cada llamada) ---'
  Get-Content $logOut -Tail 4
} finally {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Write-Host 'SERVIDOR DE SONDA APAGADO'
}
