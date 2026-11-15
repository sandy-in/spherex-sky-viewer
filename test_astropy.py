import requests
import io
from astropy.io import fits
from astropy.visualization import ZScaleInterval, ImageNormalize
from PIL import Image

# 1. The original NASA data URL (from our earlier SIA query)
base_url = "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W20_2A/12b-v27-2026-267/3/level2_2026W20_2A_0058_4D3_spx_12b-v27-2026-267.fits"

# 2. Append the cutout parameters (center RA/Dec and size in degrees)
ra = "304.693508808"
dec = "42.4436872991"
fov = "0.1"
cutout_url = f"{base_url}?center={ra},{dec}&size={fov}&gzip=false"

print(f"Downloading cutout from NASA...")
response = requests.get(cutout_url)
response.raise_for_status()

# 3. Parse the FITS file with Astropy
print("Parsing FITS data...")
with fits.open(io.BytesIO(response.content)) as hdul:
    # Find the 2D image data (this handles 3D cubes automatically by taking the first slice)
    data = None
    for hdu in hdul:
        if hdu.data is not None and hdu.data.ndim >= 2:
            data = hdu.data
            if data.ndim == 3:
                data = data[0] # Take the first layer of the 3D cube
            break
            
    if data is None:
        raise ValueError("No image data found in FITS file")

    # 4. Normalize the brightness (ZScale is what astronomers use)
    norm = ImageNormalize(data, interval=ZScaleInterval())
    
    # 5. Convert to a standard PNG
    # Scale to 0-255
    pixel_data = (norm(data) * 255).astype('uint8')
    
    # Create an image and save it
    img = Image.fromarray(pixel_data)
    img.save("astropy_cutout.png")
    print("✅ Success! Saved astropy_cutout.png")