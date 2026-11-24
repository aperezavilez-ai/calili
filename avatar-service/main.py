"""
Servicio de avatar de Calili (corre en TU maquina con GPU, no en Vercel).

Recibe la foto de una persona + la narracion (MP3) que Calili ya sintetizo
(+ musica de fondo opcional) y devuelve el MP4 final: la persona hablando
con los labios sincronizados (LongCat-Video-Avatar) y la mezcla de audio
hecha con ffmpeg.

Variables de entorno:
  AVATAR_SERVICE_TOKEN   bearer compartido con Calili (opcional pero recomendado)
  LONGCAT_AVATAR_CMD     plantilla del comando del demo oficial de LongCat,
                         con {image}, {audio} y {out}; se ajusta en la
                         maquina segun los flags reales del script.
  AVATAR_WORKDIR         carpeta temporal de trabajo (default: ./work)
"""
import base64
import os
import subprocess
import tempfile
import uuid

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Calili Avatar Service")

TOKEN = os.environ.get("AVATAR_SERVICE_TOKEN", "")
CMD_TEMPLATE = os.environ.get("LONGCAT_AVATAR_CMD", "")
WORKDIR = os.environ.get("AVATAR_WORKDIR", os.path.join(os.path.dirname(__file__), "work"))
os.makedirs(WORKDIR, exist_ok=True)


class TalkingVideoRequest(BaseModel):
    imageDataUrl: str
    audioBase64: str
    audioMime: str = "audio/mpeg"
    musicBase64: str | None = None
    musicMime: str | None = None


def check_token(authorization: str | None) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="token invalido")


def run(cmd: list[str], timeout: int = 1500) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=(proc.stderr or proc.stdout)[-800:])


def write_b64(path: str, data: str) -> None:
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(data))


@app.get("/health")
def health() -> dict:
    return {"ok": True, "cmd_configured": bool(CMD_TEMPLATE)}


@app.post("/talking-video")
def talking_video(req: TalkingVideoRequest, authorization: str | None = Header(default=None)) -> dict:
    check_token(authorization)
    if not CMD_TEMPLATE:
        raise HTTPException(status_code=503, detail="LONGCAT_AVATAR_CMD no configurado en el servicio")

    job = os.path.join(WORKDIR, uuid.uuid4().hex)
    os.makedirs(job)
    image_path = os.path.join(job, "photo.png")
    audio_path = os.path.join(job, "voice.mp3")
    avatar_out = os.path.join(job, "avatar.mp4")
    write_b64(image_path, req.imageDataUrl)
    write_b64(audio_path, req.audioBase64)

    cmd = CMD_TEMPLATE.format(image=image_path, audio=audio_path, out=avatar_out)
    run(cmd.split())
    if not os.path.exists(avatar_out):
        raise HTTPException(status_code=500, detail="el motor de avatar no produjo video")

    final_out = avatar_out
    if req.musicBase64:
        music_path = os.path.join(job, "music.mp3")
        mixed_out = os.path.join(job, "final.mp4")
        write_b64(music_path, req.musicBase64)
        # La voz manda: la musica entra baja (0.18) y se recorta al largo del video.
        run([
            "ffmpeg", "-y", "-i", avatar_out, "-i", music_path,
            "-filter_complex",
            "[1:a]volume=0.18[mus];[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0[aout]",
            "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-shortest", mixed_out,
        ], timeout=300)
        final_out = mixed_out

    with open(final_out, "rb") as fh:
        return {"base64": base64.b64encode(fh.read()).decode(), "mime": "video/mp4"}
