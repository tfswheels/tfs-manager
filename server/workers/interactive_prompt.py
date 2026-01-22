"""
Interactive Prompt Module for SDW Automation
Handles user input requests by communicating with the Node.js server
instead of blocking on console input.
"""

import json
import time
import os
from pathlib import Path


class InteractivePrompt:
    """
    Manages interactive prompts that need user input during automation.
    Uses file-based communication with the Node.js server.
    """

    def __init__(self, job_id):
        """
        Initialize the interactive prompt manager.

        Args:
            job_id: The SDW job ID for this automation session
        """
        self.job_id = job_id
        self.prompt_dir = Path(__file__).parent / "job_prompts"
        self.prompt_dir.mkdir(exist_ok=True)

    def request_user_input(self, prompt_type, prompt_data, timeout=300):
        """
        Request user input and wait for response.

        Args:
            prompt_type: Type of prompt (e.g., "vehicle_form_failed", "model_selection")
            prompt_data: Dict containing prompt details and options
            timeout: Maximum seconds to wait for response (default 5 minutes)

        Returns:
            Dict with user's response, or None if timeout/cancelled
        """
        # Create request file
        request_file = self.prompt_dir / f"{self.job_id}_request.json"
        response_file = self.prompt_dir / f"{self.job_id}_response.json"

        # Clean up any old response file
        if response_file.exists():
            response_file.unlink()

        # Write request with all prompt data
        request_data = {
            "job_id": self.job_id,
            "timestamp": time.time(),
            "prompt_type": prompt_type,
            **prompt_data
        }

        with open(request_file, 'w') as f:
            json.dump(request_data, f, indent=2)

        # Emit event to stdout for Node.js server to detect
        event_json = json.dumps({
            "event": "user_input_required",
            "job_id": self.job_id,
            "prompt_type": prompt_type,
            "prompt_data": prompt_data
        })
        print(f"[JOB_EVENT] {event_json}", flush=True)

        # Wait for response file
        start_time = time.time()
        while True:
            if response_file.exists():
                try:
                    with open(response_file, 'r') as f:
                        response = json.load(f)

                    # Clean up files
                    request_file.unlink(missing_ok=True)
                    response_file.unlink(missing_ok=True)

                    return response

                except (json.JSONDecodeError, IOError):
                    # File might be mid-write, wait a bit
                    time.sleep(0.1)
                    continue

            # Check timeout
            elapsed = time.time() - start_time
            if elapsed > timeout:
                print(f"   ⏰ User input timeout after {timeout}s")
                request_file.unlink(missing_ok=True)
                return None

            # Poll every 500ms
            time.sleep(0.5)

    def cleanup(self):
        """Clean up any leftover prompt files for this job."""
        request_file = self.prompt_dir / f"{self.job_id}_request.json"
        response_file = self.prompt_dir / f"{self.job_id}_response.json"
        request_file.unlink(missing_ok=True)
        response_file.unlink(missing_ok=True)
