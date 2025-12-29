#!/usr/bin/env node
/**
 * Convert Captain of Industry data from captain-of-data mod to FactorioLab format.
 *
 * Usage:
 *     node dist/main.js --data data_directory --output output_folder
 *
 * This script converts the JSON files exported by the captain-of-data mod into the
 * data.json and icons.webp files required by FactorioLab.
 *
 * FactorioLab format notes:
 * - There is NO separate "machines" array
 * - Machines are items with a "machine" property
 * - Icons should be .webp format
 */

import * as fs from 'fs';
import * as path from 'path';

// Optional: sharp for sprite sheet generation
let sharp: any = null;
let HAS_SHARP = false;
try {
    sharp = require('sharp');
    HAS_SHARP = true;
} catch {
    console.log('Warning: sharp not installed. Sprite sheet generation will be skipped.');
    console.log('Install with: npm install sharp');
}

interface Product {
    id: string;
    name: string;
    type: string;
    icon_path: string;
}

interface Machine {
    id: string;
    name: string;
    category: string;
    electricity_consumed: number;
    workers: number;
    computing_consumed: number;
    maintenance_cost_units: string;
    maintenance_cost_quantity: number;
    recipes: Recipe[];
    icon_path: string;
}

interface Recipe {
    id: string;
    name: string;
    duration: number;
    inputs: RecipeItem[];
    outputs: RecipeItem[];
}

interface RecipeItem {
    name: string;
    quantity: number;
}

interface Transport {
    id: string;
    name: string;
    icon_path: string;
    throughput_per_second: number;
}

interface ProductsData {
    game_version: string;
    products: Product[];
}

interface MachinesData {
    machines_and_buildings: Machine[];
}

interface TransportsData {
    transports: Transport[];
}

interface Item {
    id: string;
    name: string;
    category: string;
    row: number;
    stack?: number;
    machine?: MachineProperty;
    belt?: BeltProperty;
    pipe?: PipeProperty;
}

interface MachineProperty {
    speed: number;
    type?: string;
    usage?: number;
    consumption?: Record<string, number>;
}

interface BeltProperty {
    speed: number;
}

interface PipeProperty {
    speed: number;
}

interface RecipeEntry {
    id: string;
    name: string;
    category: string;
    row: number;
    time: number;
    producers: string[];
    cost: number;
    icon?: string;
    in: Record<string, number>;
    out: Record<string, number>;
}

interface Icon {
    id: string;
    position: string;
    color?: string;
}

interface Category {
    id: string;
    name: string;
    icon?: string;
}

interface Defaults {
    modIds: string[];
    beacon: string | null;
    minBelt: string | null;
    maxBelt: string | null;
    minPipe: string | null;
    maxPipe: string | null;
    fuel: string | null;
    disabledRecipes: string[];
    minMachineRank: string[];
    maxMachineRank: string[];
    moduleRank: string[];
}

interface OutputData {
    version: string;
    categories: Category[];
    icons: Icon[];
    items: Item[];
    recipes: RecipeEntry[];
    defaults: Defaults;
}

function slugify(name: string): string {
    let slug = name.toLowerCase();
    slug = slug.replace(/[^a-z0-9]+/g, '-');
    slug = slug.replace(/^-+|-+$/g, '');
    return slug;
}

function productIdToSlug(productId: string): string {
    if (productId.startsWith('Product_')) {
        productId = productId.substring(8);
    }

    // Handle "Virtual_" prefix
    if (productId.startsWith('Virtual_')) {
        const virtualPart = productId.substring(8);
        let slug = virtualPart.replace(/([a-z])([A-Z])/g, '$1-$2');
        slug = slug.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
        return slug.toLowerCase();
    }

    let slug = productId.replace(/([a-z])([A-Z])/g, '$1-$2');
    slug = slug.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
    return slug.toLowerCase();
}

function machineIdToSlug(machineId: string): string {
    let slug = machineId.replace(/([a-z])([A-Z])/g, '$1-$2');
    slug = slug.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
    return slug.toLowerCase();
}

