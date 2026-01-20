#!/usr/bin/env python3
"""
SDW Order Processor - CLI Wrapper
Accepts configuration via command-line arguments and runs SDW automation
"""

import sys
import json
import argparse
from pathlib import Path

# Add the SDW script directory to path
sdw_script_path = Path("/Users/jeremiah/Desktop/TFS Wheels/TFS Wheels App/Order Processing/SDW Order Processing")
sys.path.insert(0, str(sdw_script_path))

def main():
    parser = argparse.ArgumentParser(description='Process order on SDW')
    parser.add_argument('--order-number', required=True, help='Shopify order number (e.g., 62423850)')
    parser.add_argument('--vehicle', required=False, help='Vehicle info (e.g., "2017 Lincoln Continental Select FWD")')
    parser.add_argument('--card', required=True, choices=['1', '2', '3', '4', '5'], help='Credit card selection (1-5)')
    parser.add_argument('--mode', required=True, choices=['quote', 'manual'], help='Processing mode')
    parser.add_argument('--quote-link', required=False, help='Quote link (required if mode=quote)')
    parser.add_argument('--selected-items', required=False, help='JSON array of line item IDs to process')

    args = parser.parse_args()

    # Validate
    if args.mode == 'quote' and not args.quote_link:
        print("ERROR: Quote link is required when mode=quote", file=sys.stderr)
        sys.exit(1)

    print(f"🚀 Starting SDW processing for order #{args.order_number}")
    print(f"   Vehicle: {args.vehicle or 'Not provided'}")
    print(f"   Card: {args.card}")
    print(f"   Mode: {args.mode}")
    if args.quote_link:
        print(f"   Quote: {args.quote_link}")

    # TODO: Import and call the actual SDW automation functions
    # For now, just simulate the process
    print("\n⚠️  SDW AUTOMATION STUB")
    print("This is a placeholder. Full integration requires:")
    print("1. Refactoring sdw_order_automation.py to accept programmatic input")
    print("2. Removing interactive prompts (input() calls)")
    print("3. Accepting config via function parameters")
    print("4. Returning structured results")
    print("\n✅ Configuration validated successfully")
    print("Next step: Modify sdw_order_automation.py to be importable and non-interactive")

    # Return success for now
    result = {
        "success": True,
        "order_number": args.order_number,
        "message": "SDW processing stub completed. Full automation integration pending.",
        "next_steps": [
            "Refactor sdw_order_automation.py",
            "Remove input() prompts",
            "Make functions accept parameters",
            "Add proper error handling"
        ]
    }

    print("\n" + json.dumps(result, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
