import psycopg2
import json
from datetime import datetime, time
import os
import numpy as np
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
import multiprocessing
import subprocess

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
    Convert Valhalla edge ID to graph_id format based on Valhalla's GraphId class.
    
    The 64-bit ID is structured as:
    - First 3 bits: level (0-7)
    - Next 22 bits: tile ID
    - Next 21 bits: ID within tile
    - Remaining bits: unused
    
    Example:
    edge_id = 112642252344
    Returns: "2/26844/123" (level/tileid/id)
    """
    edge_id = int(edge_id)
    
    # Extract components using bit operations matching Valhalla's implementation
    level = edge_id & 0x7                    # First 3 bits (0x7 = 0b111)
    tile_id = (edge_id & 0x1fffff8) >> 3    # Next 22 bits (shift right by 3 to remove level bits)
    id = (edge_id & 0x3ffffe000000) >> 25   # Next 21 bits (shift right by 25)
    
    # Convert to string format matching Valhalla's to_string implementation
    return f"{level}/{tile_id}/{id}"

def get_tile_path(graph_id):
    """
    Convert graph_id to tile path matching Valhalla's FileSuffix logic
    Example: For level 8 and tileid 24134109851 -> 8/024/134/109/851.csv
    """
    parts = graph_id.split('/')
    if len(parts) != 3:
        raise ValueError(f"Invalid graph_id format: {graph_id}")
    
    level = int(parts[0])
    tile_id = int(parts[1])
    
    # Convert tile_id to string and pad with zeros
    tile_str = str(tile_id)
    # Calculate max_length (must be multiple of 3)
    max_length = len(tile_str)
    remainder = max_length % 3
    if remainder:
        max_length += 3 - remainder
        tile_str = tile_str.zfill(max_length)
    
    # Split into groups of 3
    tile_parts = [tile_str[i:i+3] for i in range(0, len(tile_str), 3)]
    
    # Combine path parts
    path = f"{level}/{'/'.join(tile_parts)}"
    return path, f"{path}.csv"

def get_edge_mappings(cursor, container_name="valhalla-container-mashhad"):
    """
    Use valhalla_ways_to_edges to get the mapping between OSM way IDs and Valhalla edge IDs
    Args:
        cursor: Database cursor for executing queries
        container_name: Name of the Valhalla Docker container
    Returns:
        Set of valid edge IDs from Valhalla that match our database ways
    """
    print("Getting edge ID mappings from Valhalla...")
    
    try:
        # First, create a CSV file with OSM way IDs
        print("Creating ways CSV file...")
        with open('way_ids.csv', 'w') as f:
            f.write('way_id\n')
            # Modified query to get actual OSM way IDs from your OSRM database
            cursor.execute("""
                SELECT DISTINCT id  -- or osm_id depending on your table structure
                FROM tmp.mashhad_way_node
            """)
            
            way_count = 0
            for row in cursor:
                way_id = str(row[0])
                f.write(f"{way_id}\n")
                way_count += 1

        print(f"Found {way_count} unique OSM way IDs")

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
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Failed to get edge mappings: {result.stderr}")

        # Copy the results back
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

        # Read the mappings and collect edge IDs
        valid_edges = set()
        print("\nProcessing edge mappings...")
        with open('edge_mappings.txt', 'r') as f:
            for line_num, line in enumerate(f, 1):
                try:
                    # Format: way_id,is_forward,edge_id
                    parts = line.strip().split(',')
                    if len(parts) >= 3:
                        edge_id = parts[2]  # Edge ID is in the third column
                        valid_edges.add(edge_id)
                        
                except Exception as e:
                    print(f"Warning: Error processing line {line_num}: {e}")
                    print(f"Line content: {line.strip()}")
                    continue

        print(f"\nFound {len(valid_edges)} valid edge IDs")
        if valid_edges:
            print("Sample edge IDs:", list(valid_edges)[:5])

        return valid_edges

    except Exception as e:
        print(f"Error getting edge mappings: {e}")
        return set()

def process_edge_batch(batch_data):
    """Process a batch of edges and return their traffic data"""
    edge_ids, _ = batch_data
    tile_data = defaultdict(list)
    
    # Static speed values for testing
    FREEFLOW_SPEED = 100.0    # 100 km/h for freeflow
    CONSTRAINED_SPEED = 10.0   # 10 km/h for constrained
    
    for edge_id in edge_ids:
        try:
            # Convert edge_id to graph_id format
            graph_id = convert_edge_to_graph_id(edge_id)
            tile_dir, tile_file = get_tile_path(graph_id)
            
            tile_data[tile_file].append({
                'graph_id': graph_id,
                'freeflow_speed': FREEFLOW_SPEED,
                'constrained_speed': CONSTRAINED_SPEED
            })
                
        except Exception as e:
            print(f"Error processing edge {edge_id}: {e}")
                
    return dict(tile_data)

def get_valhalla_tile_paths(container_name="valhalla-container-mashhad"):
    """Get the existing tile structure from Valhalla container"""
    import subprocess
    
    cmd = [
        "docker",
        "exec",
        container_name,
        "find",
        "/data/valhalla_tiles",
        "-name",
        "*.gph"
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception("Failed to get tile structure from container")
        
    tile_paths = []
    for line in result.stdout.splitlines():
        # Convert /data/valhalla_tiles/1/047/701.gph to 1/047/701
        path = line.replace('/data/valhalla_tiles/', '').replace('.gph', '')
        if path:
            tile_paths.append(path)
            
    return tile_paths

def process_traffic_data(base_dir="traffic_tiles", batch_size=1000, max_workers=None):
    """Process traffic data using multiprocessing"""
    print("Starting traffic data processing...")
    
    try:
        conn = psycopg2.connect(
            dbname="traffic",
            user="taha",
            password="Moa15928",
            host="localhost",
            port="5432"
        )
        cursor = conn.cursor()

        # Get valid edge IDs from Valhalla
        valid_edges = get_edge_mappings(cursor)
        if not valid_edges:
            raise Exception("Failed to get edge mappings")
        
        print(f"Found {len(valid_edges)} edges to process")
        
        # Create base directory
        os.makedirs(base_dir, exist_ok=True)
        
        # Prepare batches
        edge_list = list(valid_edges)
        total_batches = (len(edge_list) + batch_size - 1) // batch_size
        
        # Process batches in parallel
        max_workers = max_workers or multiprocessing.cpu_count()
        print(f"Processing with {max_workers} workers in batches of {batch_size}")
        
        tile_files = set()
        processed_count = 0
        
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            batches = [
                (edge_list[i:i + batch_size], None)
                for i in range(0, len(edge_list), batch_size)
            ]
            
            for batch_num, batch_results in enumerate(executor.map(process_edge_batch, batches), 1):
                processed_count += len(batches[batch_num - 1][0])
                print(f"Processed batch {batch_num}/{total_batches} "
                      f"({(batch_num/total_batches)*100:.1f}%)")
                
                for tile_path, records in batch_results.items():
                    full_tile_dir = os.path.join(base_dir, os.path.dirname(tile_path))
                    full_path = os.path.join(base_dir, tile_path)
                    
                    os.makedirs(full_tile_dir, exist_ok=True)
                    
                    if full_path not in tile_files:
                        with open(full_path, 'w') as f:
                            f.write("edge_id,freeflow_speed,constrained_speed,historical_speeds\n")
                        tile_files.add(full_path)
                    
                    with open(full_path, 'a') as f:
                        for record in records:
                            f.write(f"{record['graph_id']},"
                                  f"{record['freeflow_speed']:.1f},"
                                  f"{record['constrained_speed']:.1f},"
                                  f"\n")
        
        print(f"\nProcessing complete!")
        print(f"Created {len(tile_files)} tile files")
        print(f"Processed {processed_count} edges")

    except Exception as e:
        print(f"Error processing traffic data: {e}")
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

def add_traffic_to_valhalla(container_name="valhalla-container-mashhad", traffic_dir="traffic_tiles"):
    """Add traffic data to Valhalla"""
    import subprocess
    try:
        if not os.path.exists(traffic_dir):
            raise Exception(f"Traffic directory '{traffic_dir}' does not exist")
            
        traffic_files = []
        for root, dirs, files in os.walk(traffic_dir):
            for file in files:
                if file.endswith('.csv'):
                    traffic_files.append(os.path.join(root, file))
        
        print(f"Found {len(traffic_files)} traffic files locally")
        if traffic_files:
            print("Sample files:")
            for file in traffic_files[:3]:
                print(f"  {file}")
                with open(file, 'r') as f:
                    print("    First 3 lines:")
                    for i, line in enumerate(f):
                        if i < 3:
                            print(f"      {line.strip()}")
        
        # # Remove existing traffic_tiles in container if it exists
        # print("\nCleaning up existing traffic tiles in container...")
        # cleanup_cmd = [
        #     "docker",
        #     "exec",
        #     container_name,
        #     "rm",
        #     "-rf",
        #     "/data/traffic_tiles"
        # ]
        # subprocess.run(cleanup_cmd, capture_output=True, text=True)
        
        print(f"\nCopying traffic files to container '{container_name}'...")
        copy_cmd = [
            "docker", 
            "cp", 
            f"{traffic_dir}/.",  # Copy contents, not the directory itself
            f"{container_name}:/data/traffic_tiles"
        ]
        
        result = subprocess.run(copy_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Failed to copy traffic files to container: {result.stderr}")
        print("Successfully copied traffic files to container")

        print("\nVerifying files in container...")
        verify_cmd = [
            "docker",
            "exec",
            container_name,
            "ls",
            "-R",
            "/data/traffic_tiles"
        ]
        result = subprocess.run(verify_cmd, capture_output=True, text=True)
        print("Files in container:")
        print(result.stdout)

        print("\nAdding traffic data to Valhalla...")
        cmd = [
            "docker", 
            "exec",
            container_name,
            "valhalla_add_predicted_traffic",
            "-c",
            "/data/valhalla.json",
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
        # Process traffic data in a separate directory
        process_traffic_data(base_dir="traffic_tiles")
        # Add traffic data to Valhalla
        add_traffic_to_valhalla(traffic_dir="traffic_tiles")
    finally:
        # Clean up temporary files
        for temp_file in ['way_ids.csv', 'edge_mappings.txt']:
            if os.path.exists(temp_file):
                os.remove(temp_file)
    
    print(f"\nEnd time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=== Processing Complete ===")
    