class COIToFactorioLabConverter {
    private productsFile: string;
    private machinesFile: string;
    private transportsFile: string | null;
    private iconsFolder: string | null;

    private productsData: ProductsData = { game_version: '0.0.0', products: [] };
    private machinesData: MachinesData = { machines_and_buildings: [] };
    private transportsData: TransportsData = { transports: [] };

    // Lookup tables
    private productNameToId: Map<string, string> = new Map();
    private productIdToName: Map<string, string> = new Map();
    private machineIdToSlugMap: Map<string, string> = new Map();

    // Output data
    private categories: Category[] = [];
    private icons: Icon[] = [];
    private items: Item[] = [];
    private recipes: RecipeEntry[] = [];

    // Track what we've seen
    private seenItems: Set<string> = new Set();
    private seenRecipes: Set<string> = new Set();
    private categorySet: Set<string> = new Set();

    // Icon tracking
    private iconIdToFile: Map<string, string> = new Map();

    constructor(dataDir: string, iconsFolder: string | null = null) {
        this.productsFile = path.join(dataDir, 'products.json');
        this.machinesFile = path.join(dataDir, 'machines_and_buildings.json');
        this.transportsFile = path.join(dataDir, 'transports.json');
        this.iconsFolder = iconsFolder;
    }

    loadData(): void {
        console.log(`Loading products from ${this.productsFile}...`);
        const productsContent = fs.readFileSync(this.productsFile, 'utf-8');
        this.productsData = JSON.parse(productsContent);

        console.log(`Loading machines from ${this.machinesFile}...`);
        const machinesContent = fs.readFileSync(this.machinesFile, 'utf-8');
        this.machinesData = JSON.parse(machinesContent);

        if (this.transportsFile) {
            console.log(`Loading transports from ${this.transportsFile}...`);
            const transportsContent = fs.readFileSync(this.transportsFile, 'utf-8');
            this.transportsData = JSON.parse(transportsContent);
        }

        console.log(`  Game version: ${this.productsData.game_version || 'unknown'}`);
        console.log(`  Products: ${this.productsData.products?.length || 0}`);
        console.log(`  Machines: ${this.machinesData.machines_and_buildings?.length || 0}`);
        if (this.transportsFile) {
            console.log(`  Transports: ${this.transportsData.transports?.length || 0}`);
        }
    }

    buildLookups(): void {
        console.log('Building lookup tables...');

        for (const product of this.productsData.products || []) {
            const productId = product.id || '';
            const name = product.name || '';
            const slug = productIdToSlug(productId);

            this.productNameToId.set(name, slug);
            this.productIdToName.set(slug, name);
        }

        for (const machine of this.machinesData.machines_and_buildings || []) {
            const machineId = machine.id || '';
            const slug = machineIdToSlug(machineId);
            this.machineIdToSlugMap.set(machineId, slug);
        }
    }

    convertProductsToItems(): void {
        console.log('Converting products to items...');

        const typeToCategory: Record<string, string> = {
            'VirtualProductProto': 'virtual',
            'CountableProductProto': 'items',
            'LooseProductProto': 'loose',
            'FluidProductProto': 'fluids',
            'MoltenProductProto': 'molten',
        };

        for (const product of this.productsData.products || []) {
            const productId = product.id || '';
            const name = product.name || '';
            const productType = product.type || '';
            const iconPath = product.icon_path || '';

            // Extract icon filename from path
            const iconName = iconPath ? path.parse(iconPath).name : productIdToSlug(productId);

            const slug = productIdToSlug(productId);
            const category = typeToCategory[productType] || 'items';

            this.categorySet.add(category);

            const item: Item = {
                id: slug,
                name: name,
                category: category,
                row: 0,
            };

            if (productType === 'CountableProductProto') {
                item.stack = 1;
            }

            this.items.push(item);
            this.seenItems.add(slug);

            // Track icon
            this.iconIdToFile.set(slug, iconName);
            this.icons.push({
                id: slug,
                position: '0px 0px',
            });
        }
    }

