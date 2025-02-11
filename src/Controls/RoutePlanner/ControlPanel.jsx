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
    addJob
  } = useVroomContext();

  const handleSolve = async () => {
    try {
      // Replace with your VROOM API endpoint
      const response = await fetch('YOUR_VROOM_API_ENDPOINT', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vehicles,
          jobs,
        }),
      });
      const solution = await response.json();
      setSolution(solution);
    } catch (error) {
      console.error('Error solving route:', error);
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
              <span>{job.description}</span>
              <button 
                onClick={() => removeJob(job.id)}
                className="delete-button"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {jobs.length > 0 && vehicles.length > 0 && (
          <button onClick={handleSolve} className="solve-button">
            Solve Route
          </button>
        )}

        {solution && (
          <div className="panel-section">
            <h3>Solution Summary</h3>
            <div className="solution-summary">
              <p>Total Distance: {(solution.summary.distance / 1000).toFixed(2)} km</p>
              <p>Duration: {(solution.summary.duration / 60).toFixed(2)} minutes</p>
            </div>
          </div>
        )}

        <button onClick={clearAll} className="clear-button">
          Clear All
        </button>
      </div>
    </div>
  );
}