import json
import os
import sys

# ============ НАСТРОЙКИ ============

GALLERY_DIR = "img/gallery"
OUTPUT_FILE = "json/galleryImages"

# Разрешённые расширения картинок (регистр не важен)
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

# ============================================================


def main():
    if not os.path.isdir(GALLERY_DIR):
        print(f"Папка {GALLERY_DIR} не найдена, создаю пустой список.")
        images = []
    else:
        files = sorted(os.listdir(GALLERY_DIR))
        images = []
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext in ALLOWED_EXT:
                images.append(f"{GALLERY_DIR}/{name}")

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(images, f, ensure_ascii=False, indent=2)

    print(f"Готово! Найдено {len(images)} изображений, записано в {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
