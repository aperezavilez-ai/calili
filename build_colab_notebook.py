import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
main_py = open(os.path.join(BASE, 'avatar-service', 'main.py'), encoding='utf-8').read()

def md(src):
    return {"cell_type": "markdown", "metadata": {}, "source": src.splitlines(keepends=True)}

def code(src):
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
            "source": src.splitlines(keepends=True)}

cells = []

cells.append(md("""# Calili — Servicio de avatar en Colab (LongCat-Video-Avatar 1.5)

Ejecuta las celdas **en orden**, con el botón de play de cada una. No cierres esta pestaña mientras uses el avatar en Calili: el servicio vive dentro de esta sesión de Colab.

Antes de empezar: el entorno debe ser **GPU G4, A100 o L4** (Entorno de ejecución → Cambiar tipo de entorno de ejecución)."""))

cells.append(code("""# 1) Verificar la GPU
!nvidia-smi
import torch
vram = torch.cuda.get_device_properties(0).total_memory / 1e9 if torch.cuda.is_available() else 0
print(f"VRAM detectada: {vram:.0f} GB")
assert vram >= 23, "GPU insuficiente: se necesitan 24 GB o mas (elige G4, A100 o L4)\""""))

cells.append(code("""# 2) Clonar LongCat-Video e instalar dependencias (tarda varios minutos)
import os
if not os.path.exists('/content/LongCat-Video'):
    !git clone https://github.com/meituan-longcat/LongCat-Video.git /content/LongCat-Video
%cd /content/LongCat-Video
!pip install -q -r requirements.txt
!pip install -q -r requirements_avatar.txt
!pip install -q fastapi uvicorn pydantic "huggingface_hub[cli]"
!apt-get install -y -q ffmpeg > /dev/null 2>&1 || true
import torch
print('torch', torch.__version__, '| cuda disponible:', torch.cuda.is_available())"""))

cells.append(code("""# 3) flash-attn (aceleracion). Si falla rapido, sigue: ajustamos la configuracion despues.
!pip install -q flash-attn==2.7.4.post1 --only-binary=:all:
import flash_attn
print('flash-attn OK', flash_attn.__version__)"""))

cells.append(code("""# 4) Descargar los pesos (~60 GB, solo la primera vez en cada sesion)
import os
os.makedirs('/content/weights', exist_ok=True)
# Si ya respaldaste los pesos en Drive (celda opcional del final), descomenta estas 2 lineas y comenta las descargas:
# from google.colab import drive; drive.mount('/content/drive')
# !cp -r /content/drive/MyDrive/LongCat-weights/* /content/weights/
if not os.path.exists('/content/weights/LongCat-Video-Avatar-1.5'):
    !hf download meituan-longcat/LongCat-Video-Avatar-1.5 --local-dir /content/weights/LongCat-Video-Avatar-1.5 || huggingface-cli download meituan-longcat/LongCat-Video-Avatar-1.5 --local-dir /content/weights/LongCat-Video-Avatar-1.5
if not os.path.exists('/content/weights/LongCat-Video'):
    !hf download meituan-longcat/LongCat-Video --local-dir /content/weights/LongCat-Video || huggingface-cli download meituan-longcat/LongCat-Video --local-dir /content/weights/LongCat-Video
!du -sh /content/weights/*
print('Pesos listos: la carpeta base y la del avatar quedan hermanas, como exige el modelo.')"""))

cells.append(code("""# 5) Tu token del servicio (lo inventas tu; el mismo va en Vercel, no lo compartas)
import os, getpass
os.makedirs('/content/avatar-service', exist_ok=True)
TOKEN = getpass.getpass('Inventa el token del servicio: ')
print('Token guardado en la sesion (no se muestra).')"""))

writefile_src = "%%writefile /content/avatar-service/main.py\n" + main_py
cells.append(code(writefile_src))

cells.append(code("""# 6) Arrancar el servicio y abrir su URL publica
import subprocess, time, os, re, urllib.request
import torch
vram = torch.cuda.get_device_properties(0).total_memory / 1e9
env = dict(os.environ)
env.update({
    'LONGCAT_DIR': '/content/LongCat-Video',
    'AVATAR_CKPT': '/content/weights/LongCat-Video-Avatar-1.5',
    'AVATAR_SERVICE_TOKEN': TOKEN,
    'AVATAR_USE_INT8': '0' if vram >= 48 else '1',
    'AVATAR_RESOLUTION': '480p',
})
log = open('/content/avatar-service.log', 'w')
proc = subprocess.Popen(['python', '-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8300'],
                        cwd='/content/avatar-service', env=env, stdout=log, stderr=subprocess.STDOUT)
ok = False
for i in range(30):
    time.sleep(2)
    try:
        print(urllib.request.urlopen('http://localhost:8300/health', timeout=3).read().decode())
        ok = True
        break
    except Exception:
        pass
if not ok:
    print('El servicio no respondio. Revisa el archivo /content/avatar-service.log y pegame su salida.')
if not os.path.exists('/usr/local/bin/cloudflared'):
    subprocess.run('wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared', shell=True)
tlog = open('/content/tunnel.log', 'w')
tproc = subprocess.Popen(['cloudflared', 'tunnel', '--url', 'http://localhost:8300'], stdout=tlog, stderr=subprocess.STDOUT)
url = None
for i in range(30):
    time.sleep(2)
    m = re.search(r'https://[a-z0-9-]+\\.trycloudflare\\.com', open('/content/tunnel.log').read())
    if m:
        url = m.group(0)
        break
print()
print('=== AVATAR_SERVICE_URL para Vercel ===')
print(url)
print('=== AVATAR_SERVICE_TOKEN = el token que escribiste en la celda 5 ===')"""))

cells.append(code("""# 7) OPCIONAL, una sola vez: respalda los pesos en tu Drive para no descargarlos en cada sesion
from google.colab import drive
drive.mount('/content/drive')
!mkdir -p /content/drive/MyDrive/LongCat-weights
!cp -r /content/weights/LongCat-Video /content/weights/LongCat-Video-Avatar-1.5 /content/drive/MyDrive/LongCat-weights/
print('Respaldo terminado.')"""))

cells.append(md("""## Notas

- Mientras esta sesión viva, Calili puede crear videos hablados: sube una foto y pide el video con un guion **corto (10–20 segundos de voz)**.
- Cada sesión nueva de Colab genera una **URL nueva**: hay que actualizar `AVATAR_SERVICE_URL` en Vercel con la URL que imprima la celda 6.
- La sesión consume unidades de cómputo mientras está conectada: al terminar, **Entorno de ejecución → Desconectar y eliminar el entorno de ejecución**.
- Si alguna celda falla, pega su salida tal cual en el chat de Calili con Lu."""))

nb = {
    "nbformat": 4,
    "nbformat_minor": 0,
    "metadata": {
        "colab": {"provenance": []},
        "kernelspec": {"name": "python3", "display_name": "Python 3"},
        "language_info": {"name": "python"},
        "accelerator": "GPU",
    },
    "cells": cells,
}

out = os.path.join(BASE, 'colab', 'Calili-Avatar-Colab.ipynb')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as fh:
    json.dump(nb, fh, ensure_ascii=False, indent=1)
print('Notebook escrito:', out, os.path.getsize(out), 'bytes,', len(cells), 'celdas')
