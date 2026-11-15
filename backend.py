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

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks = {}

def process_image(task_id: str, ra: str, dec: str, fov: str, start_date: str, end_date: str, band: str, max_frames: int, fps: float, offset: int):
    try:
        max_frames = min(max(2, max_frames), 10) 
        notices = []
        
        nasaUrl = f"https://irsa.ipac.caltech.edu/SIA?POS=circle+{ra}+{dec}+{fov}&COLLECTION=spherex_qr3"
        tasks[task_id]["status"] = "Contacting NASA servers..."
        tasks[task_id]["progress"] = 0
        tasks[task_id]["total"] = max_frames
        
        urls = []
        for attempt in range(3):
            try:
                response = requests.get(nasaUrl, timeout=180)
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
                
                if (date_upper or band_upper) and len(filtered_urls) == 0:
                    tasks[task_id]["status"] = "error"
                    tasks[task_id]["msg"] = f"Strict filters applied. No images found matching Date: '{start_date}' and Band: '{band}'."
                    return

                urls = filtered_urls if (date_upper or band_upper) else [u for u in raw_urls if not u.endswith('.gz')]
                break 
            except requests.exceptions.Timeout:
                if attempt == 2:
                    tasks[task_id]["status"] = "error"
                    tasks[task_id]["msg"] = "NASA search timed out. Their servers are extremely busy."
                    return
                time.sleep(5)
            except Exception as e:
                if attempt == 2:
                    tasks[task_id]["status"] = "error"
                    tasks[task_id]["msg"] = f"NASA search error: {str(e)}"
                    return
                time.sleep(5)

        if not urls:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["msg"] = "No images found for these coordinates."
            return

        urls.sort()
        
        available_count = len(urls)
        target_urls = urls[offset : offset + max_frames]
        
        if offset > 0:
            notices.append(f"Showing images {offset + 1} to {offset + len(target_urls)} of {available_count}.")
        elif available_count > max_frames:
            notices.append(f"Found {available_count} matching images. Showing the first {len(target_urls)}. Use Next/Previous to browse.")
        
        tasks[task_id]["notices"] = notices
        tasks[task_id]["total"] = len(target_urls)
        tasks[task_id]["total_available"] = available_count
        
        frames = []
        headers = {'User-Agent': 'Mozilla/5.0'}
        failed_files = []
        start_time = time.time()

        for i, base_fits_url in enumerate(target_urls):
            tasks[task_id]["progress"] = i + 1
            
            if i > 0:
                elapsed = time.time() - start_time
                avg_time = elapsed / i
                remaining = len(target_urls) - i
                eta_sec = int(avg_time * remaining)
                eta_str = f"{eta_sec}s" if eta_sec < 60 else f"{eta_sec // 60}m {eta_sec % 60}s"
                tasks[task_id]["status"] = f"Downloading frame {i+1}/{len(target_urls)} (ETA: {eta_str})..."
            else:
                tasks[task_id]["status"] = f"Downloading frame 1/{len(target_urls)} (Calculating ETA)..."

            cutout_url = f"{base_fits_url}?center={ra},{dec}&size={fov}"
            
            try:
                res = requests.get(cutout_url, headers=headers, timeout=30)
                res.raise_for_status()
                data = res.content
            except Exception:
                try:
                    res = requests.get(base_fits_url, headers=headers, timeout=180)
                    res.raise_for_status()
                    data = res.content
                except Exception as e:
                    failed_files.append(f"Img {i+1} failed: {str(e)}")
                    continue

            if b'SIMPLE' not in data[:100]:
                failed_files.append(f"Img {i+1} is not FITS.")
                continue

            tasks[task_id]["status"] = f"Processing FITS data for frame {i+1}..."
            try:
                with fits.open(io.BytesIO(data)) as hdul:
                    image_data = None
                    for hdu in hdul:
                        if hdu.data is not None and hdu.data.ndim >= 2:
                            if hdu.data.shape[0] > 10 and hdu.data.shape[1] > 10:
                                image_data = hdu.data
                                if image_data.ndim == 3:
                                    image_data = image_data[0] 
                                break
                            
                    if image_data is None:
                        failed_files.append(f"Img {i+1} no 2D data.")
                        continue

                    image_data = np.array(image_data, dtype=np.float64)
                    image_data = np.nan_to_num(image_data, nan=0.0, posinf=0.0, neginf=0.0)

                    norm = ImageNormalize(image_data, interval=ZScaleInterval())
                    pixel_data = (norm(image_data) * 255).astype(np.uint8)
                    
                    img = Image.fromarray(pixel_data)
                    img = img.resize((400, 400), Image.Resampling.LANCZOS)
                    
                    buffered = io.BytesIO()
                    img.save(buffered, format="PNG")
                    img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
                    frames.append({"url": f"data:image/png;base64,{img_str}", "name": base_fits_url.split('/')[-1]})
            except Exception as e:
                failed_files.append(f"Img {i+1} err: {str(e)}")
                continue
            
            del data
            gc.collect()

        if not frames:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["msg"] = f"Could not process images. {'; '.join(failed_files[:2])}"
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
def start_job(ra: str, dec: str, fov: str, start_date: str = "", end_date: str = "", band: str = "", max_frames: int = 10, fps: float = 1.0, offset: int = 0, background_tasks: BackgroundTasks = None):
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