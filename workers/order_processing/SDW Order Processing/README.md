# SDW Order Automation

Automates order processing from Shopify to SD Wheel Wholesale (SDW).

## Setup

### 1. Add Credit Cards to .env

Open `/Users/jeremiah/Desktop/TFS Wheels/Scripts/.env` and add your credit cards:

```bash
# Card 1 - Test Card (for testing)
CARD_1_NAME=Test Card
CARD_1_NUMBER=4111111111111111
CARD_1_EXP=12/25
CARD_1_CVV=123
CARD_1_ZIP=82801

# Card 2 - Real Card Example
CARD_2_NAME=Business Visa
CARD_2_NUMBER=YOUR_CARD_NUMBER
CARD_2_EXP=MM/YY
CARD_2_CVV=XXX
CARD_2_ZIP=82801
```

See `env_cards_template.txt` for more examples.

### 2. Install Dependencies

```bash
cd "/Users/jeremiah/Desktop/TFS Wheels/Scripts/Order Management/SDW Order Processing"
pip install seleniumbase requests python-dotenv capsolver beautifulsoup4
```

## Usage

### Running the Script

```bash
python sdw_order_automation.py
```

### Workflow

1. **Enter Shopify Order Number**
   - Script fetches order from Shopify
   - Validates shipping address
   - Checks if previously processed

2. **Select Processing Mode**
   - **Option 1: Custom Quote** - Use when you have a quote link from SDW
   - **Option 2: Manual Search** - Not yet implemented

3. **For Custom Quote Mode:**
   - Paste the quote link (e.g., `https://www.sdwheelwholesale.com/cart/quote/695ff5b5b7b69`)
   - Select which credit card to use

4. **Automation Process:**
   - ✅ Opens quote in browser
   - ✅ Validates SKU and quantity match Shopify order
   - ✅ Unchecks shipping protection
   - ✅ Sets all additional options to "No"
   - ✅ Fills billing information (your business info)
   - ✅ Fills shipping information (customer's address)
   - ✅ Shows order summary
   - ✅ Asks for confirmation
   - ✅ Fills payment information (card number, exp, CVV, zip)
   - ✅ Submits order
   - ✅ Gets invoice number (auto-detect or manual entry)
   - ✅ Tags Shopify order with "sdw_processed" and invoice number
   - ✅ Adds timeline comment to Shopify order
   - ✅ Creates order folder: `[shopify_order]_[sdw_invoice]/`
   - ✅ Saves processing log JSON with all details

## Testing

### Test with Demo Order

Use the provided demo quote link for order **#62423736**:
```
https://www.sdwheelwholesale.com/cart/quote/695ff5b5b7b69
```

**IMPORTANT**: Use a test/dummy card for initial testing to avoid actual charges!

The script will:
1. Load the quote
2. Validate SKU `98290286501`
3. Check quantity = 1
4. Fill all forms (billing + shipping)
5. Show order summary and ask for confirmation
6. Fill payment information (card, exp, CVV, zip)
7. Submit the order
8. Capture invoice number
9. Tag Shopify order
10. Create folder with processing log

Press Enter to close the browser after completion.

## Current Status

### ✅ Completed Features - Custom Quote Mode
- Shopify order fetching via GraphQL
- Address validation (checks for invalid addresses)
- Duplicate processing detection
- Credit card management from .env
- Quote link validation
- SKU/quantity validation against Shopify order
- Cart modifications (uncheck protection, set options to "No")
- Form filling (billing + shipping with business/residential detection)
- Order summary display
- User confirmation prompts
- Payment form filling (card number, exp, CVV, zip)
- Order submission
- Invoice number capture (auto-detect or manual entry)
- Shopify order tagging (`sdw_processed` + invoice number)
- Timeline comment to Shopify order note field
- Order folder creation: `[shopify_order]_[sdw_invoice]/`
- Processing log JSON with complete details

### 🔜 To Do
- Manual search mode implementation
- Handle multiple items in one order
- Handle wheels vs tires separately
- Add PDF screenshot/save of confirmation page (optional)

## Folder Structure

After successful processing, folders will be created:

```
SDW Order Processing/
├── 62423736_7954635/          # Shopify order # + SDW invoice #
│   ├── processing_log.json    # Processing details
│   └── order_confirmation.pdf # (if available)
├── 62423737_7954636/
│   └── ...
└── ...
```

## Items Automatically Skipped

The script automatically skips these items from Shopify orders:
- Installation Kit
- Shipping Protection
- Centric Rings
- Mount & Balance
- Hub Centric

These won't be searched/validated when processing.

## Billing Information

Hardcoded in script (always used):
```
Name: Jeremiah Chukwu
Address: 1309 Coffeen Avenue
City: Sheridan
State: Wyoming
Zip: 82801
Email: jeremiah@autopartspalace.com
Who Sent You: Customer Service
Phone: [Customer's phone from Shopify order]
```

Shipping info comes from the Shopify order.

## Next Steps

1. **Test with demo order #62423736 and quote link** (IMPORTANT: Use test card!)
2. **Verify the complete flow works end-to-end:**
   - Forms filled correctly
   - Order summary matches Shopify
   - Payment processes successfully
   - Invoice number captured
   - Shopify order tagged correctly
   - Folder and log created
3. **Once validated with test card, add real credit cards to .env**
4. **Then implement Manual Search Mode** for orders without pre-made quotes

## Troubleshooting

### "No credit cards found in .env"
- Add cards to `.env` file as shown above

### "Order not found"
- Check order number is correct
- Verify Shopify credentials in `.env`

### "Address validation failed"
- Check shipping address in Shopify
- Address line 1 cannot be just a number (e.g., "1111")

### Browser doesn't open
- Make sure ChromeDriver is installed
- Check SeleniumBase installation

## Support

For issues or questions, check:
- Console output for detailed error messages
- Browser window for visual feedback
- Address validation warnings before processing