    convertMachines(): void {
        console.log('Converting machines and extracting recipes...');

        for (const machine of this.machinesData.machines_and_buildings || []) {
            const machineId = machine.id || '';
            const name = machine.name || '';
            const machineCategoryRaw = machine.category || 'General';
            const electricity = machine.electricity_consumed || 0;
            const workers = machine.workers || 0;
            const computing = machine.computing_consumed || 0;
            const maintenanceUnits = machine.maintenance_cost_units || '';
            const maintenanceQuantity = machine.maintenance_cost_quantity || 0;
            const recipes = machine.recipes || [];
            const iconPath = machine.icon_path || '';

            const slug = machineIdToSlug(machineId);
            const machineCategory = 'buildings';

            // Skip if no recipes (storage buildings, etc.)
            if (!recipes || recipes.length === 0) {
                continue;
            }

            this.categorySet.add(machineCategory);

            // Add machine as an item with machine property
            if (!this.seenItems.has(slug)) {
                const item: Item = {
                    id: slug,
                    name: name,
                    category: machineCategory,
                    row: 0,
                    machine: {
                        speed: 1,
                    }
                };

                // Add power usage if electric
                if (electricity > 0) {
                    item.machine!.type = 'electric';
                    item.machine!.usage = electricity;
                }

                // Build consumption dictionary for maintenance, computing, and workers
                const consumption: Record<string, number> = {};

                // Commented out as in original Python
                // if (maintenanceQuantity > 0 && maintenanceUnits) {
                //     const maintenanceSlug = this.productNameToId.get(maintenanceUnits) || slugify(maintenanceUnits);
                //     consumption[maintenanceSlug] = maintenanceQuantity;
                // }

                // if (computing > 0) {
                //     const computingSlug = this.productNameToId.get('Computing') || 'computing';
                //     consumption[computingSlug] = computing;
                // }

                // if (workers > 0) {
                //     const workersSlug = this.productNameToId.get('Workers') || 'workers';
                //     consumption[workersSlug] = workers;
                // }

                // Add consumption to machine if any
                if (Object.keys(consumption).length > 0) {
                    item.machine!.consumption = consumption;
                }

                this.items.push(item);
                this.seenItems.add(slug);

                // Track icon from machine icon_path
                const iconName = iconPath ? path.parse(iconPath).name : slug;
                this.iconIdToFile.set(slug, iconName);
                this.icons.push({
                    id: slug,
                    position: '0px 0px',
                });
            }

            // Extract recipes from this machine
            for (const recipe of recipes) {
                this.convertRecipe(recipe, slug);
            }
        }
    }

    convertRecipe(recipe: Recipe, producerId: string): void {
        const recipeId = recipe.id || '';
        const name = recipe.name || '';
        const duration = recipe.duration || 1;
        const inputs = recipe.inputs || [];
        const outputs = recipe.outputs || [];

        const slug = machineIdToSlug(recipeId);

        // If recipe already exists, just add this producer
        if (this.seenRecipes.has(slug)) {
            for (const r of this.recipes) {
                if (r.id === slug) {
                    if (!r.producers.includes(producerId)) {
                        r.producers.push(producerId);
                    }
                }
            }
            return;
        }

        // Build input/output dictionaries
        const recipeIn: Record<string, number> = {};
        for (const inp of inputs) {
            const inpName = inp.name || '';
            const inpQty = inp.quantity || 1;
            const inpId = this.productNameToId.get(inpName) || slugify(inpName);
            recipeIn[inpId] = inpQty;
        }

        const recipeOut: Record<string, number> = {};
        for (const out of outputs) {
            const outName = out.name || '';
            const outQty = out.quantity || 1;
            const outId = this.productNameToId.get(outName) || slugify(outName);
            recipeOut[outId] = outQty;
        }

        // Determine recipe icon: first output, or first input if no outputs
        let recipeIcon: string | undefined = undefined;
        if (Object.keys(recipeOut).length > 0) {
            recipeIcon = Object.keys(recipeOut)[0];
        } else if (Object.keys(recipeIn).length > 0) {
            recipeIcon = Object.keys(recipeIn)[0];
        }

        // Determine recipe category based on first output or first input
        let recipeCategory: string | null = null;
        if (recipeIcon) {
            // Find the item to get its category
            for (const item of this.items) {
                if (item.id === recipeIcon) {
                    recipeCategory = item.category;
                    break;
                }
            }
        }

        // Fallback to 'recipes' category if not found
        if (!recipeCategory) {
            recipeCategory = 'recipes';
        }

        this.categorySet.add(recipeCategory);

        // Create recipe entry
        const recipeEntry: RecipeEntry = {
            id: slug,
            name: name,
            category: recipeCategory,
            row: 0,
            time: duration,
            producers: [producerId],
            cost: 100,
            in: recipeIn,
            out: recipeOut,
        };

        if (recipeIcon) {
            recipeEntry.icon = recipeIcon;
        }

        this.recipes.push(recipeEntry);
        this.seenRecipes.add(slug);
    }

