import axios from 'axios'
import {
  ADD_WAYPOINT,
  CLEAR_WAYPOINTS,
  RECEIVE_GEOCODE_RESULTS,
  REQUEST_GEOCODE_RESULTS,
  SET_WAYPOINT,
  UPDATE_TEXTINPUT,
  EMPTY_WAYPOINT,
  INSERT_WAYPOINT,
  RECEIVE_ROUTE_RESULTS,
  CLEAR_ROUTES,
  TOGGLE_PROVIDER_ISO,
  HIGHLIGHT_MNV,
  ZOOM_TO_MNV,
  UPDATE_INCLINE_DECLINE,
} from './types'

import {
  reverse_geocode,
  forward_geocode,
  parseGeocodeResponse,
} from 'utils/nominatim'

import { VALHALLA_OSM_URL } from 'utils/valhalla'

import {
  sendMessage,
  showLoading,
  updatePermalink,
  zoomTo,
} from './commonActions'

import {
  OSRM_API_URL,
  buildDirectionsRequest,
  decodeOSRMGeometry,
} from 'utils/osrm'

const fetchOSRMDirections = (osrmRequest) => (dispatch) => {
  dispatch(showLoading(true))

  axios
    .post(OSRM_API_URL + '/route', osrmRequest, {
      headers: {
        'Content-Type': 'application/json',
      },
    })
    .then(({ data }) => {
      // Transform OSRM response to match expected format
      const transformedData = {
        trip: {
          legs: data.routes[0].legs,
          summary: {
            length: data.routes[0].distance / 1000, // Convert to km
            time: data.routes[0].duration,
          },
        },
        alternates: data.routes.slice(1).map((route) => ({
          trip: {
            legs: route.legs,
            summary: {
              length: route.distance / 1000,
              time: route.duration,
            },
            geometry: route.geometry,
          },
        })),
        decodedGeometry: decodeOSRMGeometry(data.routes[0].geometry),
      }

      console.log(transformedData)

      if (transformedData.alternates) {
        transformedData.alternates.forEach((alternate) => {
          alternate.decodedGeometry = decodeOSRMGeometry(
            alternate.trip.geometry
          )
        })
      }

      dispatch(registerRouteResponse(OSRM_API_URL, transformedData))
      dispatch(zoomTo(transformedData.decodedGeometry))
    })
    .catch((error) => {
      console.log(error)
      dispatch(clearRoutes(OSRM_API_URL))
      dispatch(
        sendMessage({
          type: 'warning',
          icon: 'warning',
          description: `OSRM: ${
            error.response?.data?.message || 'Unknown error'
          }`,
          title: 'Error',
        })
      )
    })
    .finally(() => {
      setTimeout(() => {
        dispatch(showLoading(false))
      }, 500)
    })
}

export const makeRequest = () => (dispatch, getState) => {
  dispatch(updatePermalink())
  const { waypoints } = getState().directions
  const activeWaypoints = getActiveWaypoints(waypoints)
  if (activeWaypoints.length >= 2) {
    const osrmRequest = buildDirectionsRequest({ activeWaypoints })
    dispatch(fetchOSRMDirections(osrmRequest))
  }
}

const getActiveWaypoints = (waypoints) => {
  const activeWaypoints = []
  for (const waypoint of waypoints) {
    if (waypoint.geocodeResults.length > 0) {
      for (const result of waypoint.geocodeResults) {
        if (result.selected) {
          activeWaypoints.push(result)
          break
        }
      }
    }
  }
  return activeWaypoints
}

export const registerRouteResponse = (provider, data) => ({
  type: RECEIVE_ROUTE_RESULTS,
  payload: {
    provider,
    data,
  },
})

export const clearRoutes = (provider) => ({
  type: CLEAR_ROUTES,
  payload: provider,
})

const placeholderAddress = (index, lng, lat) => (dispatch) => {
  // placeholder until geocoder is complete
  // will add latLng to input field
  const addresses = [
    {
      title: '',
      displaylnglat: [lng, lat],
      key: index,
      addressindex: index,
    },
  ]
  dispatch(receiveGeocodeResults({ addresses, index: index }))
  dispatch(
    updateTextInput({
      inputValue: [lng.toFixed(6), lat.toFixed(6)].join(', '),
      index: index,
      addressindex: 0,
    })
  )
}

export const fetchReverseGeocodePerma = (object) => (dispatch) => {
  dispatch(requestGeocodeResults({ index: object.index, reverse: true }))

  const { index } = object
  const { permaLast } = object
  const { lng, lat } = object.latLng

  if (index > 1) {
    dispatch(doAddWaypoint(true, permaLast))
  }

  reverse_geocode(lng, lat)
    .then((response) => {
      dispatch(
        processGeocodeResponse(
          response.data,
          index,
          true,
          [lng, lat],
          permaLast
        )
      )
    })
    .catch((error) => {
      console.log(error) //eslint-disable-line
    })
  // .finally(() => {
  //   // always executed
  // })
}

export const fetchReverseGeocode = (object) => (dispatch, getState) => {
  //dispatch(requestGeocodeResults({ index: object.index, reverse: true }))
  const { waypoints } = getState().directions

  let { index } = object
  const { fromDrag } = object
  const { lng, lat } = object.latLng

  if (index === -1) {
    index = waypoints.length - 1
  } else if (index === 1 && !fromDrag) {
    // insert waypoint from context menu
    dispatch(doAddWaypoint(true))

    index = waypoints.length - 2
  }

  dispatch(placeholderAddress(index, lng, lat))

  dispatch(requestGeocodeResults({ index, reverse: true }))

  reverse_geocode(lng, lat)
    .then((response) => {
      dispatch(processGeocodeResponse(response.data, index, true, [lng, lat]))
    })
    .catch((error) => {
      console.log(error) //eslint-disable-line
    })
  // .finally(() => {
  //   // always executed
  // })
}

