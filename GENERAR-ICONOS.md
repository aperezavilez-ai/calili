# Instrucciones para generar iconos de Calili

Necesitas crear los siguientes iconos en `public/`:

## Iconos requeridos:

- `icon-72.png` (72x72px)
- `icon-96.png` (96x96px)
- `icon-128.png` (128x128px)
- `icon-144.png` (144x144px)
- `icon-152.png` (152x152px)
- `icon-192.png` (192x192px)
- `icon-384.png` (384x384px)
- `icon-512.png` (512x512px)
- `apple-touch-icon.png` (180x180px)
- `favicon.ico` (32x32px)

## Diseño sugerido:

- **Fondo:** Gradiente morado a rosa (#8B5CF6 → #EC4899)
- **Icono:** Logo "C" estilizado o robot AI
- **Estilo:** Moderno, minimalista, redondeado

## Herramientas para generar:

### Opción 1: Figma/Canva
1. Crea el diseño en 512x512px
2. Exporta en todos los tamaños

### Opción 2: Online
- https://favicon.io/favicon-generator/
- https://realfavicongenerator.net/

### Opción 3: ImageMagick (CLI)
```bash
# Crear imagen base 512x512
magick -size 512x512 gradient:"#8B5CF6-#EC4899" base.png

# Redimensionar
magick base.png -resize 72x72 icon-72.png
magick base.png -resize 96x96 icon-96.png
magick base.png -resize 128x128 icon-128.png
magick base.png -resize 144x144 icon-144.png
magick base.png -resize 152x152 icon-152.png
magick base.png -resize 192x192 icon-192.png
magick base.png -resize 384x384 icon-384.png
magick base.png -resize 512x512 icon-512.png
magick base.png -resize 180x180 apple-touch-icon.png
```

## Mientras tanto (placeholder):

Puedes usar temporalmente iconos de:
- https://via.placeholder.com/512x512/8B5CF6/FFFFFF?text=C
- O copiar iconos de otro proyecto PWA

Una vez generados, colócalos en `public/` y la PWA funcionará correctamente.
