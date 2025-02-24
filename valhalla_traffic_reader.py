import psycopg2
import json
from datetime import datetime, time
import os
import numpy as np

def connect_to_database():
    try:
        conn = psycopg2.connect(
            dbname="traffic",
            user="taha",
            password="Moa15928",
            host="localhost",
            port="5432"
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return None

def convert_speed_to_kmh(speed):
    """Convert speed to km/h if it's not already"""
    return float(speed)  # Modify this if your speeds are in different units

def create_traffic_csv_structure(base_dir="traffic_tiles"):
    """Create the directory structure for traffic CSV files"""
    os.makedirs(base_dir, exist_ok=True)
    return base_dir

def convert_edge_to_graph_id(edge_id):
    """
    Convert Valhalla edge ID to graph_id format (level/tile/id)
    Based on Valhalla's edge ID format:
    - The first 3 bits represent the level (0-7)
    - The next 22 bits represent the tile ID
    - The last 21 bits represent the ID within the tile
    """
    edge_id = int(edge_id)
    level = edge_id >> 46 & 0x7  # Get first 3 bits
    tile = edge_id >> 24 & 0x3FFFFF  # Get next 22 bits
    id = edge_id & 0x1FFFFF  # Get last 21 bits
    return f"{level}/{tile}/{id}"

def get_tile_path(graph_id):
    """
    Convert graph_id to tile path
    Example: 1/47701/130 -> 1/477/01.csv
    """
    parts = graph_id.split('/')
    if len(parts) != 3:
        raise ValueError(f"Invalid graph_id format: {graph_id}")
    
    level = parts[0]
    tile_id = parts[1]
    
    # Create directory structure like 1/477
    tile_dir = f"{level}/{tile_id[:3]}"
    return tile_dir, f"{tile_id[:3]}{tile_id[3:]}.csv"

def get_edge_mappings(cursor, container_name="valhalla-container"):
    """
    Use valhalla_ways_to_edges to get the mapping between OSM way IDs and Valhalla edge IDs
    Args:
        cursor: Database cursor for executing queries
        container_name: Name of the Valhalla Docker container
    Returns:
        List of valid edge IDs from Valhalla
    """
    import subprocess
    import csv
    from io import StringIO

    print("Getting edge ID mappings from Valhalla...")
    
    try:
        # First, create a CSV file with your way IDs
        print("Creating ways CSV file...")
        with open('way_ids.csv', 'w') as f:
            f.write('way_id\n')
            cursor.execute("""
                SELECT DISTINCT concat(from_node, '_', to_node) as way_id
                FROM typical.pre_typical
            """)
            for row in cursor:
                f.write(f"{row[0]}\n")

        # Copy the CSV file to the container
        print("Copying ways file to container...")
        copy_cmd = [
            "docker",
            "cp",
            "way_ids.csv",
            f"{container_name}:/data/way_ids.csv"
        ]
        
        result = subprocess.run(copy_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Failed to copy ways file: {result.stderr}")

        # Run valhalla_ways_to_edges
        print("Running valhalla_ways_to_edges...")
        cmd = [
            "docker",
            "exec",
            container_name,
            "valhalla_ways_to_edges",
            "-c",
            "/data/valhalla.json",
            "/data/way_ids.csv"
        ]
        
        print(f"Executing command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        print(f"Command output: {result.stdout}")
        print(f"Command error: {result.stderr}")
        
        if result.returncode != 0:
            raise Exception(f"Failed to get edge mappings: {result.stderr}")

        # Copy the results back from the correct location
        print("Copying edge mappings back from container...")
        copy_back_cmd = [
            "docker",
            "cp",
            f"{container_name}:/data/valhalla_tiles/way_edges.txt",
            "edge_mappings.txt"
        ]
        result = subprocess.run(copy_back_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Failed to copy edge mappings: {result.stderr}")

        # Read the mappings and collect all valid edge IDs
        valid_edges = set()
        print("Processing edge mappings...")
        with open('edge_mappings.txt', 'r') as f:
            for line_num, line in enumerate(f, 1):
                try:
                    parts = line.strip().split(',')
                    if len(parts) < 3:
                        continue
                    
                    # Process each edge ID
                    for i in range(2, len(parts), 2):
                        edge_id = parts[i]
                        valid_edges.add(edge_id)

                except Exception as e:
                    print(f"Warning: Error processing line {line_num}: {e}")
                    continue

        print(f"Found {len(valid_edges)} valid edge IDs")
        
        # Debug: Print a few sample edge IDs
        sample_size = min(5, len(valid_edges))
        print(f"\nSample of first {sample_size} edge IDs:")
        for edge_id in list(valid_edges)[:sample_size]:
            print(f"  {edge_id}")

        return valid_edges

    except Exception as e:
        print(f"Error getting edge mappings: {e}")
        return set()

def process_traffic_data(base_dir="traffic_tiles"):
    print("Starting traffic data processing...")
    conn = connect_to_database()
    if not conn:
        return

    try:
        cursor = conn.cursor()
        
        # Get valid edge IDs from Valhalla
        valid_edges = get_edge_mappings(cursor)
        if not valid_edges:
            raise Exception("Failed to get edge mappings")

        print("Creating traffic tile directory structure...")
        base_dir = create_traffic_csv_structure(base_dir)

        # Process each valid edge ID
        processed_count = 0
        tile_files = {}

        for edge_id in valid_edges:
            processed_count += 1
            if processed_count % 1000 == 0:
                print(f"Processing edge {processed_count}/{len(valid_edges)} ({(processed_count/len(valid_edges))*100:.1f}%)")
            
            try:
                # Convert edge_id to graph_id format (level/tile/id)
                graph_id = convert_edge_to_graph_id(edge_id)
                
                # Get tile path from the graph_id
                tile_dir, tile_file = get_tile_path(graph_id)
                full_tile_dir = os.path.join(base_dir, tile_dir)
                os.makedirs(full_tile_dir, exist_ok=True)
                
                # Initialize file if not exists
                full_path = os.path.join(full_tile_dir, tile_file)
                if full_path not in tile_files:
                    with open(full_path, 'w') as f:
                        f.write("edge_id,freeflow_speed,constrained_speed\n")
                    tile_files[full_path] = True

                # Calculate average speeds
                cursor.execute("""
                    SELECT 
                        AVG(speed) as freeflow_speed,
                        AVG(speed_red) as constrained_speed
                    FROM typical.pre_typical
                """)
                
                speeds = cursor.fetchone()
                if speeds:
                    freeflow_speed, constrained_speed = speeds
                    
                    # Append data to appropriate CSV file using graph_id format
                    with open(full_path, 'a') as f:
                        f.write(f"{graph_id},{convert_speed_to_kmh(freeflow_speed):.1f},"
                              f"{convert_speed_to_kmh(constrained_speed):.1f}\n")
                
            except Exception as e:
                print(f"Error processing edge {edge_id}: {e}")

        print(f"\nProcessing complete!")
        print(f"Created {len(tile_files)} tile files")
        print(f"Processed {processed_count} edges")

    except Exception as e:
        print(f"Error processing traffic data: {e}")
    finally:
        cursor.close()
        conn.close()

def add_traffic_to_valhalla(container_name="valhalla-container", traffic_dir="traffic_tiles"):
    """
    Add traffic data to Valhalla using valhalla_add_predicted_traffic
    """
    import subprocess
    try:
        print(f"Copying traffic files to container '{container_name}'...")
        copy_cmd = [
            "docker", 
            "cp", 
            traffic_dir,
            f"{container_name}:/data/traffic_tiles"
        ]
        
        result = subprocess.run(copy_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Failed to copy traffic files to container: {result.stderr}")
        print("Successfully copied traffic files to container")

        print("Adding traffic data to Valhalla...")
        cmd = [
            "docker", 
            "exec",
            container_name,
            "valhalla_add_predicted_traffic",
            "-t",
            "/data/traffic_tiles"
        ]
        
        print(f"Executing command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✓ Traffic data successfully added to Valhalla")
            print(result.stdout)
        else:
            print("✗ Error adding traffic data")
            print(f"Error output: {result.stderr}")
            
    except Exception as e:
        print(f"✗ Error executing Valhalla command: {e}")

if __name__ == "__main__":
    print("=== Starting Valhalla Traffic Data Processing ===")
    print(f"Start time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    try:
        process_traffic_data()
        add_traffic_to_valhalla()
    finally:
        # Clean up temporary files
        for temp_file in ['way_ids.csv', 'edge_mappings.txt']:
            if os.path.exists(temp_file):
                os.remove(temp_file)
    
    print(f"\nEnd time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=== Processing Complete ===")
