from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import requests
import io
import re
import uuid
import base64
import numpy as np
from astropy.io import fits
from astropy.visualization import ZScaleInterval, ImageNormalize
from PIL import Image
import time
import traceback
import gc
import tempfile
import os
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks = {}

@app.get("/")
def health_check():
    return {"status": "ok", "message": "SPHEREx Backend is running perfectly."}

# Guaranteed verified NASA FITS files for catalog targets
FALLBACK_URLS = {
    "269.452": [
        "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W20_2A/12b-v27-2026-267/3/level2_2026W20_2A_0058_4D3_spx_12b-v27-2026-267.fits",
        "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W20_2A/12b-v27-2026-267/6/level2_2026W20_2A_0058_4D6_spx_12b-v27-2026-267.fits"
    ]
}

def process_image(task_id: str, ra: str, dec: str, fov: str, start_date: str, end_date: str, band: str, max_frames: int, fps: float, offset: int):
    try:
        max_frames = min(max(2, max_frames), 10) 
        notices = []
        
        nasaUrl = f"https://irsa.ipac.caltech.edu/SIA?POS=circle+{ra}+{dec}+{fov}&COLLECTION=spherex_qr3"
        tasks[task_id]["status"] = "Contacting NASA servers..."
        tasks[task_id]["progress"] = 0
        tasks[task_id]["total"] = max_frames
        
        urls = []
        
        session = requests.Session()
        retries = Retry(total=2, backoff_factor=1, status_forcelist=[ 502, 503, 504 ])
        session.mount('https://', HTTPAdapter(max_retries=retries))

        try:
            # INCREASED TO 20 SECONDS FOR SEARCH
            response = session.get(nasaUrl, timeout=(5, 20))
            response.raise_for_status()
            text_content = response.content.decode('utf-8', errors='ignore')
            raw_urls = list(set(re.findall(r'(https?://[^\s<"]+\.fits)', text_content)))
            
            filtered_urls = []
            band_upper = band.strip().upper()
            date_upper = start_date.strip().upper()
            end_upper = end_date.strip().upper()

            for u in raw_urls:
                u_upper = u.upper()
                if date_upper and date_upper not in u_upper: continue
                if end_upper and end_upper not in u_upper: continue
                if band_upper and band_upper not in u_upper: continue
                filtered_urls.append(u)
            
            urls = filtered_urls if (date_upper or band_upper) else [u for u in raw_urls if not u.endswith('.gz')]
            
        except Exception as e:
            fallback_key = next((key for key in FALLBACK_URLS if ra.startswith(key)), None)
            if fallback_key:
                notices.append("NASA's search API is currently overwhelmed. Loading verified cached dataset for this target so you can still test the AI.")
                urls = FALLBACK_URLS[fallback_key]
            else:
                tasks[task_id]["status"] = "error"
                tasks[task_id]["msg"] = "NASA's IRSA search database timed out. Please try a catalog target like Barnard's Star for cached data."
                return

        if not urls:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["msg"] = "No images found for these coordinates."
            return

        urls.sort()
        target_urls = urls[offset : offset + max_frames]
        
        tasks[task_id]["notices"] = notices
        tasks[task_id]["total"] = len(target_urls)
        tasks[task_id]["total_available"] = len(urls)
        
        frames = []
        headers = {'User-Agent': 'Mozilla/5.0'}

        for i, base_fits_url in enumerate(target_urls):
            tasks[task_id]["progress"] = i + 1
            tasks[task_id]["status"] = f"Downloading frame {i+1}/{len(target_urls)}..."

            cutout_url = f"{base_fits_url}?center={ra},{dec}&size={fov}"
            
            try:
                # INCREASED TO 30 SECONDS FOR CUTOUT DOWNLOAD
                with requests.get(cutout_url, headers=headers, timeout=(5, 30), stream=True) as res:
                    res.raise_for_status()
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".fits") as tmp:
                        for chunk in res.iter_content(chunk_size=8192):
                            tmp.write(chunk)
                        tmp_path = tmp.name

                if os.path.getsize(tmp_path) < 1000:
                    os.remove(tmp_path)
                    continue

                tasks[task_id]["status"] = f"Processing FITS data for frame {i+1}..."
                
                with fits.open(tmp_path, memmap=True) as hdul:
                    image_data = None
                    for hdu in hdul:
                        if hdu.data is not None and hdu.data.ndim >= 2:
                            if hdu.data.shape[0] > 10 and hdu.data.shape[1] > 10:
                                image_data = np.array(hdu.data, dtype=np.float32)
                                if image_data.ndim == 3:
                                    image_data = image_data[0] 
                                break
                            
                    if image_data is None:
                        os.remove(tmp_path)
                        continue

                    image_data = np.nan_to_num(image_data, nan=0.0, posinf=0.0, neginf=0.0)
                    norm = ImageNormalize(image_data, interval=ZScaleInterval())
                    pixel_data = (norm(image_data) * 255).astype(np.uint8)
                    
                    img = Image.fromarray(pixel_data)
                    img = img.resize((400, 400), Image.Resampling.LANCZOS)
                    
                    buffered = io.BytesIO()
                    img.save(buffered, format="PNG")
                    img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
                    frames.append({"url": f"data:image/png;base64,{img_str}", "name": base_fits_url.split('/')[-1]})
                
                os.remove(tmp_path)
                del image_data, norm, pixel_data, img
                gc.collect()

            except Exception:
                if 'tmp_path' in locals() and os.path.exists(tmp_path):
                    os.remove(tmp_path)
                continue

        if not frames:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["msg"] = "NASA's file server timed out while trying to download the FITS data."
            return

        tasks[task_id]["status"] = "complete"
        tasks[task_id]["frames"] = frames
        tasks[task_id]["fps"] = fps
        tasks[task_id]["offset"] = offset

    except Exception as e:
        traceback.print_exc()
        tasks[task_id]["status"] = "error"
        tasks[task_id]["msg"] = f"Critical Error: {str(e)}"

@app.post("/api/image")
def start_job(ra: str, dec: str, fov: str, start_date: str = "", end_date: str = "", band: str = "", max_frames: int = 2, fps: float = 1.0, offset: int = 0, background_tasks: BackgroundTasks = None):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {"status": "starting", "frames": None, "msg": "", "fps": fps, "notices": [], "progress": 0, "total": max_frames}
    background_tasks.add_task(process_image, task_id, ra, dec, fov, start_date, end_date, band, max_frames, fps, offset)
    return {"task_id": task_id}

@app.get("/api/status/{task_id}")
def get_status(task_id: str):
    if task_id not in tasks:
        raise HTTPException(404, "Task not found")
    t = tasks[task_id]
    return {"status": t["status"], "msg": t["msg"], "progress": t.get("progress", 0), "total": t.get("total", 1)}

@app.get("/api/result/{task_id}")
def get_result(task_id: str):
    if task_id not in tasks or tasks[task_id]["status"] != "complete":
        raise HTTPException(400, "Task not complete")
    return JSONResponse(content={
        "frames": tasks[task_id]["frames"], 
        "fps": tasks[task_id]["fps"],
        "notices": tasks[task_id]["notices"],
        "total_available": tasks[task_id]["total_available"],
        "offset": tasks[task_id]["offset"]
    })