/* eslint-disable */

import { useVroomContext } from '../../context/VroomContext';
import './ControlPanel.css';

export function ControlPanel() {
  const { 
    jobs, 
    vehicles, 
    solution, 
    clearAll, 
    setSolution,
    removeJob,
    removeVehicle,
    addVehicle,
    updateVehiclePosition
  } = useVroomContext();

  const handleSolve = async () => {
    // Check if all vehicles have start positions
    const invalidVehicles = vehicles.filter(v => !v.start);
    if (invalidVehicles.length > 0) {
      alert('All vehicles must have a start position');
      return;
    }

    try {
      const vehiclesWithPositions = vehicles.map(vehicle => ({
        id: vehicle.id,
        start: [vehicle.start[1], vehicle.start[0]],
        end: vehicle.end ? [vehicle.end[1], vehicle.end[0]] : undefined
      }));

      const jobsWithSwappedCoords = jobs.map(job => ({
        ...job,
        location: [job.location[1], job.location[0]]
      }));

      const response = await fetch('https://legacynominatim.trucksapp.ir', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vehicles: vehiclesWithPositions,
          jobs: jobsWithSwappedCoords,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Validate solution structure
      if (!data || !data.summary) {
        throw new Error('Invalid solution format received');
      }
      
      setSolution(data);
    } catch (error) {
      console.error('Error solving route:', error);
      alert('Failed to solve route. Please try again.');
      setSolution(null);
    }
  };

  return (
    <div className="panel-control">
      <div className="panel-header">
        <h2>VROOM Control Panel</h2>
      </div>

      <div className="panel-content">
        <div className="panel-section">
          <h3>Vehicles ({vehicles.length})</h3>
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="vehicle-item">
              <span>Vehicle {vehicle.id}</span>
              <div className="vehicle-positions">
                <span className="position-text">
                  {vehicle.start ? (
                    <>
                      Start: ({vehicle.start[0].toFixed(4)}, {vehicle.start[1].toFixed(4)})
                      {vehicle.startAddress && (
                        <div className="address-text">{vehicle.startAddress}</div>
                      )}
                    </>
                  ) : (
                    <span className="missing-position">Set start position</span>
                  )}
                </span>
                <span className="position-text">
                  {vehicle.end ? (
                    <>
                      End: ({vehicle.end[0].toFixed(4)}, {vehicle.end[1].toFixed(4)})
                      {vehicle.endAddress && (
                        <div className="address-text">{vehicle.endAddress}</div>
                      )}
                    </>
                  ) : (
                    <span className="missing-position">Set end position (optional)</span>
                  )}
                </span>
              </div>
              <button 
                onClick={() => removeVehicle(vehicle.id)}
                className="delete-button"
              >
                ×
              </button>
            </div>
          ))}
          <button 
            onClick={() => addVehicle({ id: Date.now() })}
            className="add-button"
          >
            Add Vehicle
          </button>
        </div>

        <div className="panel-section">
          <h3>Jobs ({jobs.length})</h3>
          {jobs.map((job) => (
            <div key={job.id} className="job-item">
              <span>Job {job.id}</span>
              <div>
                <div className="location-text">
                  ({job.location[0].toFixed(4)}, {job.location[1].toFixed(4)})
                </div>
                {job.address && (
                  <div className="address-text">{job.address}</div>
                )}
              </div>
              <button 
                onClick={() => removeJob(job.id)}
                className="delete-button"
              >
                ×
              </button>
            </div>
          ))}
          <div className="help-text">
            Click on the map to add jobs
          </div>
        </div>

        <div className="panel-section">
          <button 
            onClick={handleSolve}
            className="solve-button"
            disabled={jobs.length === 0 || vehicles.length === 0}
          >
            Solve Route
          </button>
          <button 
            onClick={clearAll}
            className="clear-button"
          >
            Clear All
          </button>
        </div>

        {solution && solution.summary && (
          <div className="panel-section">
            <h3>Solution Summary</h3>
            <div className="solution-summary">
              <p>Total Distance: {(solution.summary.distance / 1000).toFixed(2)} km</p>
              <p>Duration: {(solution.summary.duration / 60).toFixed(2)} minutes</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}