    convertTransports(): void {
        if (!this.transportsData || !this.transportsData.transports) {
            return;
        }

        console.log('Converting transports...');

        for (const transport of this.transportsData.transports) {
            const transportId = transport.id || '';
            const name = transport.name || '';
            const iconPath = transport.icon_path || '';
            const throughput = transport.throughput_per_second || 0;

            const slug = machineIdToSlug(transportId);

            // Skip if already added
            if (this.seenItems.has(slug)) {
                continue;
            }

            // Extract icon filename from path
            const iconName = iconPath ? path.parse(iconPath).name : slug;

            // Determine transport category
            const transportCategory = 'logistics';
            this.categorySet.add(transportCategory);

            const item: Item = {
                id: slug,
                name: name,
                category: transportCategory,
                row: 0,
            };

            // Add belt or pipe property based on type
            if (throughput > 0) {
                if (transportId.toLowerCase().includes('pipe')) {
                    item.pipe = {
                        speed: throughput
                    };
                } else {
                    item.belt = {
                        speed: throughput
                    };
                }
            }

            this.items.push(item);
            this.seenItems.add(slug);

            // Track icon
            this.iconIdToFile.set(slug, iconName);
            this.icons.push({
                id: slug,
                position: '0px 0px',
            });
        }
    }

    buildCategories(): void {
        console.log('Building categories...');

        // Find first item in each category for icon
        const categoryFirstItem: Map<string, string> = new Map();
        for (const item of this.items) {
            const cat = item.category;
            if (!categoryFirstItem.has(cat)) {
                categoryFirstItem.set(cat, item.id);
            }
        }

        // All categories (items and recipes share categories)
        const categoryOrder = ['virtual', 'items', 'loose', 'fluids', 'molten', 'buildings', 'logistics', 'recipes'];
        for (const cat of categoryOrder) {
            if (this.categorySet.has(cat)) {
                const catEntry: Category = {
                    id: cat,
                    name: cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                };
                if (categoryFirstItem.has(cat)) {
                    catEntry.icon = categoryFirstItem.get(cat);
                }
                this.categories.push(catEntry);
            }
        }
    }

    async calculateAverageColorFromBuffer(imageBuffer: Buffer): Promise<string> {
        if (!HAS_SHARP) {
            return '#808080';
        }

        try {
            const { data, info } = await sharp(imageBuffer)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            let rTotal = 0;
            let gTotal = 0;
            let bTotal = 0;
            let count = 0;

            const pixelCount = info.width * info.height;
            for (let i = 0; i < pixelCount; i++) {
                const offset = i * info.channels;
                const r = data[offset];
                const g = data[offset + 1];
                const b = data[offset + 2];
                const a = data[offset + 3];

                // Only include pixels that aren't fully transparent
                if (a > 0) {
                    rTotal += r;
                    gTotal += g;
                    bTotal += b;
                    count++;
                }
            }

            if (count === 0) {
                return '#808080';
            }

            const rAvg = Math.floor(rTotal / count);
            const gAvg = Math.floor(gTotal / count);
            const bAvg = Math.floor(bTotal / count);

            return `#${rAvg.toString(16).padStart(2, '0')}${gAvg.toString(16).padStart(2, '0')}${bAvg.toString(16).padStart(2, '0')}`;
        } catch (error) {
            console.log(`  WARNING: Failed to calculate average color from buffer: ${error}`);
            return '#808080';
        }
    }

