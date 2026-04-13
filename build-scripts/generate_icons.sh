#!/bin/bash

SOURCE="my-assets/silhouette copy.svg"

if [ ! -f "$SOURCE" ]; then
    echo "Error: Source file '$SOURCE' does not exist."
    exit 1
fi

# Ensure output directories exist
mkdir -p public/icons
mkdir -p app

# Check for ImageMagick
if ! command -v magick &> /dev/null; then
    echo "Error: ImageMagick (magick) is not installed."
    exit 1
fi

echo "Using source: $SOURCE"

# Function to generate icon
generate_icon() {
    local size=$1
    local output=$2
    echo "Generating $output (${size}x${size})..."
    magick -background none "$SOURCE" -resize "${size}x${size}" "$output"
}

# Generate public/icons
sizes=(16 32 48 64 72 96 128 144 152 180 192 256 512)
for size in "${sizes[@]}"; do
    generate_icon "$size" "public/icons/icon-${size}.png"
done

# Generate app icons
# app/apple-icon.png -> 180x180
generate_icon 180 "app/apple-icon.png"

# app/icon.png -> 512x512
generate_icon 512 "app/icon.png"

# app/favicon.png -> 32x32
generate_icon 32 "app/favicon.png"

# Also updating public/favicon.png if it helps, standard size 32x32
if [ -f "public/favicon.png" ]; then
    generate_icon 32 "public/favicon.png"
fi

echo "All icons generated successfully."