export const fetchGeocode = (object) => (dispatch) => {
  if (object.lngLat) {
    const addresses = [
      {
        title: object.lngLat.toString(),
        description: '',
        selected: false,
        addresslnglat: object.lngLat,
        sourcelnglat: object.lngLat,
        displaylnglat: object.lngLat,
        key: object.index,
        addressindex: 0,
      },
    ]
    dispatch(receiveGeocodeResults({ addresses, index: object.index }))
  } else {
    dispatch(requestGeocodeResults({ index: object.index }))

    forward_geocode(object.inputValue)
      .then((response) => {
        dispatch(processGeocodeResponse(response.data, object.index))
      })
      .catch((error) => {
        console.log(error) //eslint-disable-line
      })
      .finally(() => {})
  }
}

const processGeocodeResponse =
  (data, index, reverse, lngLat, permaLast) => (dispatch) => {
    const addresses = parseGeocodeResponse(data, lngLat)
    // if no address can be found
    if (addresses.length === 0) {
      dispatch(
        sendMessage({
          type: 'warning',
          icon: 'warning',
          description: 'Sorry, no addresses can be found.',
          title: 'No addresses',
        })
      )
    }
    dispatch(receiveGeocodeResults({ addresses, index }))

    if (reverse) {
      dispatch(
        updateTextInput({
          inputValue: addresses[0].title,
          index: index,
          addressindex: 0,
        })
      )
      if (permaLast === undefined) {
        dispatch(makeRequest())
        dispatch(updatePermalink())
      } else if (permaLast) {
        dispatch(makeRequest())
        dispatch(updatePermalink())
      }
    }
  }

export const receiveGeocodeResults = (object) => ({
  type: RECEIVE_GEOCODE_RESULTS,
  payload: object,
})

export const requestGeocodeResults = (object) => ({
  type: REQUEST_GEOCODE_RESULTS,
  payload: object,
})

export const updateTextInput = (object) => ({
  type: UPDATE_TEXTINPUT,
  payload: object,
})

export const doRemoveWaypoint = (index) => (dispatch, getState) => {
  if (index === undefined) {
    dispatch(clearWaypoints())
    Array(2)
      .fill()
      .map((_, i) => dispatch(doAddWaypoint()))
  } else {
    let waypoints = getState().directions.waypoints
    if (waypoints.length > 2) {
      dispatch(clearWaypoints(index))
      dispatch(makeRequest())
    } else {
      dispatch(emptyWaypoint(index))
    }
    waypoints = getState().directions.waypoints
    if (getActiveWaypoints(waypoints).length < 2) {
      dispatch(clearRoutes(VALHALLA_OSM_URL))
    }
  }
  dispatch(updatePermalink())
}

export const isWaypoint = (index) => (dispatch, getState) => {
  const waypoints = getState().directions.waypoints
  if (waypoints[index].geocodeResults.length > 0) {
    dispatch(clearRoutes(VALHALLA_OSM_URL))
  }
}

export const highlightManeuver = (fromTo) => (dispatch, getState) => {
  const highlightSegment = getState().directions.highlightSegment
  // this is dehighlighting
  if (
    highlightSegment.startIndex === fromTo.startIndex &&
    highlightSegment.endIndex === fromTo.endIndex
  ) {
    fromTo.startIndex = -1
    fromTo.endIndex = -1
  }

  dispatch({
    type: HIGHLIGHT_MNV,
    payload: fromTo,
  })
}

export const zoomToManeuver = (zoomObj) => ({
  type: ZOOM_TO_MNV,
  payload: zoomObj,
})

export const clearWaypoints = (index) => ({
  type: CLEAR_WAYPOINTS,
  payload: { index: index },
})

export const emptyWaypoint = (index) => ({
  type: EMPTY_WAYPOINT,
  payload: { index: index },
})

export const updateInclineDeclineTotal = (object) => ({
  type: UPDATE_INCLINE_DECLINE,
  payload: object,
})

export const doAddWaypoint = (doInsert) => (dispatch, getState) => {
  const waypoints = getState().directions.waypoints
  let maxIndex = Math.max.apply(
    Math,
    waypoints.map((wp) => {
      return wp.id
    })
  )
  maxIndex = isFinite(maxIndex) === false ? 0 : maxIndex + 1

  const emptyWp = {
    id: maxIndex.toString(),
    geocodeResults: [],
    isFetching: false,
    userInput: '',
  }
  if (doInsert) {
    dispatch(insertWaypoint(emptyWp))
  } else {
    dispatch(addWaypoint(emptyWp))
  }
}

const insertWaypoint = (waypoint) => ({
  type: INSERT_WAYPOINT,
  payload: waypoint,
})

export const addWaypoint = (waypoint) => ({
  type: ADD_WAYPOINT,
  payload: waypoint,
})

export const setWaypoints = (waypoints) => ({
  type: SET_WAYPOINT,
  payload: waypoints,
})

export const showProvider = (provider, show, idx) => ({
  type: TOGGLE_PROVIDER_ISO,
  payload: {
    provider,
    show,
    idx,
  },
})
