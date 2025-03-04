from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import httpx
from route_middleware import RouteMiddleware
import uvicorn
from typing import Dict, Any
from datetime import datetime

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure the URLs
PLANNER_URL = "http://localhost:3333"
VALHALLA_URL = "http://localhost:8002"  # Adjust this to your Valhalla server URL

# Initialize the middleware with logging disabled by default
route_middleware = RouteMiddleware(VALHALLA_URL, enable_logging=False)

@app.post("/")
async def process_route(
    request_data: Dict[str, Any],
    base_time: str = Query(None, description="Base time in ISO format (e.g., 2024-03-14T12:00:00)")
):
    """
    Endpoint that forwards request to the route planner and processes the response
    """
    try:
        # Convert base_time string to datetime if provided
        base_datetime = None
        if base_time:
            try:
                base_datetime = datetime.fromisoformat(base_time)
            except ValueError:
                raise HTTPException(
                    status_code=400, 
                    detail="Invalid base_time format. Use ISO format (e.g., 2024-03-14T12:00:00)"
                )

        # Forward the request to the route planner
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{PLANNER_URL}/", json=request_data)
            planner_response = response.json()

        # Process the response using our middleware
        processed_response = await route_middleware.process_response(planner_response, base_datetime)
        return processed_response

    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Error forwarding request: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# Add an endpoint to control logging
@app.post("/logging/{state}")
async def control_logging(state: str):
    """Enable or disable Valhalla request logging"""
    if state.lower() == "enable":
        route_middleware.enable_logging()
        return {"message": "Logging enabled"}
    elif state.lower() == "disable":
        route_middleware.disable_logging()
        return {"message": "Logging disabled"}
    else:
        raise HTTPException(status_code=400, detail="Invalid state. Use 'enable' or 'disable'")

# Add an OPTIONS route handler
@app.options("/{path:path}")
async def options_handler():
    return {"message": "OK"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3334) 