/* eslint-disable */

import { useVroomContext } from '../../context/VroomContext';
import './ControlPanel.css';
import { useState } from 'react';

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

  // Add state for datetime
  const [baseTime, setBaseTime] = useState(new Date().toISOString().slice(0, 16));

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

      // Create URL with base_time parameter first
      const url = new URL('https://legacynominatim.trucksapp.ir');
      url.searchParams.append('base_time', baseTime);

      // Use the constructed URL in the fetch call
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vehicles: vehiclesWithPositions,
          jobs: jobsWithSwappedCoords,
          "options": {
            "g": true
          }
        }),
        signal: new AbortController().signal
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

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="panel-control">
      <div className="panel-header">
        <h2>Route Planner</h2>
      </div>

      <div className="panel-content">
        <div className="panel-section">
          <h3>Base Time</h3>
          <input
            type="datetime-local"
            value={baseTime}
            onChange={(e) => setBaseTime(e.target.value)}
            className="datetime-picker"
            step="60"
          />
        </div>

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
              <p>Duration: {formatDuration(solution.summary.duration)}</p>
              <p>Routes: {solution.summary.routes}</p>
              <p>Unassigned Jobs: {solution.summary.unassigned}</p>
            </div>

            {solution.routes.map((route, index) => (
              <div key={index} className="route-details">
                <h4>Route {index + 1}</h4>
                <div className="route-summary">
                  <p>Vehicle: {route.vehicle}</p>
                  <p>Distance: {(route.distance / 1000).toFixed(2)} km</p>
                  <p>Duration: {formatDuration(route.duration)}</p>
                </div>
                <div className="route-steps">
                  {route.steps.map((step, stepIndex) => (
                    <div key={stepIndex} className={`step-item ${step.type}`}>
                      <span className="step-type">{step.type}</span>
                      {step.type === 'job' && (
                        <span className="step-job">Job {step.job}</span>
                      )}
                      <span className="step-arrival">
                        Arrival: {formatDuration(step.arrival)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}