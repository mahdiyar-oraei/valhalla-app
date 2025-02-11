/* eslint-disable */

import { createContext, useContext, useState, useCallback } from 'react';

const VroomContext = createContext(null);

export function useVroomContext() {
  const context = useContext(VroomContext);
  if (!context) {
    throw new Error('useVroomContext must be used within a VroomProvider');
  }
  return context;
}

export function VroomProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [solution, setSolution] = useState(null);
  
  const addJob = useCallback((job) => {
    setJobs(prev => [...prev, job]);
  }, []);

  const removeJob = useCallback((jobId) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
  }, []);

  const addVehicle = useCallback((vehicle) => {
    setVehicles(prev => [...prev, {
      ...vehicle,
      start: null, // Initial start position
      end: null    // Initial end position
    }]);
  }, []);

  const updateVehiclePosition = useCallback((vehicleId, type, position) => {
    setVehicles(prev => prev.map(v => 
      v.id === vehicleId 
        ? { ...v, [type]: position }
        : v
    ));
  }, []);

  const removeVehicle = useCallback((vehicleId) => {
    setVehicles(prev => prev.filter(v => v.id !== vehicleId));
  }, []);

  const clearAll = useCallback(() => {
    setJobs([]);
    setVehicles([]);
    setSolution(null);
  }, []);

  const value = {
    jobs,
    vehicles,
    solution,
    addJob,
    removeJob,
    addVehicle,
    removeVehicle,
    updateVehiclePosition,
    setSolution,
    clearAll
  };

  return (
    <VroomContext.Provider value={value}>
      {children}
    </VroomContext.Provider>
  );
}