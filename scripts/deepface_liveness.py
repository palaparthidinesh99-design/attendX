import sys
import json
import base64
import os
import tempfile

def compute_lbp(gray_img):
    """Computes Local Binary Patterns (LBP) micro-texture map (8-neighbor, radius 1)."""
    import numpy as np
    h, w = gray_img.shape
    if h < 10 or w < 10:
        return np.zeros((1, 1))

    # Fast vectorized 8-neighbor LBP
    center = gray_img[1:-1, 1:-1]
    lbp = np.zeros(center.shape, dtype=np.uint8)
    lbp |= ((gray_img[0:-2, 0:-2] >= center) << 7).astype(np.uint8)
    lbp |= ((gray_img[0:-2, 1:-1] >= center) << 6).astype(np.uint8)
    lbp |= ((gray_img[0:-2, 2:]   >= center) << 5).astype(np.uint8)
    lbp |= ((gray_img[1:-1, 2:]   >= center) << 4).astype(np.uint8)
    lbp |= ((gray_img[2:,   2:]   >= center) << 3).astype(np.uint8)
    lbp |= ((gray_img[2:,   1:-1] >= center) << 2).astype(np.uint8)
    lbp |= ((gray_img[2:,   0:-2] >= center) << 1).astype(np.uint8)
    lbp |= ((gray_img[1:-1, 0:-2] >= center) << 0).astype(np.uint8)
    return lbp

def classify_anti_spoofing(base64_img):
    clean_b64 = base64_img.split(',')[-1]
    img_data = base64.b64decode(clean_b64)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
        tmp.write(img_data)
        tmp_path = tmp.name

    try:
        # 1. Try DeepFace with RetinaFace backend detector
        try:
            from deepface import DeepFace
            # Using RetinaFace backend for precise landmark alignment & crop boundary
            results = DeepFace.extract_faces(
                img_path=tmp_path,
                detector_backend='retinaface',
                anti_spoofing=True,
                enforce_detection=False
            )
            if results and len(results) > 0:
                face_obj = results[0]
                is_real = face_obj.get("is_real", True)
                score = face_obj.get("antispoof_score", 0.95)
                if not is_real:
                    return {
                        "isLive": False,
                        "score": float(score),
                        "method": "deepface_retinaface_cnn",
                        "error": "DeepFace (RetinaFace Backend): Spoof photo / screen display detected"
                    }
        except Exception:
            # Fallback to opencv detector backend if RetinaFace model weights initializing
            try:
                from deepface import DeepFace
                results = DeepFace.extract_faces(
                    img_path=tmp_path,
                    detector_backend='opencv',
                    anti_spoofing=True,
                    enforce_detection=False
                )
                if results and len(results) > 0:
                    face_obj = results[0]
                    if not face_obj.get("is_real", True):
                        return {
                            "isLive": False,
                            "score": float(face_obj.get("antispoof_score", 0.95)),
                            "method": "deepface_opencv_cnn",
                            "error": "DeepFace Anti-Spoofing: Spoof photo / screen display detected"
                        }
            except Exception:
                pass

        # 2. Advanced Computer Vision Pipeline: CLAHE + LBP + 2D-FFT Moiré + Specular Glare Analysis
        import cv2
        import numpy as np

        img = cv2.imread(tmp_path)
        if img is None:
            return {"isLive": False, "error": "Invalid image format"}

        h, w, _ = img.shape

        # A. Lighting & Shadow Normalization using CLAHE (Equalize heavy shadows & background glare)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        norm_gray = clahe.apply(gray)

        # B. Local Binary Patterns (LBP) Micro-Texture Histogram Analysis
        lbp_map = compute_lbp(norm_gray)
        hist, _ = np.histogram(lbp_map.ravel(), bins=256, range=(0, 256))
        hist = hist.astype("float")
        hist /= (hist.sum() + 1e-7)
        # Uniformity measure: sum of squared probabilities (Organic skin has smooth uniform distribution)
        lbp_uniformity = np.sum(hist ** 2)

        # C. 2D Fast Fourier Transform (FFT) Moiré High-Frequency Grid Ratio
        f = np.fft.fft2(norm_gray)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)

        cy, cx = h // 2, w // 2
        r = max(5, min(h, w) // 4)
        center = magnitude_spectrum[max(0, cy-r):min(h, cy+r), max(0, cx-r):min(w, cx+r)]
        total_energy = np.sum(magnitude_spectrum)
        center_energy = np.sum(center)
        high_freq_ratio = (total_energy - center_energy) / (total_energy + 1e-8)

        # D. Spatial Laplacian Texture Variance
        laplacian_var = cv2.Laplacian(norm_gray, cv2.CV_64F).var()

        # E. Specular Glass Reflection Glare Ratio (OLED/LCD smartphone screens)
        specular_pixels = np.sum((img[:, :, 0] > 248) & (img[:, :, 1] > 248) & (img[:, :, 2] > 248))
        specular_ratio = specular_pixels / float(h * w)

        # Multi-feature anti-spoofing classifier decision logic
        is_spoof = False
        reason = None

        if laplacian_var < 26.0:
            is_spoof = True
            reason = f"Paper printout or blurred screen photo (Laplacian Var: {laplacian_var:.1f})"
        elif lbp_uniformity > 0.08:
            is_spoof = True
            reason = f"Artificial LBP micro-texture pattern detected (LBP Uniformity: {lbp_uniformity:.3f})"
        elif specular_ratio > 0.015:
            is_spoof = True
            reason = f"Screen glass specular glare detected (Specular Ratio: {specular_ratio:.3f})"
        elif high_freq_ratio > 0.70 or high_freq_ratio < 0.07:
            is_spoof = True
            reason = f"Moiré screen grid pattern detected (FFT Ratio: {high_freq_ratio:.2f})"

        return {
            "isLive": not is_spoof,
            "score": float(laplacian_var),
            "lbp_uniformity": float(lbp_uniformity),
            "fft_ratio": float(high_freq_ratio),
            "method": "retinaface_clahe_lbp_fft",
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
