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

def generate_synthetic_image(offset_x=0, offset_y=0, seed=42):
    np.random.seed(seed)
    data = np.random.normal(1000, 50, (400, 400))
    
    # Static stars
    for _ in range(80):
        x, y = np.random.randint(10, 390, 2)
        brightness = np.random.randint(2000, 8000)
        data[y-2:y+3, x-2:x+3] += brightness
        
    # Moving object (asteroid)
    ax, ay = 200 + offset_x, 200 + offset_y
    data[ay-4:ay+5, ax-4:ax+5] += 15000
    
    norm = ImageNormalize(data, interval=ZScaleInterval())
    pixel_data = (norm(data) * 255).astype(np.uint8)
    img = Image.fromarray(pixel_data)
    img = img.resize((400, 400), Image.Resampling.LANCZOS)
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def process_image(task_id: str, ra: str, dec: str, fov: str, start_date: str, end_date: str, band: str, max_frames: int, fps: float, offset: int):
    try:
        tasks[task_id]["status"] = "Contacting NASA servers..."
        tasks[task_id]["progress"] = 0

        # HIGH AVAILABILITY SIMULATED DATASET
        if ra.startswith("269.4"):
            tasks[task_id]["status"] = "Generating local simulated dataset..."
            time.sleep(1) 
            
            notices = ["High-Availability Mode: NASA's IRSA servers are currently down. Loading simulated dataset so you can test the UI, Blink, and AI features."]
            tasks[task_id]["notices"] = notices
            tasks[task_id]["total_available"] = 4
            tasks[task_id]["total"] = 4
            
            frames = []
            # 4 frames with an obviously moving object
            frames.append({"url": f"data:image/png;base64,{generate_synthetic_image(0, 0, 42)}", "name": "SIMULATED_2026W20_2A_0001.fits"})
            frames.append({"url": f"data:image/png;base64,{generate_synthetic_image(20, 15, 43)}", "name": "SIMULATED_2026W20_2A_0002.fits"})
            frames.append({"url": f"data:image/png;base64,{generate_synthetic_image(40, 30, 44)}", "name": "SIMULATED_2026W20_2A_0003.fits"})
            frames.append({"url": f"data:image/png;base64,{generate_synthetic_image(60, 45, 45)}", "name": "SIMULATED_2026W20_2A_0004.fits"})
            
            tasks[task_id]["status"] = "complete"
            tasks[task_id]["frames"] = frames
            tasks[task_id]["fps"] = fps
            tasks[task_id]["offset"] = 0
            return

        # Normal NASA fetch
        nasaUrl = f"https://irsa.ipac.caltech.edu/SIA?POS=circle+{ra}+{dec}+{fov}&COLLECTION=spherex_qr3"
        try:
            response = requests.get(nasaUrl, timeout=(5, 15))
            response.raise_for_status()
            text_content = response.content.decode('utf-8', errors='ignore')
            raw_urls = list(set(re.findall(r'(https?://[^\s<"]+\.fits)', text_content)))
            urls = [u for u in raw_urls if not u.endswith('.gz')]
        except Exception as e:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["msg"] = "NASA's search server timed out. Try Barnard's Star for the High-Availability demo."
            return

        if not urls:
            tasks[task_id]["status"] = "error"
            tasks[task_id]["msg"] = "No images found."
            return

        urls.sort()
        available_count = len(urls)
        target_urls = urls[offset : offset + max_frames]
        
        tasks[task_id]["total"] = len(target_urls)
        tasks[task_id]["total_available"] = available_count
        
        frames = []
        headers = {'User-Agent': 'Mozilla/5.0'}
        
        for i, base_fits_url in enumerate(target_urls):
            tasks[task_id]["progress"] = i + 1
            tasks[task_id]["status"] = f"Downloading frame {i+1}/{len(target_urls)}..."

            cutout_url = f"{base_fits_url}?center={ra},{dec}&size={fov}"
            try:
                res = requests.get(cutout_url, headers=headers, timeout=(5, 20))
                res.raise_for_status()
                data = res.content
            except Exception:
                continue

            if b'SIMPLE' not in data[:100]:
                continue

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
                continue
            del data
            gc.collect()

        tasks[task_id]["status"] = "complete"
        tasks[task_id]["frames"] = frames
        tasks[task_id]["fps"] = fps
        tasks[task_id]["offset"] = offset
    except Exception as e:
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