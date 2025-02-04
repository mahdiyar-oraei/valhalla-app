import polyline from '@mapbox/polyline'

export const OSRM_API_URL = 'https://legacyosrm.trucksapp.ir'

export const buildDirectionsRequest = ({ activeWaypoints }) => {
  // Convert waypoints to OSRM format
  const coordinates = activeWaypoints.map((waypoint) => [
    waypoint.displaylnglat[0], // longitude
    waypoint.displaylnglat[1], // latitude
  ])

  return {
    coordinates,
    alternatives: true, // if you want alternative routes
    steps: true, // for turn-by-turn instructions
    annotations: true, // for additional metadata
    overview: 'full', // for full geometry
  }
}

// Helper to decode OSRM polyline
export const decodeOSRMGeometry = (geometry) => {
  console.log(geometry)
  return polyline.decode(geometry).map((coord) => [coord[0], coord[1]])
}
