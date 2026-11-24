# Servicio de avatar de Calili (LongCat-Video-Avatar)

Corre en una máquina con GPU (la tuya o una rentada). Calili (en Vercel) le
manda foto + narración y recibe el MP4 con labios sincronizados.

## Requisitos
- GPU NVIDIA con 24 GB de VRAM o más (recomendado), drivers + CUDA 12.4.
- Python 3.10, ffmpeg instalado (`ffmpeg -version` debe responder).
- El repo oficial `meituan-longcat/LongCat-Video` clonado y sus pesos
  `LongCat-Video-Avatar-1.5` descargados (usa Whisper-large y genera en
  8 pasos: es la variante rápida).

## Puesta en marcha
1. Sigue la instalación del repo de LongCat-Video (conda + torch cu124 +
   flash-attn) y descarga los pesos del Avatar 1.5.
2. En ESTA carpeta: `pip install -r requirements.txt`.
3. Define el comando del demo oficial según los flags reales del script
   `run_demo_avatar_single_audio_to_video.py` de tu clon, por ejemplo:
   `LONGCAT_AVATAR_CMD="python /ruta/LongCat-Video/run_demo_avatar_single_audio_to_video.py --image {image} --audio {audio} --out {out}"`
   (ajusta nombres de flags a los del script; la plantilla solo sustituye
   {image}, {audio} y {out}).
4. Arranca: `AVATAR_SERVICE_TOKEN=<un-secreto> uvicorn main:app --host 0.0.0.0 --port 8300`
5. Expón el puerto hacia internet con una URL estable (Tailscale Funnel o
   Cloudflare Tunnel) y pon en Vercel/.env.local de Calili:
   `AVATAR_SERVICE_URL=https://tu-url` y el mismo `AVATAR_SERVICE_TOKEN`.
6. Comprueba `GET /health` → `{"ok": true, "cmd_configured": true}`.

Estado: esqueleto construido por Lu; su juicio es en vivo en la máquina GPU.
