import requests
import io
from astropy.io import fits
from astropy.visualization import ZScaleInterval, ImageNormalize
from PIL import Image

# A known-good cutout URL from the IRSA SPHEREx tutorial
# (Center: RA=210.80227, Dec=54.34895, Size=0.1 degrees)
direct_cutout_url = "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2025W19_2B/l2b-v11-2025-163/3/level2_2025W19_2B_0073_2D3_spx_l2b-v11-2025-163.fits?center=210.80227,54.34895&size=0.1"

print("Downloading direct cutout from NASA...")
try:
    response = requests.get(direct_cutout_url)
    response.raise_for_status() # This will catch 4xx/5xx errors
    print("Download successful!")
except requests.exceptions.HTTPError as e:
    print(f"HTTP Error: {e}")
    print("NASA's server is still returning an error. Please wait a few minutes and try again.")
    exit()

print("Parsing FITS data...")
with fits.open(io.BytesIO(response.content)) as hdul:
    data = None
    for hdu in hdul:
        if hdu.data is not None and hdu.data.ndim >= 2:
            data = hdu.data
            if data.ndim == 3:
                data = data[0] # Take the first layer of the 3D cube
            break
            
    if data is None:
        raise ValueError("No image data found in FITS file")

    print("Normalizing image...")
    norm = ImageNormalize(data, interval=ZScaleInterval())
    
    pixel_data = (norm(data) * 255).astype('uint8')
    
    img = Image.fromarray(pixel_data)
    img.save("direct_cutout_test.png")
    print("✅ Success! Saved direct_cutout_test.png")