"""Local-only API for the browser music player."""

from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles

from beat_analysis import analyze_audio


ROOT = Path(__file__).parent
WEB_DIR = ROOT / "web"
MAX_UPLOAD_BYTES = 250 * 1024 * 1024

app = FastAPI(title="Local Player Beat API", docs_url=None, redoc_url=None)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/beats")
async def analyze_beats(file: UploadFile = File(...)):
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio files must be 250 MB or smaller.")
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")
    try:
        return await run_in_threadpool(analyze_audio, data, file.filename or "audio")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="Audio analysis failed.") from error
    finally:
        await file.close()


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)