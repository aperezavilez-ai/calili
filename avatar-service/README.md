# Servicio de avatar de Calili (LongCat-Video-Avatar 1.5)

Corre en una máquina con GPU (RunPod, la tuya si algún día tiene 24 GB+).
Calili (en Vercel) le manda foto + narración y recibe el MP4 con los labios
sincronizados y, si se pidió, la música mezclada bajo la voz.

## Requisitos
- GPU NVIDIA de 24 GB de VRAM (RTX 4090) con `--use_int8` (default), CUDA 12.4.
- Python 3.10 (conda), ffmpeg + ffprobe en el PATH.
- Pesos HERMANOS en la misma carpeta `weights/`:
  `weights/LongCat-Video` (base: tokenizer, text_encoder, vae) y
  `weights/LongCat-Video-Avatar-1.5` (base_model_int8, scheduler,
  whisper-large-v3, vocal_separator y la LoRA de destilación en `lora/`).

## Puesta en marcha (resumen; la secuencia exacta la entrega Lu)
1. Clona `meituan-longcat/LongCat-Video` y crea el entorno conda del repo
   (torch 2.6.0+cu124, flash_attn, requirements + requirements_avatar).
2. Descarga AMBOS pesos con huggingface-cli a `weights/`.
3. En esta carpeta: `pip install -r requirements.txt`.
4. Arranca:
   `LONGCAT_DIR=/ruta/LongCat-Video AVATAR_CKPT=/ruta/weights/LongCat-Video-Avatar-1.5 AVATAR_SERVICE_TOKEN=<secreto> uvicorn main:app --host 0.0.0.0 --port 8300`
5. Expón el puerto 8300 (en RunPod sale una URL https://<pod>-8300.proxy.runpod.net)
   y pon en Vercel: `AVATAR_SERVICE_URL=<esa URL>` y el mismo token.
6. Comprueba `GET /health` → ok con longcat_dir y avatar_ckpt en true.

Notas honestas: la primera generación compila y tarda más; cada segmento
son ~3,2-3,7 s de voz y el tope son 12 segmentos (~42 s). Calili espera
como máximo ~280 s por la ruta, así que los guiones deben ser cortos
(10-20 s) mientras no exista la versión asíncrona del servicio.
Estado: construido por Lu contra la interfaz real del demo; su juicio es
en vivo en el pod.