    async generateSpriteSheet(outputFolder: string, iconSize: number = 64): Promise<void> {
        if (!HAS_SHARP) {
            console.log('Skipping sprite sheet generation (sharp not available)');
            return;
        }

        if (!this.iconsFolder || !fs.existsSync(this.iconsFolder)) {
            console.log(`Icons folder not found: ${this.iconsFolder}`);
            console.log('Skipping sprite sheet generation');
            return;
        }

        console.log(`Generating sprite sheet from ${this.iconsFolder}...`);

        // Find all icon files (non-recursive)
        const iconFiles: Map<string, string> = new Map();
        const extensions = ['.png', '.PNG', '.webp', '.WEBP', '.svg', '.SVG'];

        const items = fs.readdirSync(this.iconsFolder);
        for (const item of items) {
            const fullPath = path.join(this.iconsFolder, item);
            const stat = fs.statSync(fullPath);
            if (!stat.isDirectory() && extensions.some(ext => item.endsWith(ext))) {
                const key = path.parse(item).name.toLowerCase();
                iconFiles.set(key, fullPath);
            }
        }

        console.log(`  Found ${iconFiles.size} icon files`);

        // Calculate sprite sheet dimensions (make it as square as possible)
        const numIcons = this.icons.length;
        const cols = Math.ceil(Math.sqrt(numIcons));
        const rows = Math.ceil(numIcons / cols);

        const sheetWidth = cols * iconSize;
        const sheetHeight = rows * iconSize;

        console.log(`  Creating ${sheetWidth}x${sheetHeight} sprite sheet (${cols}x${rows} icons)`);

        // Create base sprite sheet
        const spriteSheet = sharp({
            create: {
                width: sheetWidth,
                height: sheetHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        });

        const compositeOperations: any[] = [];

        // Place icons and update positions
        for (let idx = 0; idx < this.icons.length; idx++) {
            const icon = this.icons[idx];
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const x = col * iconSize;
            const y = row * iconSize;

            icon.position = `${-x}px ${-y}px`;

            // Get icon filename from hint
            const iconId = icon.id;
            const iconName = (this.iconIdToFile.get(iconId) || iconId).toLowerCase();

            if (iconFiles.has(iconName)) {
                const iconFilePath = iconFiles.get(iconName)!;
                try {
                    // Resize icon and prepare for composition
                    const resizedIcon = await sharp(iconFilePath)
                        .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .toBuffer();

                    compositeOperations.push({
                        input: resizedIcon,
                        top: y,
                        left: x
                    });

                    // Calculate average color from the resized icon
                    const avgColor = await this.calculateAverageColorFromBuffer(resizedIcon);
                    icon.color = avgColor;
                } catch (error) {
                    console.log(`  WARNING: Failed to load icon file '${iconFilePath}' for '${iconId}': ${error}`);
                }
            } else {
                console.log(`  WARNING: Icon not found for '${iconId}' (looking for: ${iconName})`);
            }
        }

        // Composite all icons onto the sprite sheet
        const outputPath = path.join(outputFolder, 'icons.webp');
        await spriteSheet
            .composite(compositeOperations)
            .webp({ quality: 90 })
            .toFile(outputPath);

        console.log(`  Saved sprite sheet to ${outputPath}`);
    }

    buildDefaults(): Defaults {
        const belts: Array<[string, number]> = [];
        const pipes: Array<[string, number]> = [];

        if (this.transportsData && this.transportsData.transports) {
            for (const transport of this.transportsData.transports) {
                const transportId = transport.id || '';
                const slug = machineIdToSlug(transportId);
                const throughput = transport.throughput_per_second || 0;

                // Categorize by type based on ID
                if (transportId.toLowerCase().includes('flatconveyor')) {
                    belts.push([slug, throughput]);
                } else if (transportId.toLowerCase().includes('pipe')) {
                    pipes.push([slug, throughput]);
                }
            }
        }

        // Sort by throughput and get min/max
        let minBelt: string | null = null;
        let maxBelt: string | null = null;
        if (belts.length > 0) {
            belts.sort((a, b) => a[1] - b[1]);
            minBelt = belts[0][0];
            maxBelt = belts[belts.length - 1][0];
        }

        let minPipe: string | null = null;
        let maxPipe: string | null = null;
        if (pipes.length > 0) {
            pipes.sort((a, b) => a[1] - b[1]);
            minPipe = pipes[0][0];
            maxPipe = pipes[pipes.length - 1][0];
        }

        return {
            modIds: [],
            beacon: null,
            minBelt,
            maxBelt,
            minPipe,
            maxPipe,
            fuel: null,
            disabledRecipes: [],
            minMachineRank: [],
            maxMachineRank: [],
            moduleRank: [],
        };
    }

    async generateOutput(outputFolder: string): Promise<void> {
        console.log(`Generating output to ${outputFolder}...`);

        if (!fs.existsSync(outputFolder)) {
            fs.mkdirSync(outputFolder, { recursive: true });
        }

        // Generate sprite sheet first (updates icon positions)
        await this.generateSpriteSheet(outputFolder);

        // Build final data structure - NO separate machines array!
        const data: OutputData = {
            version: this.productsData.game_version || '0.0.0',
            categories: this.categories,
            icons: this.icons,
            items: this.items,
            recipes: this.recipes,
            defaults: this.buildDefaults(),
        };

        // Write data.json
        const outputPath = path.join(outputFolder, 'data.json');
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

        console.log(`  Saved data.json to ${outputPath}`);
        console.log(`  Categories: ${this.categories.length}`);
        console.log(`  Icons: ${this.icons.length}`);
        console.log(`  Items (including machines): ${this.items.length}`);
        console.log(`  Recipes: ${this.recipes.length}`);

        // Count machines
        const machineCount = this.items.filter(item => 'machine' in item).length;
        console.log(`  Items with machine property: ${machineCount}`);
    }

    async convert(outputFolder: string): Promise<void> {
        this.loadData();
        this.buildLookups();
        this.convertProductsToItems();
        this.convertMachines();
        this.convertTransports();
        this.buildCategories();
        await this.generateOutput(outputFolder);
        console.log('\nConversion complete!');
    }
}

function parseArgs(): {
    data: string;
    icons?: string;
    output: string;
    iconSize: number;
} {
    const args = process.argv.slice(2);
    const result: any = {
        output: './factoriolab_output',
        iconSize: 64
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if ((arg === '--data' || arg === '-d') && i + 1 < args.length) {
            result.data = args[++i];
        } else if ((arg === '--icons' || arg === '-i') && i + 1 < args.length) {
            result.icons = args[++i];
        } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
            result.output = args[++i];
        } else if (arg === '--icon-size' && i + 1 < args.length) {
            result.iconSize = parseInt(args[++i], 10);
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Convert Captain of Industry data to FactorioLab format

Usage:
  node dist/main.js --data <directory> [options]

Required:
  --data, -d        Path to directory containing captain-of-data JSON files
                    (products.json, machines_and_buildings.json, transports.json)

Optional:
  --icons, -i       Path to folder containing icon images
  --output, -o      Output folder for data.json and icons.webp (default: ./factoriolab_output)
  --icon-size       Icon size in pixels (default: 64)
  --help, -h        Show this help message
            `);
            process.exit(0);
        }
    }

    if (!result.data) {
        console.error('Error: --data is required');
        console.error('Use --help for usage information');
        process.exit(1);
    }

    return result;
}

async function main() {
    const args = parseArgs();

    const converter = new COIToFactorioLabConverter(
        args.data,
        args.icons
    );

    await converter.convert(args.output);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}
