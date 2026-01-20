#!/usr/bin/env python3
"""
Non-Interactive SDW Automation Library
Wraps the interactive SDW script for programmatic use
"""

import sys
import os
from pathlib import Path

# Add SDW script to path - use local copy in same directory
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

# Import all the functions from the original script
from sdw_order_automation import (
    get_order_by_name,
    validate_address,
    extract_vehicle_info,
    parse_vehicle_info,
    get_db_connection,
    BILLING_INFO,
    STATE_MAPPING,
    SKIP_ITEMS,
    Driver,
    should_skip_item
)

# Import the core processing functions
import sdw_order_automation as sdw


def get_card_info_by_id(card_id):
    """
    Get card information by card ID (1-5)
    Returns card info dict matching the format expected by the SDW script
    Loads from environment variables (CARD_1_NAME, CARD_1_NUMBER, etc.)
    """
    # Convert string card_id to int
    try:
        card_num = int(card_id)
    except (ValueError, TypeError):
        return None

    # Load card info from environment variables (same format as original script)
    card_name = os.environ.get(f'CARD_{card_num}_NAME')
    if not card_name:
        return None

    card_number = os.environ.get(f'CARD_{card_num}_NUMBER')
    card_info = {
        'name': card_name,
        'number': card_number,
        'exp': os.environ.get(f'CARD_{card_num}_EXP'),
        'cvv': os.environ.get(f'CARD_{card_num}_CVV'),
        'zip': os.environ.get(f'CARD_{card_num}_ZIP'),
        'last4': card_number[-4:] if card_number else ''
    }

    return card_info


