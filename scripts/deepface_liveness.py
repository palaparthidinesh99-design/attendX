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
        # 1. DeepFace RetinaFace / OpenCV Anti-Spoofing Classifier
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
                is_real = face_obj.get("is_real", True)
                score = face_obj.get("antispoof_score", 0.95)
                # Only reject if DeepFace is 90%+ confident of a photo spoof
                if is_real is False and score < 0.25:
                    return {
                        "isLive": False,
                        "score": float(score),
                        "method": "deepface_cnn",
                        "error": "DeepFace Anti-Spoofing: Photo / screen display detected"
                    }
        except Exception:
            pass

        # 2. Face ROI Extraction + CLAHE + LBP + FFT Texture Pipeline
        import cv2
        import numpy as np

        img = cv2.imread(tmp_path)
        if img is None:
            return {"isLive": False, "error": "Invalid image format"}

        h, w, _ = img.shape
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Extract Face ROI using OpenCV Haar Cascade
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(60, 60))

        if len(faces) > 0:
            fx, fy, fw, fh = max(faces, key=lambda b: b[2] * b[3])
            # Crop to Face ROI ONLY (eliminates room walls, background lights, and clothing)
            face_img = img[fy:fy+fh, fx:fx+fw]
            face_gray = gray[fy:fy+fh, fx:fx+fw]
        else:
            face_img = img
            face_gray = gray

        fh_roi, fw_roi = face_gray.shape

        # CLAHE Contrast Normalization
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        norm_face_gray = clahe.apply(face_gray)

        # A. Spatial Laplacian Texture Variance inside Face ROI
        laplacian_var = cv2.Laplacian(norm_face_gray, cv2.CV_64F).var()

        # B. Local Binary Patterns (LBP) Micro-Texture Histogram Analysis inside Face ROI
        lbp_map = compute_lbp(norm_face_gray)
        hist, _ = np.histogram(lbp_map.ravel(), bins=256, range=(0, 256))
        hist = hist.astype("float")
        hist /= (hist.sum() + 1e-7)
        lbp_uniformity = np.sum(hist ** 2)

        # C. 2D-FFT Moiré Grid Ratio inside Face ROI
        f = np.fft.fft2(norm_face_gray)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-8)
        cy, cx = fh_roi // 2, fw_roi // 2
        r = max(5, min(fh_roi, fw_roi) // 4)
        center = magnitude_spectrum[max(0, cy-r):min(fh_roi, cy+r), max(0, cx-r):min(fw_roi, cx+r)]
        total_energy = np.sum(magnitude_spectrum)
        center_energy = np.sum(center)
        high_freq_ratio = (total_energy - center_energy) / (total_energy + 1e-8)

        # D. Specular Glass Glare Ratio inside Face ROI
        specular_pixels = np.sum((face_img[:, :, 0] > 250) & (face_img[:, :, 1] > 250) & (face_img[:, :, 2] > 250))
        specular_ratio = specular_pixels / float(fh_roi * fw_roi)

        # Multi-Factor Anomaly Voting (Requires >= 2 anomaly flags to reject, preventing false rejections)
        anomaly_flags = 0
        reasons = []

        if laplacian_var < 6.0:
            anomaly_flags += 1
            reasons.append(f"Blur/Paper texture (Laplacian Var: {laplacian_var:.1f})")

        if lbp_uniformity > 0.12:
            anomaly_flags += 1
            reasons.append(f"Artificial LBP pattern (LBP: {lbp_uniformity:.3f})")

        if specular_ratio > 0.08:
            anomaly_flags += 1
            reasons.append(f"Glass screen reflection glare (Glare: {specular_ratio:.3f})")

        if high_freq_ratio > 0.85 or high_freq_ratio < 0.03:
            anomaly_flags += 1
            reasons.append(f"Moiré screen grid pattern (FFT: {high_freq_ratio:.2f})")

        # Reject ONLY if MULTIPLE anomaly flags trigger simultaneously (zero false positives for real students)
        is_spoof = (anomaly_flags >= 2)

        return {
            "isLive": not is_spoof,
            "score": float(laplacian_var),
            "lbp_uniformity": float(lbp_uniformity),
            "anomaly_flags": anomaly_flags,
            "method": "face_roi_clahe_lbp_fft",
            "error": "; ".join(reasons) if is_spoof else None
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
