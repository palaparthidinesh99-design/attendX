import sys
import json
import base64
import os
import tempfile

def classify_anti_spoofing(base64_img):
    clean_b64 = base64_img.split(',')[-1]
    img_data = base64.b64decode(clean_b64)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
        tmp.write(img_data)
        tmp_path = tmp.name

    try:
        # 1. Try DeepFace Anti-Spoofing if available
        try:
            from deepface import DeepFace
            results = DeepFace.extract_faces(img_path=tmp_path, anti_spoofing=True)
            if results and len(results) > 0:
                face_obj = results[0]
                is_real = face_obj.get("is_real", True)
                score = face_obj.get("antispoof_score", 0.95)
                return {
                    "isLive": bool(is_real),
                    "score": float(score),
                    "method": "deepface_cnn"
                }
        except Exception:
            pass

        # 2. Python OpenCV Fourier & Laplacian Texture Engine
        import cv2
        import numpy as np

        img = cv2.imread(tmp_path)
        if img is None:
            return {"isLive": False, "error": "Invalid image format"}

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape

        # A. Spatial Laplacian Texture Variance (Micro-texture & 2D surface blur analysis)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()

        # B. 2D Fast Fourier Transform (FFT) High-Frequency Spectral Ratio (Moiré screen grids)
        f = np.fft.fft2(gray)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)

        cy, cx = h // 2, w // 2
        r = max(5, min(h, w) // 4)
        center = magnitude_spectrum[max(0, cy-r):min(h, cy+r), max(0, cx-r):min(w, cx+r)]
        total_energy = np.sum(magnitude_spectrum)
        center_energy = np.sum(center)
        high_freq_ratio = (total_energy - center_energy) / (total_energy + 1e-8)

        # C. Specular Glass Reflection Glare Ratio
        specular_pixels = np.sum((img[:, :, 0] > 248) & (img[:, :, 1] > 248) & (img[:, :, 2] > 248))
        specular_ratio = specular_pixels / float(h * w)

        # Binary anti-spoofing classification
        is_spoof = False
        reason = None

        if laplacian_var < 28.0:
            is_spoof = True
            reason = f"Paper photo print or 2D screen blur (Laplacian Var: {laplacian_var:.1f})"
        elif specular_ratio > 0.018:
            is_spoof = True
            reason = f"Screen glass specular glare detected (Specular Ratio: {specular_ratio:.3f})"
        elif high_freq_ratio > 0.68 or high_freq_ratio < 0.08:
            is_spoof = True
            reason = f"Moiré screen grid pattern detected (FFT Ratio: {high_freq_ratio:.2f})"

        return {
            "isLive": not is_spoof,
            "score": float(laplacian_var),
            "method": "opencv_fourier_laplacian",
            "error": reason if is_spoof else None
        }
    except Exception as e:
        return {"isLive": True, "error": str(e), "fallback": True}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        base64_input = sys.argv[1]
        res = classify_anti_spoofing(base64_input)
        print(json.dumps(res))
    else:
        print(json.dumps({"isLive": False, "error": "No image input provided"}))
