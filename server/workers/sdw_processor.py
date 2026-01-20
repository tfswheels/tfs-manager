#!/usr/bin/env python3
"""
SDW Order Processor - CLI Wrapper
Accepts configuration via command-line arguments and runs SDW automation
"""

import sys
import json
import argparse
from pathlib import Path

# Import the non-interactive SDW automation library
try:
    from sdw_automation_lib import process_sdw_order_non_interactive
except ImportError as e:
    print(f"ERROR: Failed to import SDW automation library: {e}", file=sys.stderr)
    print("Make sure sdw_automation_lib.py is in the same directory", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='Process order on SDW')
    parser.add_argument('--order-number', required=True, help='Shopify order number (e.g., 62423850)')
    parser.add_argument('--vehicle', required=False, help='Vehicle info (e.g., "2017 Lincoln Continental Select FWD")')
    parser.add_argument('--card', required=True, choices=['1', '2', '3', '4', '5'], help='Credit card selection (1-5)')
    parser.add_argument('--mode', required=True, choices=['quote', 'manual'], help='Processing mode')
    parser.add_argument('--quote-link', required=False, help='Quote link (required if mode=quote)')
    parser.add_argument('--selected-items', required=False, help='JSON array of line item IDs to process')
    parser.add_argument('--headless', action='store_true', help='Run browser in headless mode')

    args = parser.parse_args()

    # Validate
    if args.mode == 'quote' and not args.quote_link:
        error_result = {
            "success": False,
            "order_number": args.order_number,
            "error": "Quote link is required when mode=quote",
            "message": "Validation failed"
        }
        print(json.dumps(error_result, indent=2), file=sys.stderr)
        sys.exit(1)

    print(f"🚀 Starting SDW processing for order #{args.order_number}")
    print(f"   Vehicle: {args.vehicle or 'Will extract from order'}")
    print(f"   Card: {args.card}")
    print(f"   Mode: {args.mode}")
    if args.quote_link:
        print(f"   Quote: {args.quote_link}")

    # Parse selected items if provided
    selected_items = None
    if args.selected_items:
        try:
            selected_items = json.loads(args.selected_items)
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON for selected-items: {e}", file=sys.stderr)
            sys.exit(1)

    # Call the non-interactive SDW automation
    try:
        result = process_sdw_order_non_interactive(
            order_number=args.order_number,
            vehicle_info=args.vehicle,
            card_id=args.card,
            mode=args.mode,
            quote_link=args.quote_link,
            selected_line_items=selected_items,
            headless=args.headless
        )

        # Output result as JSON for the Node.js backend to parse
        print(f"\n{'='*60}")
        print("FINAL RESULT:")
        print(f"{'='*60}")
        print(json.dumps(result, indent=2))

        # Exit with appropriate code
        return 0 if result['success'] else 1

    except Exception as e:
        error_result = {
            "success": False,
            "order_number": args.order_number,
            "error": str(e),
            "message": f"Fatal error: {str(e)}"
        }
        print(json.dumps(error_result, indent=2), file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
