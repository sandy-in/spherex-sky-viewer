from astroquery.ipac.irsa import Irsa
from astropy.coordinates import SkyCoord
import astropy.units as u
import requests
import io
from astropy.io import fits
import matplotlib.pyplot as plt
from astropy.visualization import ZScaleInterval, ImageNormalize
import imageio.v2 as imageio
import numpy as np

ra = "304.693508808"
dec = "42.4436872991"
coord = SkyCoord(ra, dec, unit='deg')
search_radius = 1 * u.arcsec

print("Searching for SPHEREx images...")
results = Irsa.query_sia(pos=(coord, search_radius), collection='spherex_qr3')

# We will only download the first 5 to save time and memory
num_images = 5
frames = []

if len(results) > 0:
    print(f"✅ Found {len(results)} images. Downloading the first {num_images}...")
    
    for i in range(num_images):
        base_url = results['access_url'][i]
        print(f"Downloading image {i+1} of {num_images}...")
        
        try:
            response = requests.get(base_url)
            hdul = fits.open(io.BytesIO(response.content))
            
            # Find the 2D image data
            data = None
            for hdu in hdul:
                if hdu.data is not None and hdu.data.ndim == 2:
                    data = hdu.data
                    break
                    
            if data is not None:
                # Normalize the image
                norm = ImageNormalize(data, interval=ZScaleInterval())
                plt.figure(figsize=(4, 4))
                plt.imshow(data, cmap='gray', norm=norm, origin='lower')
                plt.axis('off')
                
                # Save the figure to an in-memory buffer
                buf = io.BytesIO()
                plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
                plt.close()
                buf.seek(0)
                
                # Read the image from the buffer and add to our frames list
                frames.append(imageio.imread(buf))
                
        except Exception as e:
            print(f"Error on image {i+1}: {e}")

    if frames:
        print("Creating GIF...")
        # Save the frames as a GIF (duration is time between frames in seconds)
        imageio.mimsave('blink_animation.gif', frames, duration=0.5, loop=0)
        print("✅ Success! Saved as 'blink_animation.gif'")
else:
    print("\n❌ No images found.")