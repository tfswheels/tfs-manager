# TFS Wheels - Customer Communication System

Interactive script for generating dynamic customer communication messages with multi-level decision trees.

## Quick Start

```bash
cd "/Users/jeremiah/Desktop/TFS Wheels/TFS Wheels App/Customer Communication"
python customer_communication.py
```

## Current Templates

### 1. Incorrect Fitment

Handles cases where customer selected wheels that don't fit their vehicle.

**Flow:**
1. Enter order number
2. View order verification (name, email, address, vehicle, verify message)
3. Select fitment issue reason:
   - Incorrect Bolt Pattern
   - Offset
   - Other
4. Select solution:
   - Cancel order
   - Update order
5. Generate dynamic message with customer-specific details

**Example Usage:**
- Order: 62423812
- Issue: Bolt pattern mismatch
- Solution: Cancel or update with correct wheel

### 2. Order Processed - Ready for Fulfillment

Notify customers that their order has passed verification and is being processed.

**Features:**
- 2 different message tone options:
  1. Friendly & Personal
  2. Appreciative & Heartfelt
- Dynamically includes customer name, order number, vehicle info, and wheel details
- Prompts for missing information (wheel brand/model, vehicle info)
- Gracefully handles missing information if not provided
- Sets expectations for review requests (7-10 days after delivery)
- Encourages both public and private feedback

**Flow:**
1. Enter order number
2. View order verification
3. If wheel/vehicle info missing, prompt to enter it (or skip)
4. Select message draft style (1-2)
5. Review generated message
6. Copy to clipboard or save to file

### 3. Vehicle Information Request

Request vehicle information from customers who placed orders without providing it.

**Features:**
- Automatically detects wheel count to determine message type:
  - Single wheel (qty=1): FINAL SALE message
  - Multiple wheels (qty>1): Return responsibility message (20-30% restocking fee)
- Dynamically includes wheel description
- Prompts for missing wheel brand/model if not in order
- 5 business day response deadline
- Clear explanation of fitment risks

**Flow:**
1. Enter order number
2. View order verification
3. System automatically counts wheels in order
4. If wheel info missing, prompt to enter it (or skip)
5. Review generated message (with appropriate single/multiple wheel terms)
6. Copy to clipboard or save to file

## How It Works

1. **Request Order Number** - Enter order ID (e.g., 62423812)
2. **Load Order Info** - Fetches from Shopify:
   - Customer name, email
   - Shipping address
   - Vehicle info
   - Line items with metafields
3. **Display Verification** - Shows all order details for review
4. **Select Template** - Choose communication type
5. **Interactive Decision Tree** - Answer questions to build message
6. **Generate Message** - Creates personalized message
7. **Copy/Save** - Copy to clipboard or save to file

## Metafields Used

- `convermax.wheel_bolt_pattern` - Wheel bolt pattern (e.g., "5x114.3")
- `convermax.wheel_offset` - Wheel offset (e.g., "+35")
- `custom.hubbore` - Hub bore size
- `custom.wheel_model` - Wheel model name (e.g., "Rebel", "Shadow")
- `vendor` - Product field for brand/manufacturer name

## Requirements

- Python 3.7+
- Shopify API access token in `.env` file
- `requests` and `python-dotenv` packages

Install dependencies:
```bash
pip install -r requirements.txt
```

## Future Templates

Additional templates can be added to the system following the same flow pattern.