def process_sdw_order_non_interactive(
    order_number,
    vehicle_info=None,
    card_id='1',
    mode='manual',
    quote_link=None,
    selected_line_items=None,
    headless=False
):
    """
    Process an order on SDW without any interactive prompts

    Args:
        order_number (str): Shopify order number (e.g., "62423850")
        vehicle_info (str): Vehicle info string (e.g., "2017 Lincoln Continental Select FWD")
        card_id (str): Card ID (1-5)
        mode (str): Processing mode ('quote' or 'manual')
        quote_link (str): Quote link (required if mode='quote')
        selected_line_items (list): List of line item IDs to process (optional)
        headless (bool): Run browser in headless mode

    Returns:
        dict: Result dictionary with success status and details
    """

    result = {
        'success': False,
        'order_number': order_number,
        'message': '',
        'error': None,
        'total_price': None,
        'confirmation': None
    }

    try:
        print(f"\n{'='*60}")
        print(f"SDW ORDER AUTOMATION (NON-INTERACTIVE)")
        print(f"{'='*60}")
        print(f"Order: #{order_number}")
        print(f"Mode: {mode}")
        print(f"Card: {card_id}")
        if vehicle_info:
            print(f"Vehicle: {vehicle_info}")

        # 1. Fetch order from Shopify
        print(f"\n📦 Fetching order #{order_number}...")
        order = get_order_by_name(order_number)

        if not order:
            result['error'] = f"Order #{order_number} not found"
            result['message'] = result['error']
            print(f"   ❌ {result['error']}")
            return result

        print(f"   ✅ Order #{order_number} retrieved")

        # 2. Validate shipping address
        shipping_address = order.get('shippingAddress')
        is_valid, validation_msg = validate_address(shipping_address)

        if not is_valid:
            result['error'] = f"Address validation failed: {validation_msg}"
            result['message'] = result['error']
            print(f"   ❌ {result['error']}")
            return result

        print(f"   ✅ {validation_msg}")

        # 3. Display shipping address
        print(f"\n📫 Shipping Address:")
        if shipping_address.get('company'):
            print(f"   {shipping_address['company']}")
        print(f"   {shipping_address.get('firstName', '')} {shipping_address.get('lastName', '')}")
        print(f"   {shipping_address.get('address1', '')}")
        if shipping_address.get('address2'):
            print(f"   {shipping_address['address2']}")
        print(f"   {shipping_address.get('city', '')}, {shipping_address.get('province', '')} {shipping_address.get('zip', '')}")

        # 4. Get card info
        card_info = get_card_info_by_id(card_id)
        if not card_info:
            result['error'] = f"Invalid card ID: {card_id}"
            result['message'] = result['error']
            print(f"   ❌ {result['error']}")
            return result

        print(f"\n💳 Using card: {card_info['name']}")

        # 5. Validate mode
        if mode not in ['quote', 'manual']:
            result['error'] = f"Invalid mode: {mode}. Must be 'quote' or 'manual'"
            result['message'] = result['error']
            print(f"   ❌ {result['error']}")
            return result

        # 6. Validate quote link if quote mode
        if mode == 'quote':
            if not quote_link:
                result['error'] = "Quote link is required for quote mode"
                result['message'] = result['error']
                print(f"   ❌ {result['error']}")
                return result

            if 'sdwheelwholesale.com/cart/quote/' not in quote_link:
                result['error'] = "Invalid quote link format"
                result['message'] = result['error']
                print(f"   ❌ {result['error']}")
                return result

        # 7. Initialize browser
        print(f"\n🌐 Initializing browser (headless={headless})...")
        driver = Driver(uc=True, headless=headless)

        try:
            # 8. Process based on mode
            if mode == 'quote':
                print(f"\n📝 Processing in CUSTOM QUOTE mode...")
                print(f"   Quote Link: {quote_link}")

                # Call the original process_custom_quote function
                processing_result = sdw.process_custom_quote(driver, order, quote_link, card_info)

            else:  # manual mode
                print(f"\n🔍 Processing in MANUAL SEARCH mode...")

                # Override the vehicle info if provided
                if vehicle_info:
                    print(f"   Using provided vehicle: {vehicle_info}")
                    # We'll need to pass this to the processing function
                    # For now, store it in order context
                    order['_override_vehicle'] = vehicle_info

                # Call the original process_manual_search function
                processing_result = sdw.process_manual_search(driver, order, card_info)

            if processing_result:
                result['success'] = True
                result['message'] = 'Order processed successfully'
                print(f"\n✅ {result['message']}")

                # Try to extract price/confirmation from result if available
                if isinstance(processing_result, dict):
                    result['total_price'] = processing_result.get('total_price')
                    result['confirmation'] = processing_result.get('confirmation')
            else:
                result['message'] = 'Order processing incomplete'
                print(f"\n⚠️  {result['message']}")

        except Exception as e:
            result['error'] = str(e)
            result['message'] = f'Error during processing: {str(e)}'
            print(f"\n❌ {result['message']}")
            import traceback
            traceback.print_exc()

        finally:
            print(f"\n🔒 Closing browser...")
            try:
                driver.quit()
            except:
                pass

        return result

    except Exception as e:
        result['error'] = str(e)
        result['message'] = f'Fatal error: {str(e)}'
        print(f"\n❌ {result['message']}")
        import traceback
        traceback.print_exc()
        return result


if __name__ == "__main__":
    # Test mode - can be called directly for testing
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--order-number', required=True)
    parser.add_argument('--vehicle', required=False)
    parser.add_argument('--card', required=True, choices=['1', '2', '3', '4', '5'])
    parser.add_argument('--mode', required=True, choices=['quote', 'manual'])
    parser.add_argument('--quote-link', required=False)
    parser.add_argument('--headless', action='store_true')

    args = parser.parse_args()

    result = process_sdw_order_non_interactive(
        order_number=args.order_number,
        vehicle_info=args.vehicle,
        card_id=args.card,
        mode=args.mode,
        quote_link=args.quote_link,
        headless=args.headless
    )

    print(f"\n{'='*60}")
    print(f"RESULT:")
    print(f"{'='*60}")
    import json
    print(json.dumps(result, indent=2))

    sys.exit(0 if result['success'] else 1)
