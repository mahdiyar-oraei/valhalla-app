import httpx
from datetime import datetime, timedelta
import asyncio
from typing import Dict, List, Any
from route_logger import RouteLogger

class RouteMiddleware:
    def __init__(self, valhalla_url: str, enable_logging: bool = False):
        self.valhalla_url = valhalla_url
        self.logger = RouteLogger(enabled=enable_logging)

    async def get_valhalla_duration(self, origin: List[float], destination: List[float], 
                                  departed_at: datetime) -> int:
        """Get duration between two points using Valhalla API"""
        try:
            payload = {
                "locations": [
                    {"lat": origin[1], "lon": origin[0]},
                    {"lat": destination[1], "lon": destination[0]}
                ],
                "costing": "auto",
                "directions_options": {"units": "kilometers"},
                "date_time": {
                    "type": 1,  # departure time
                    "value": departed_at.strftime("%Y-%m-%dT%H:%M")  # ISO 8601 format
                }
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(f"{self.valhalla_url}/route", json=payload)
                data = response.json()
                
                # Log the request and response
                self.logger.log_request(payload, data)
                
                if "error" in data:
                    raise Exception(f"Valhalla API error: {data['error']}")
                
                if "trip" not in data:
                    print(f"Unexpected Valhalla response: {data}")  # For debugging
                    raise Exception("Invalid response from Valhalla API")
                
                return int(data["trip"]["summary"]["time"])  # Duration in seconds
                
        except httpx.HTTPError as e:
            print(f"HTTP error occurred: {e}")  # For debugging
            raise Exception(f"Failed to get duration from Valhalla: {str(e)}")
        except KeyError as e:
            print(f"Response parsing error: {e}")  # For debugging
            print(f"Response data: {data}")  # For debugging
            raise Exception(f"Invalid response structure from Valhalla: {str(e)}")
        except Exception as e:
            print(f"Unexpected error: {e}")  # For debugging
            raise

    async def process_route(self, route_data: Dict[str, Any], base_time: datetime = None) -> Dict[str, Any]:
        """Process a single route and update its durations"""
        steps = route_data["steps"]
        base_time = base_time or datetime.now()
        current_time = base_time
        
        # Process each step pair to calculate new durations
        for i in range(len(steps) - 1):
            current_step = steps[i]
            next_step = steps[i + 1]
            
            # Get new duration from Valhalla
            duration = await self.get_valhalla_duration(
                current_step["location"],
                next_step["location"],
                current_time
            )
            
            # Update next step's timing
            next_step["duration"] = current_step["duration"] + duration
            next_step["arrival"] = current_step["arrival"] + duration
            current_time = base_time + timedelta(seconds=next_step["arrival"])
        
        # Update route summary
        if steps:
            route_data["duration"] = steps[-1]["duration"]
            route_data["cost"] = steps[-1]["duration"]  # Assuming cost equals duration
            
        return route_data

    async def process_response(self, planner_response: Dict[str, Any], base_time: datetime = None) -> Dict[str, Any]:
        """Process the entire route planner response"""
        # Process each route in parallel
        tasks = [self.process_route(route, base_time) for route in planner_response["routes"]]
        updated_routes = await asyncio.gather(*tasks)
        
        # Update response with new routes
        planner_response["routes"] = updated_routes
        
        # Update summary
        if updated_routes:
            total_duration = sum(route["duration"] for route in updated_routes)
            planner_response["summary"]["duration"] = total_duration
            planner_response["summary"]["cost"] = total_duration
            
        return planner_response

    def enable_logging(self) -> None:
        """Enable request logging"""
        self.logger.enable()

    def disable_logging(self) -> None:
        """Disable request logging"""
        self.logger.disable()
