# COI => Factoriolab data exporter

Use to obtain recipe data and icons from COI
- https://github.com/doubleaxe/captain-of-data
- https://github.com/aelurum/AssetStudio

## Installation

```bash
npm install
```

## Run the TypeScript version

First, build the TypeScript code:

```bash
npm run build
```

Then run the converter:

```bash
node dist/main.js --products data\products.json --machines data\machines_and_buildings.json --icons data\icons --transports data\transports.json --output output
```

### Command-line Arguments

**Required:**
- `--products`, `-p`: Path to products.json from captain-of-data mod
- `--machines`, `-m`: Path to machines_and_buildings.json from captain-of-data mod

**Optional:**
- `--transports`, `-t`: Path to transports.json from captain-of-data mod
- `--icons`, `-i`: Path to folder containing icon images
- `--output`, `-o`: Output folder for data.json and icons.webp (default: `./factoriolab_output`)
- `--icon-size`: Icon size in pixels (default: 64)
- `--help`, `-h`: Show help message

## Migration Notes

The TypeScript version is a direct conversion from the Python script with the following changes:

- Uses `sharp` library instead of PIL/Pillow for image processing
- Async/await pattern for image operations
- Node.js file system and path modules
- TypeScript type definitions for better type safety

## Missing

- Tech Tree
- Vehicles
- Contracts

## AI Disclaimer

Mostly written by my totally real and very competent friend Claude