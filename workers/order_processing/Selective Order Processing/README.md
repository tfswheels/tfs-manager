 # Selective Order Processing

This script helps reduce errors when processing orders by allowing you to interactively select which items from each order should be included in the processing document.

## Purpose

Sometimes you only need to process specific items from an order, not all of them. This script:
- Lets you review each line item one by one
- Choose which items to include (Y/n for each)
- Generates professional PDFs with only the selected items
- Intelligently handles accessories separately from regular items
- Automatically retrieves vehicle information and wheel specifications
- Organizes each order in its own folder

## Installation

Install the required Python packages:

```bash
pip install python-docx reportlab pillow
```

## Usage

Simply run the script:

```bash
python selective_order_processing.py
```

The script will guide you through:

1. **Enter Order Numbers**: Provide one or more order numbers (comma or space separated)
   - Example: `62423210, 62423311`
   - Example: `#1001 #1002`

2. **Accessories Mode Selection**: If the order contains accessories, choose how to process them:
   - Process accessories WITH regular items (creates separate PDFs for each)
   - Process accessories ONLY
   - Process regular items ONLY (skip accessories)

3. **Review Each Item**: For each order, you'll see each line item with:
   - Product name
   - SKU
   - Variant (if applicable)
   - Quantity
   - [ACCESSORY] tag if item is an accessory
   - Prompt: "Include this item? (Y/n)"

4. **PDF Generation**: After selecting items, PDFs are automatically created

## Example Session

```
============================================================
SELECTIVE ORDER PROCESSING
============================================================

Enter order numbers (separated by commas or spaces)
Example: 62423210, 62423311 or #1001 #1002

Order IDs: 62423210, 62423311

Found 2 order(s): 62423210, 62423311

📦 Fetching order #62423210...
   ✅ Order #62423210 retrieved
   Vehicle: 2020 Honda CR-V EX AWD

============================================================
Processing PO #62423210
============================================================

  This order contains accessories.
  How would you like to process them?
    1. Process accessories WITH regular items (separate PDFs)
    2. Process accessories ONLY
    3. Process regular items ONLY (skip accessories)
  Enter choice (1/2/3): 1

Item 1/5:
  Product: 4Play OE Wheels CV41B 22x9 +24 Gloss Black
  SKU: CV41B-22090-6550-24B
  Quantity: 4
  Include this item? (Y/n): y
    ✓ Item included

Item 2/5:
  Product: TPMS Sensors - Set of 4 - Black Stem
  SKU: TPMS-2
  Variant: Black Stem
  Quantity: 1
  [ACCESSORY]
  Include this item? (Y/n): y
    ✓ Item included

Item 3/5:
  Product: Wheel Installation Kit - Black
  SKU:
  Variant: Black
  Quantity: 1
  [ACCESSORY]
  Include this item? (Y/n): y
    ✓ Item included

   Selected 1 regular item(s) for processing

   Generating PDF...
  PDF created: /path/to/PO_62423210/62423210_20260102_143052.pdf

   Processing 2 accessory/accessories...

   Generating accessories PDF...
  PDF created: /path/to/PO_62423210/62423210_accessories_20260102_143052.pdf
```

## Output Structure

Each order gets its own folder with timestamped PDFs:

```
Selective Order Processing/
├── selective_order_processing.py
├── README.md
├── tfs_logo.png (cached)
├── PO_62423210/
│   ├── 62423210_20260102_143052.pdf (wheels)
│   ├── 62423210_accessories_20260102_143052.pdf (accessories)
│   └── 62423210_20260102_150330.pdf (if run again)
└── PO_62423311/
    └── 62423311_20260102_143115.pdf
```

## PDF Format

### Regular Items PDF
- **TFS Wheels Logo** and contact information
- **Date**
- **PO Box** with:
  - PO number header
  - Items table (Product, SKU, Qty)
  - Shipping address (compact format)

### Accessories PDF
- **TFS Wheels Logo** and contact information
- **Date**
- **PO Box** with:
  - PO number header
  - Bulleted list of accessories with special formatting:
    - Installation Kits automatically split into "Lugs" and "Hub Rings"
    - Hub Rings include hubbore specifications (auto-retrieved from wheel products)
    - Variant information included where applicable
  - Vehicle information (if available)
  - Shipping address (compact format)

## Features

- **Interactive Selection**: Review each item before including
- **Smart Accessories Handling**: Automatically detects accessories and offers three processing modes
- **Auto-Skip Shipping Protection**: Shipping protection items are automatically excluded
- **Vehicle Information**: Automatically extracts vehicle info from line items, order notes, or custom attributes
- **Hubbore Auto-Retrieval**: Automatically retrieves hubbore specifications from wheel products for hub rings
- **Installation Kit Parsing**: Automatically splits installation kits into "Lugs" and "Hub Rings" components
- **Intelligent Wheel Detection**: Identifies wheels by tags, product type, or name
- **Error Reduction**: Only process what you need
- **Organization**: Each order in its own folder with separate PDFs for regular items and accessories
- **Timestamped Files**: Multiple runs won't overwrite previous files
- **Professional PDFs**: Clean, formatted PDFs ready for processing
- **Skip Empty Orders**: Won't create PDFs if no items selected

## Notes

- Uses the same .env file for Shopify credentials
- Logo is downloaded and cached on first run
- Press Ctrl+C at any time to cancel
- Default is "Yes" - just press Enter to include an item
- Accessories are detected by the "accessories" tag in Shopify
- Wheels are detected by "wheels" tag, product type containing "wheel", or name containing "wheel"
- Vehicle information is extracted from:
  1. Line item custom attributes (vehicle field)
  2. Order notes (looking for "Vehicle: ..." pattern)
  3. Order custom attributes (vehicle field)
- Hubbore values are retrieved from the product's `custom.hubbore` metafield in Shopify
