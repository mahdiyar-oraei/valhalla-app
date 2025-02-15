/* eslint-disable */
import polyline from '@mapbox/polyline'

export const OSRM_API_URL = 'https://api.trucksapp.ir'

export const buildDirectionsRequest = ({ activeWaypoints }) => {
  // Format coordinates as "lng,lat;lng,lat"
  const coords = activeWaypoints
    .map(wp => wp.displaylnglat.join(','))
    .join(';')

  return {
    coords: coords,
    alternatives: true,       // Keep existing parameters
    steps: true,
    geometries: 'polyline',
    overview: 'full'
  }
}

// Helper to decode OSRM polyline
export const decodeOSRMGeometry = (geometry) => {
  console.log(geometry)
  return polyline.decode(geometry).map((coord) => [coord[0], coord[1]])
}
