import json
from datetime import datetime
import os
from typing import Dict, Any

class RouteLogger:
    def __init__(self, enabled: bool = False, log_dir: str = "valhalla_logs"):
        self.enabled = enabled
        self.log_dir = log_dir
        if enabled:
            os.makedirs(log_dir, exist_ok=True)

    def log_request(self, payload: Dict[str, Any], response: Dict[str, Any]) -> None:
        """Log a Valhalla request and response to a file"""
        if not self.enabled:
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"valhalla_request_{timestamp}.json"
        filepath = os.path.join(self.log_dir, filename)

        log_data = {
            "timestamp": datetime.now().isoformat(),
            "request": payload,
            "response": response
        }

        with open(filepath, "w") as f:
            json.dump(log_data, f, indent=2)

    def enable(self) -> None:
        """Enable logging"""
        self.enabled = True
        os.makedirs(self.log_dir, exist_ok=True)

    def disable(self) -> None:
        """Disable logging"""
        self.enabled = False 