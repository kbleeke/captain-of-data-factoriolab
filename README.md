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
node dist/main.js --data data --output output
```

### Command-line Arguments

**Required:**
- `--data`, `-d`: Path to directory containing captain-of-data JSON files (products.json, machines_and_buildings.json, transports.json)

**Optional:**
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