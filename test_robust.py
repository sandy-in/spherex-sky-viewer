import requests
import io
import re
from astropy.io import fits
from astropy.visualization import ZScaleInterval, ImageNormalize
from PIL import Image

ra = "304.693508808"
dec = "42.4436872991"
fov = "0.1"

print("1. Querying IRSA for image URLs...")
nasaUrl = f"https://irsa.ipac.caltech.edu/SIA?POS=circle+{ra}+{dec}+{fov}&COLLECTION=spherex_qr3"
response = requests.get(nasaUrl)
urls = list(set(re.findall(r'(https?://[^\s<"]+\.fits)', response.text)))

if not urls:
    print("No images found.")
    exit()

print(f"Found {len(urls)} images. Trying the first one...")
base_fits_url = urls[0]
print(f"Target: {base_fits_url}")

# Try downloading
data = None
headers = {'User-Agent': 'Mozilla/5.0'} # Sometimes NASA blocks scripts without a browser user-agent

print("2. Attempting Cutout Download...")
cutout_url = f"{base_fits_url}?center={ra},{dec}&size={fov}"
try:
    res = requests.get(cutout_url, headers=headers, timeout=15)
    res.raise_for_status()
    print("✅ Cutout downloaded successfully!")
    data = res.content
except Exception as e:
    print(f"❌ Cutout failed ({e}). Falling back to full file download...")
    
    print("3. Attempting Full File Download (might be ~70MB)...")
    try:
        res = requests.get(base_fits_url, headers=headers, timeout=60)
        res.raise_for_status()
        print("✅ Full file downloaded successfully!")
        data = res.content
    except Exception as e:
        print(f"❌ Full file failed too ({e}). NASA's servers are definitely down right now.")
        exit()

print("4. Parsing FITS data...")
try:
    with fits.open(io.BytesIO(data)) as hdul:
        image_data = None
        for hdu in hdul:
            if hdu.data is not None and hdu.data.ndim >= 2:
                image_data = hdu.data
                if image_data.ndim == 3:
                    image_data = image_data[0] # Take first slice if 3D
                break
                
        if image_data is None:
            raise ValueError("No image data found")

        print("5. Converting to PNG...")
        norm = ImageNormalize(image_data, interval=ZScaleInterval())
        pixel_data = (norm(image_data) * 255).astype('uint8')
        
        img = Image.fromarray(pixel_data)
        img.save("robust_cutout.png")
        print("🎉 SUCCESS! Saved robust_cutout.png. The pipeline is unbreakable!")
except Exception as e:
    print(f"Error parsing FITS: {e}")