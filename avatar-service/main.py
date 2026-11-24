"""
Servicio de avatar de Calili (corre en la maquina con GPU, no en Vercel).

Recibe la foto de una persona + la narracion (MP3) que Calili ya sintetizo
(+ musica de fondo opcional) y devuelve el MP4 final: la persona hablando
con los labios sincronizados (LongCat-Video-Avatar 1.5) y la mezcla de
audio hecha con ffmpeg.

Interfaz real del demo oficial (verificada en su codigo): se invoca con
torchrun y un input.json {prompt, cond_image, cond_audio:{person1}}; los
pesos base LongCat-Video deben ser HERMANOS de la carpeta del avatar
(checkpoint_dir/../LongCat-Video). Cada segmento cubre ~3,7 s de voz y
cada segmento extra ~3,2 s; el numero de segmentos se calcula del audio.

Variables de entorno:
  AVATAR_SERVICE_TOKEN   bearer compartido con Calili (recomendado)
  LONGCAT_DIR            ruta del clon de LongCat-Video
  AVATAR_CKPT            ruta de los pesos LongCat-Video-Avatar-1.5
  AVATAR_RESOLUTION      480p (default) o 720p
  AVATAR_USE_INT8        1 (default en GPUs de 24 GB) o 0
  AVATAR_PROMPT          prompt de escena para el avatar
"""
import base64
import glob
import json
import math
import os
import subprocess
import uuid

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Calili Avatar Service")

TOKEN = os.environ.get("AVATAR_SERVICE_TOKEN", "")
LONGCAT_DIR = os.environ.get("LONGCAT_DIR", "")
AVATAR_CKPT = os.environ.get("AVATAR_CKPT", "")
RESOLUTION = os.environ.get("AVATAR_RESOLUTION", "480p")
USE_INT8 = os.environ.get("AVATAR_USE_INT8", "1") == "1"
DEFAULT_PROMPT = os.environ.get(
    "AVATAR_PROMPT",
    "A person is speaking naturally to the camera, friendly expression, "
    "subtle head movements, realistic lighting, static background.",
)
WORKDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work")
os.makedirs(WORKDIR, exist_ok=True)

SEG_FIRST_SECONDS = 93 / 25      # v1.5: 93 frames a 25 fps
SEG_EXTRA_SECONDS = (93 - 13) / 25
MAX_SEGMENTS = 12                # ~42 s de voz como tope por clip


class TalkingVideoRequest(BaseModel):
    imageDataUrl: str
    audioBase64: str
    audioMime: str = "audio/mpeg"
    musicBase64: str | None = None
    musicMime: str | None = None
    prompt: str | None = None


def check_token(authorization: str | None) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="token invalido")


def run(cmd: list[str], timeout: int = 1500, cwd: str | None = None) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=(proc.stderr or proc.stdout)[-800:])


def write_b64(path: str, data: str) -> None:
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(data))


def audio_duration(path: str) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, timeout=60,
    )
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return SEG_FIRST_SECONDS


def segments_for(duration: float) -> int:
    if duration <= SEG_FIRST_SECONDS:
        return 1
    extra = math.ceil((duration - SEG_FIRST_SECONDS) / SEG_EXTRA_SECONDS)
    return min(1 + extra, MAX_SEGMENTS)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "longcat_dir": bool(LONGCAT_DIR),
        "avatar_ckpt": bool(AVATAR_CKPT),
        "int8": USE_INT8,
        "resolution": RESOLUTION,
    }


@app.post("/talking-video")
def talking_video(req: TalkingVideoRequest, authorization: str | None = Header(default=None)) -> dict:
    check_token(authorization)
    if not LONGCAT_DIR or not AVATAR_CKPT:
        raise HTTPException(status_code=503, detail="LONGCAT_DIR / AVATAR_CKPT no configurados")

    job = os.path.join(WORKDIR, uuid.uuid4().hex)
    os.makedirs(job)
    image_path = os.path.join(job, "photo.png")
    audio_path = os.path.join(job, "voice.mp3")
    out_dir = os.path.join(job, "out")
    os.makedirs(out_dir)
    write_b64(image_path, req.imageDataUrl)
    write_b64(audio_path, req.audioBase64)

    segments = segments_for(audio_duration(audio_path))
    input_json = os.path.join(job, "input.json")
    with open(input_json, "w", encoding="utf-8") as fh:
        json.dump({
            "prompt": req.prompt or DEFAULT_PROMPT,
            "cond_image": image_path,
            "cond_audio": {"person1": audio_path},
        }, fh)

    cmd = [
        "torchrun", "--nproc_per_node=1",
        "run_demo_avatar_single_audio_to_video.py",
        "--checkpoint_dir", AVATAR_CKPT,
        "--input_json", input_json,
        "--output_dir", out_dir,
        "--model_type", "avatar-v1.5",
        "--stage_1", "ai2v",
        "--resolution", RESOLUTION,
        "--use_distill",
        "--num_segments", str(segments),
    ]
    if USE_INT8:
        cmd.append("--use_int8")
    run(cmd, cwd=LONGCAT_DIR)

    produced = sorted(glob.glob(os.path.join(out_dir, "*.mp4")), key=os.path.getmtime)
    if not produced:
        raise HTTPException(status_code=500, detail="el motor de avatar no produjo video")
    final_out = produced[-1]

    if req.musicBase64:
        music_path = os.path.join(job, "music.mp3")
        mixed_out = os.path.join(job, "final.mp4")
        write_b64(music_path, req.musicBase64)
        # La voz manda: la musica entra baja (0.18) y se recorta al largo del video.
        run([
            "ffmpeg", "-y", "-i", final_out, "-i", music_path,
            "-filter_complex",
            "[1:a]volume=0.18[mus];[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0[aout]",
            "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-shortest", mixed_out,
        ], timeout=300)
        final_out = mixed_out

    with open(final_out, "rb") as fh:
        return {"base64": base64.b64encode(fh.read()).decode(), "mime": "video/mp4"}
