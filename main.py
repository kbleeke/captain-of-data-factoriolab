#!/usr/bin/env python3
"""
Convert Captain of Industry data from captain-of-data mod to FactorioLab format.

Usage:
    python convert_coi_to_factoriolab.py --products products.json --machines machines_and_buildings.json --icons icons_folder --output output_folder

This script converts the JSON files exported by the captain-of-data mod into the 
data.json and icons.webp files required by FactorioLab.

FactorioLab format notes:
- There is NO separate "machines" array
- Machines are items with a "machine" property
- Icons should be .webp format
"""

import json
import os
import re
import argparse
from pathlib import Path
from typing import Any, Optional

# Optional: PIL for sprite sheet generation
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("Warning: PIL/Pillow not installed. Sprite sheet generation will be skipped.")
    print("Install with: pip install Pillow")


def slugify(name: str) -> str:
    """Convert a display name to a slug/id format."""
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug


def product_id_to_slug(product_id: str) -> str:
    """Convert product ID (e.g., Product_IronOre) to slug (iron-ore)."""
    if product_id.startswith("Product_"):
        product_id = product_id[8:]
    
    # Handle "Virtual_" prefix
    if product_id.startswith("Virtual_"):
        virtual_part = product_id[8:]
        slug = re.sub(r'([a-z])([A-Z])', r'\1-\2', virtual_part)
        slug = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1-\2', slug)
        return slug.lower()
    
    slug = re.sub(r'([a-z])([A-Z])', r'\1-\2', product_id)
    slug = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1-\2', slug)
    return slug.lower()


def machine_id_to_slug(machine_id: str) -> str:
    """Convert machine ID to slug format."""
    slug = re.sub(r'([a-z])([A-Z])', r'\1-\2', machine_id)
    slug = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1-\2', slug)
    return slug.lower()


