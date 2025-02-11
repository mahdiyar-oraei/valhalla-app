import { useState, useCallback } from 'react';

export function useVroom() {
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
    setVehicles(prev => [...prev, vehicle]);
  }, []);

  const removeVehicle = useCallback((vehicleId) => {
    setVehicles(prev => prev.filter(v => v.id !== vehicleId));
  }, []);

  const clearAll = useCallback(() => {
    setJobs([]);
    setVehicles([]);
    setSolution(null);
  }, []);

  return {
    jobs,
    vehicles,
    solution,
    addJob,
    removeJob,
    addVehicle,
    removeVehicle,
    setSolution,
    clearAll
  };
}