class COIToFactorioLabConverter:
    def __init__(self, products_file: str, machines_file: str, transports_file: str = None, icons_folder: str = None):
        self.products_file = products_file
        self.machines_file = machines_file
        self.transports_file = transports_file
        self.icons_folder = icons_folder

        self.products_data = {}
        self.machines_data = {}
        self.transports_data = {}
        
        # Lookup tables
        self.product_name_to_id = {}  # "Iron ore" -> "iron-ore"
        self.product_id_to_name = {}  # "iron-ore" -> "Iron ore"
        self.machine_id_to_slug = {}  # "FoodMill" -> "food-mill"
        
        # Output data
        self.categories = []
        self.icons = []
        self.items = []
        self.recipes = []
        
        # Track what we've seen
        self.seen_items = set()
        self.seen_recipes = set()
        self.recipe_names = {}  # Track recipe names to detect duplicates
        self.category_set = set()
        
        # Icon tracking
        self.icon_id_to_file = {}
        
    def load_data(self):
        """Load the JSON data files."""
        print(f"Loading products from {self.products_file}...")
        with open(self.products_file, 'r', encoding='utf-8') as f:
            self.products_data = json.load(f)

        print(f"Loading machines from {self.machines_file}...")
        with open(self.machines_file, 'r', encoding='utf-8') as f:
            self.machines_data = json.load(f)

        if self.transports_file:
            print(f"Loading transports from {self.transports_file}...")
            with open(self.transports_file, 'r', encoding='utf-8') as f:
                self.transports_data = json.load(f)

        print(f"  Game version: {self.products_data.get('game_version', 'unknown')}")
        print(f"  Products: {len(self.products_data.get('products', []))}")
        print(f"  Machines: {len(self.machines_data.get('machines_and_buildings', []))}")
        if self.transports_file:
            print(f"  Transports: {len(self.transports_data.get('transports', []))}")
    
    def build_lookups(self):
        """Build lookup tables for products and machines."""
        print("Building lookup tables...")
        
        for product in self.products_data.get('products', []):
            product_id = product.get('id', '')
            name = product.get('name', '')
            slug = product_id_to_slug(product_id)
            
            self.product_name_to_id[name] = slug
            self.product_id_to_name[slug] = name
        
        for machine in self.machines_data.get('machines_and_buildings', []):
            machine_id = machine.get('id', '')
            slug = machine_id_to_slug(machine_id)
            self.machine_id_to_slug[machine_id] = slug
    
    def convert_products_to_items(self):
        """Convert products to FactorioLab items."""
        print("Converting products to items...")
        
        type_to_category = {
            'VirtualProductProto': 'virtual',
            'CountableProductProto': 'items',
            'LooseProductProto': 'loose',
            'FluidProductProto': 'fluids',
            'MoltenProductProto': 'molten',
        }
        
        for product in self.products_data.get('products', []):
            product_id = product.get('id', '')
            name = product.get('name', '')
            product_type = product.get('type', '')
            icon_path = product.get('icon_path', '')

            # Extract icon filename from path (e.g., "Assets/Base/Products/Icons/Wood.svg" -> "Wood")
            icon_name = Path(icon_path).stem if icon_path else product_id_to_slug(product_id)

            slug = product_id_to_slug(product_id)
            category = type_to_category.get(product_type, 'items')

            self.category_set.add(category)

            item = {
                'id': slug,
                'name': name,
                'category': category,
                'row': 0,
            }

            if product_type == 'CountableProductProto':
                item['stack'] = 1
            
            self.items.append(item)
            self.seen_items.add(slug)

            # Track icon
            self.icon_id_to_file[slug] = icon_name
            self.icons.append({
                'id': slug,
                'position': '0px 0px',
            })
    
    def convert_machines(self):
        """Convert machines/buildings to items with machine property and extract recipes."""
        print("Converting machines and extracting recipes...")

        for machine in self.machines_data.get('machines_and_buildings', []):
            machine_id = machine.get('id', '')
            name = machine.get('name', '')
            machine_category_raw = machine.get('category', 'General')
            electricity = machine.get('electricity_consumed', 0)
            workers = machine.get('workers', 0)
            computing = machine.get('computing_consumed', 0)
            maintenance_units = machine.get('maintenance_cost_units', '')
            maintenance_quantity = machine.get('maintenance_cost_quantity', 0)
            recipes = machine.get('recipes', [])
            icon_path = machine.get('icon_path', '')

            slug = machine_id_to_slug(machine_id)
            machine_category = "buildings"

            # Skip if no recipes (storage buildings, etc.)
            if not recipes:
                continue

            self.category_set.add(machine_category)

            # Add machine as an item with machine property
            if slug not in self.seen_items:
                item = {
                    'id': slug,
                    'name': name,
                    'category': machine_category,
                    'row': 0,
                    'machine': {
                        'speed': 1,  # Base speed multiplier
                    }
                }

                # Add power usage if electric
                if electricity > 0:
                    item['machine']['type'] = 'electric'
                    item['machine']['usage'] = electricity  # kW

                # Build consumption dictionary for maintenance, computing, and workers
                consumption = {}

                # if maintenance_quantity > 0 and maintenance_units:
                #     # Convert maintenance units to product slug
                #     maintenance_slug = self.product_name_to_id.get(maintenance_units, slugify(maintenance_units))
                #     consumption[maintenance_slug] = maintenance_quantity

                # if computing > 0:
                #     # Computing is consumed as "Computing" product
                #     computing_slug = self.product_name_to_id.get('Computing', 'computing')
                #     consumption[computing_slug] = computing

                # if workers > 0:
                #     # Workers are consumed as "Workers" product
                #     workers_slug = self.product_name_to_id.get('Workers', 'workers')
                #     consumption[workers_slug] = workers

                # Add consumption to machine if any
                if consumption:
                    item['machine']['consumption'] = consumption

                self.items.append(item)
                self.seen_items.add(slug)
                
                # Track icon from machine icon_path
                icon_name = Path(icon_path).stem if icon_path else slug
                self.icon_id_to_file[slug] = icon_name
                self.icons.append({
                    'id': slug,
                    'position': '0px 0px',
                })
            
            # Extract recipes from this machine
            for recipe in recipes:
                self.convert_recipe(recipe, slug)

    def convert_recipe(self, recipe: dict, producer_id: str):
        """Convert a single recipe to FactorioLab format."""
        recipe_id = recipe.get('id', '')
        name = recipe.get('name', '')
        duration = recipe.get('duration', 1)
        inputs = recipe.get('inputs', [])
        outputs = recipe.get('outputs', [])

        slug = machine_id_to_slug(recipe_id)

        # If recipe already exists, just add this producer
        if slug in self.seen_recipes:
            for r in self.recipes:
                if r['id'] == slug:
                    if producer_id not in r['producers']:
                        r['producers'].append(producer_id)
            return

        # Build input/output dictionaries
        recipe_in = {}
        for inp in inputs:
            inp_name = inp.get('name', '')
            inp_qty = inp.get('quantity', 1)
            inp_id = self.product_name_to_id.get(inp_name, slugify(inp_name))
            recipe_in[inp_id] = inp_qty

        recipe_out = {}
        for out in outputs:
            out_name = out.get('name', '')
            out_qty = out.get('quantity', 1)
            out_id = self.product_name_to_id.get(out_name, slugify(out_name))
            recipe_out[out_id] = out_qty

        # Determine recipe icon: first output, or first input if no outputs
        recipe_icon = None
        if recipe_out:
            recipe_icon = next(iter(recipe_out.keys()))
        elif recipe_in:
            recipe_icon = next(iter(recipe_in.keys()))

        # Determine recipe category based on first output or first input
        recipe_category = None
        if recipe_icon:
            # Find the item to get its category
            for item in self.items:
                if item['id'] == recipe_icon:
                    recipe_category = item['category']
                    break

        # Fallback to 'recipes' category if not found
        if not recipe_category:
            recipe_category = 'recipes'

        self.category_set.add(recipe_category)

        # Make recipe name unique by appending first unique input if there's a duplicate
        unique_name = name
        if name in self.recipe_names:
            # Find the original recipe's inputs
            original_recipe_id = self.recipe_names[name]
            original_recipe = next((r for r in self.recipes if r['id'] == original_recipe_id), None)

            if original_recipe:
                # Update the original recipe's name to include its distinguishing input
                original_inputs = set(original_recipe.get('in', {}).keys())
                original_distinguishing = None

                # Find first input in original that's different from current recipe
                current_inputs = set(recipe_in.keys()) if recipe_in else set()
                for inp_id in original_inputs:
                    if inp_id not in current_inputs:
                        original_distinguishing = inp_id
                        break

                # If all inputs are the same or no difference found, use first input of original
                if not original_distinguishing and original_inputs:
                    original_distinguishing = next(iter(original_inputs))

                if original_distinguishing:
                    original_input_name = self.product_id_to_name.get(original_distinguishing, original_distinguishing)
                    original_recipe['name'] = f"{name} ({original_input_name})"

                # Now update current recipe's name
                if recipe_in:
                    # Find first input that's different from the original recipe
                    distinguishing_input = None
                    for inp_id in recipe_in.keys():
                        if inp_id not in original_inputs:
                            distinguishing_input = inp_id
                            break

                    # If all inputs are the same, use the first input anyway
                    if not distinguishing_input and recipe_in:
                        distinguishing_input = next(iter(recipe_in.keys()))

                    if distinguishing_input:
                        input_name = self.product_id_to_name.get(distinguishing_input, distinguishing_input)
                        unique_name = f"{name} ({input_name})"
        else:
            self.recipe_names[name] = slug

        # Create recipe entry
        recipe_entry = {
            'id': slug,
            'name': unique_name,
            'category': recipe_category,
            'row': 0,
            'time': duration,
            'producers': [producer_id],
            'cost': 100,
        }

        if recipe_icon:
            recipe_entry['icon'] = recipe_icon

        if recipe_in:
            recipe_entry['in'] = recipe_in
        else:
            recipe_entry['in'] = {}

        if recipe_out:
            recipe_entry['out'] = recipe_out
        else:
            recipe_entry['out'] = {}

        self.recipes.append(recipe_entry)
        self.seen_recipes.add(slug)

    def convert_transports(self):
        """Convert transports (belts, pipes, etc.) to items."""
        if not self.transports_data:
            return

        print("Converting transports...")

        for transport in self.transports_data.get('transports', []):
            transport_id = transport.get('id', '')
            name = transport.get('name', '')
            icon_path = transport.get('icon_path', '')
            throughput = transport.get('throughput_per_second', 0)

            slug = machine_id_to_slug(transport_id)

            # Skip if already added
            if slug in self.seen_items:
                continue

            # Extract icon filename from path
            icon_name = Path(icon_path).stem if icon_path else slug

            # Determine transport category
            transport_category = 'logistics'
            self.category_set.add(transport_category)

            item = {
                'id': slug,
                'name': name,
                'category': transport_category,
                'row': 0,
            }

            # Add belt or pipe property based on type
            if throughput > 0:
                if 'pipe' in transport_id.lower():
                    item['pipe'] = {
                        'speed': throughput
                    }
                else:
                    item['belt'] = {
                        'speed': throughput
                    }

            self.items.append(item)
            self.seen_items.add(slug)

            # Track icon
            self.icon_id_to_file[slug] = icon_name
            self.icons.append({
                'id': slug,
                'position': '0px 0px',
            })

    def build_categories(self):
        """Build category list from collected categories."""
        print("Building categories...")

        # Find first item in each category for icon
        category_first_item = {}
        for item in self.items:
            cat = item['category']
            if cat not in category_first_item:
                category_first_item[cat] = item['id']

        # All categories (items and recipes share categories)
        category_order = ['virtual', 'items', 'loose', 'fluids', 'molten', 'buildings', 'logistics', 'recipes']
        for cat in category_order:
            if cat in self.category_set:
                cat_entry = {
                    'id': cat,
                    'name': cat.replace('-', ' ').title()
                }
                if cat in category_first_item:
                    cat_entry['icon'] = category_first_item[cat]
                self.categories.append(cat_entry)
    
    def calculate_average_color(self, img: Image.Image) -> str:
        """Calculate the average color of an image, ignoring fully transparent pixels."""
        # Convert to RGBA if not already
        img = img.convert('RGBA')
        pixels = img.getdata()

        r_total = 0
        g_total = 0
        b_total = 0
        count = 0

        for pixel in pixels:
            # Only include pixels that aren't fully transparent
            if pixel[3] > 0:  # Alpha > 0
                r_total += pixel[0]
                g_total += pixel[1]
                b_total += pixel[2]
                count += 1

        if count == 0:
            # Fallback for fully transparent images
            return '#808080'

        r_avg = int(r_total / count)
        g_avg = int(g_total / count)
        b_avg = int(b_total / count)

        return f'#{r_avg:02x}{g_avg:02x}{b_avg:02x}'

    def generate_sprite_sheet(self, output_folder: str, icon_size: int = 64):
        """Generate icons.webp sprite sheet from individual icon files."""
        if not HAS_PIL:
            print("Skipping sprite sheet generation (PIL not available)")
            return

        if not self.icons_folder or not os.path.exists(self.icons_folder):
            print(f"Icons folder not found: {self.icons_folder}")
            print("Skipping sprite sheet generation")
            return

        print(f"Generating sprite sheet from {self.icons_folder}...")

        # Find all icon files
        icon_files = {}
        for ext in ['*.png', '*.PNG', '*.webp', '*.WEBP', '*.svg', '*.SVG']:
            for f in Path(self.icons_folder).rglob(ext):
                key = f.stem.lower()
                icon_files[key] = str(f)

        print(f"  Found {len(icon_files)} icon files")

        # Calculate sprite sheet dimensions
        num_icons = len(self.icons)
        cols = 16
        rows = (num_icons + cols - 1) // cols

        sheet_width = cols * icon_size
        sheet_height = rows * icon_size

        print(f"  Creating {sheet_width}x{sheet_height} sprite sheet ({cols}x{rows} icons)")

        sprite_sheet = Image.new('RGBA', (sheet_width, sheet_height), (0, 0, 0, 0))

        # Place icons and update positions
        for idx, icon in enumerate(self.icons):
            col = idx % cols
            row = idx // cols
            x = col * icon_size
            y = row * icon_size

            icon['position'] = f"{-x}px {-y}px"

            # Get icon filename from hint (extracted from icon_path)
            icon_id = icon['id']
            icon_name = self.icon_id_to_file.get(icon_id, icon_id).lower()

            if icon_name in icon_files:
                try:
                    img = Image.open(icon_files[icon_name])
                    img = img.convert('RGBA')
                    img = img.resize((icon_size, icon_size), Image.Resampling.LANCZOS)

                    # Calculate average color for this icon
                    avg_color = self.calculate_average_color(img)
                    icon['color'] = avg_color

                    sprite_sheet.paste(img, (x, y))
                except Exception as e:
                    print(f"  WARNING: Failed to load icon file '{icon_files[icon_name]}' for '{icon_id}': {e}")
            else:
                print(f"  WARNING: Icon not found for '{icon_id}' (looking for: {icon_name})")

        # Save as WebP
        output_path = os.path.join(output_folder, 'icons.webp')
        sprite_sheet.save(output_path, 'WEBP', quality=90)
        print(f"  Saved sprite sheet to {output_path}")
    
    def build_defaults(self):
        """Build sensible defaults for the calculator."""
        # Find min/max belts and pipes from transports
        belts = []
        pipes = []

        if self.transports_data:
            for transport in self.transports_data.get('transports', []):
                transport_id = transport.get('id', '')
                slug = machine_id_to_slug(transport_id)
                throughput = transport.get('throughput_per_second', 0)

                # Categorize by type based on ID
                # Only use flat conveyors for belts (not U-shape/LooseMaterial conveyors)
                if 'flatconveyor' in transport_id.lower():
                    belts.append((slug, throughput))
                elif 'pipe' in transport_id.lower():
                    pipes.append((slug, throughput))

        # Sort by throughput and get min/max
        min_belt = None
        max_belt = None
        if belts:
            belts.sort(key=lambda x: x[1])
            min_belt = belts[0][0]
            max_belt = belts[-1][0]

        min_pipe = None
        max_pipe = None
        if pipes:
            pipes.sort(key=lambda x: x[1])
            min_pipe = pipes[0][0]
            max_pipe = pipes[-1][0]

        return {
            'modIds': [],
            'beacon': None,
            'minBelt': min_belt,
            'maxBelt': max_belt,
            'minPipe': min_pipe,
            'maxPipe': max_pipe,
            'fuel': None,
            'disabledRecipes': [],
            'minMachineRank': [],
            'maxMachineRank': [],
            'moduleRank': [],
        }
    
    def generate_output(self, output_folder: str):
        """Generate the final data.json file."""
        print(f"Generating output to {output_folder}...")
        
        os.makedirs(output_folder, exist_ok=True)
        
        # Generate sprite sheet first (updates icon positions)
        self.generate_sprite_sheet(output_folder)
        
        # Build final data structure - NO separate machines array!
        data = {
            'version': self.products_data.get('game_version', '0.0.0'),
            'categories': self.categories,
            'icons': self.icons,
            'items': self.items,
            'recipes': self.recipes,
            'defaults': self.build_defaults(),
        }
        
        # Write data.json
        output_path = os.path.join(output_folder, 'data.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        
        print(f"  Saved data.json to {output_path}")
        print(f"  Categories: {len(self.categories)}")
        print(f"  Icons: {len(self.icons)}")
        print(f"  Items (including machines): {len(self.items)}")
        print(f"  Recipes: {len(self.recipes)}")
        
        # Count machines
        machine_count = sum(1 for item in self.items if 'machine' in item)
        print(f"  Items with machine property: {machine_count}")
    
    def convert(self, output_folder: str):
        """Run the full conversion process."""
        self.load_data()
        self.build_lookups()
        self.convert_products_to_items()
        self.convert_machines()
        self.convert_transports()
        self.build_categories()
        self.generate_output(output_folder)
        print("\nConversion complete!")


def main():
    parser = argparse.ArgumentParser(
        description='Convert Captain of Industry data to FactorioLab format'
    )
    parser.add_argument(
        '--products', '-p',
        required=True,
        help='Path to products.json from captain-of-data mod'
    )
    parser.add_argument(
        '--machines', '-m',
        required=True,
        help='Path to machines_and_buildings.json from captain-of-data mod'
    )
    parser.add_argument(
        '--transports', '-t',
        default=None,
        help='Path to transports.json from captain-of-data mod (optional)'
    )
    parser.add_argument(
        '--icons', '-i',
        default=None,
        help='Path to folder containing icon images (optional)'
    )
    parser.add_argument(
        '--output', '-o',
        default='./factoriolab_output',
        help='Output folder for data.json and icons.webp'
    )
    parser.add_argument(
        '--icon-size',
        type=int,
        default=64,
        help='Icon size in pixels (default: 64)'
    )
    
    args = parser.parse_args()
    
    converter = COIToFactorioLabConverter(
        products_file=args.products,
        machines_file=args.machines,
        transports_file=args.transports,
        icons_folder=args.icons
    )
    
    converter.convert(args.output)


if __name__ == '__main__':
    main()