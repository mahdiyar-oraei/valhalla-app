/* eslint-disable */
import React from 'react'
import ReactDOM from 'react-dom'
import { connect } from 'react-redux'
import L from 'leaflet'
import * as $ from 'jquery'
import 'jquery-ui-bundle'
import 'jquery-ui-bundle/jquery-ui.css'

import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import 'leaflet.heightgraph'
import 'leaflet.heightgraph/dist/L.Control.Heightgraph.min.css'

import PropTypes from 'prop-types'
import axios from 'axios'

import * as R from 'ramda'
import ExtraMarkers from './extraMarkers'
import { Button, Label, Icon, Popup } from 'semantic-ui-react'
import { ToastContainer } from 'react-toastify'
import { CopyToClipboard } from 'react-copy-to-clipboard'
import {
  fetchReverseGeocode,
  updateInclineDeclineTotal,
  getTrafficColor,
} from 'actions/directionsActions'
import { fetchReverseGeocodeIso } from 'actions/isochronesActions'
import { updateSettings } from 'actions/commonActions'
import {
  VALHALLA_OSM_URL,
  buildHeightRequest,
  buildLocateRequest,
} from 'utils/valhalla'
import { colorMappings, buildHeightgraphData } from 'utils/heightgraph'
import formatDuration from 'utils/date_time'
import './Map.css'
import { OSRM_API_URL } from 'utils/osrm'
import { useVroomContext } from '../context/VroomContext'
import polyline from '@mapbox/polyline'

const OSMTiles = L.tileLayer(process.env.REACT_APP_TILE_SERVER_URL, {
  attribution:
    '<a href="https://map.project-osrm.org/about.html" target="_blank">About this service and privacy policy</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
})

const convertDDToDMS = (decimalDegrees) =>
  [
    0 | decimalDegrees,
    '° ',
    0 |
      (((decimalDegrees =
        (decimalDegrees < 0 ? -decimalDegrees : decimalDegrees) + 1e-4) %
        1) *
        60),
    "' ",
    0 | (((decimalDegrees * 60) % 1) * 60),
    '"',
  ].join('')

// for this app we create two leaflet layer groups to control, one for the isochrone centers and one for the isochrone contours
const isoCenterLayer = L.featureGroup()
const isoPolygonLayer = L.featureGroup()
const isoLocationsLayer = L.featureGroup()
const routeMarkersLayer = L.featureGroup()
const routeLineStringLayer = L.featureGroup()
const highlightRouteSegmentlayer = L.featureGroup()
const highlightRouteIndexLayer = L.featureGroup()
const excludePolygonsLayer = L.featureGroup()
const vroomLayer = L.featureGroup()
const trafficLayer = L.featureGroup([], {
  zIndex: 1450  // Set higher than default route layers
})

const centerCoords = process.env.REACT_APP_CENTER_COORDS.split(',')
let center = [parseFloat(centerCoords[0]), parseFloat(centerCoords[1])]
let zoom_initial = 10

if (localStorage.getItem('last_center')) {
  const last_center = JSON.parse(localStorage.getItem('last_center'))
  center = last_center.center
  zoom_initial = last_center.zoom_level
}

const maxBoundsString = process.env.REACT_APP_MAX_BOUNDS?.split(',')
const maxBounds = maxBoundsString
  ? [
      //south west corner
      [parseFloat(maxBoundsString[0]), parseFloat(maxBoundsString[1])],
      //north east corner
      [parseFloat(maxBoundsString[2]), parseFloat(maxBoundsString[3])],
    ]
  : undefined

// a leaflet map consumes parameters, I'd say they are quite self-explanatory
const mapParams = {
  center,
  maxBounds,
  maxBoundsViscosity: 1.0,
  zoomControl: false,
  zoom: zoom_initial,
  maxZoom: 18,
  minZoom: 2,
  worldCopyJump: true,
  layers: [
    isoCenterLayer,
    routeMarkersLayer,
    isoPolygonLayer,
    isoLocationsLayer,
    routeLineStringLayer,
    highlightRouteSegmentlayer,
    highlightRouteIndexLayer,
    excludePolygonsLayer,
    OSMTiles,
    vroomLayer,
    trafficLayer,
  ],
}

const routeObjects = {
  [OSRM_API_URL]: {
    color: '#0066ff',
    alternativeColor: '#66a3ff',
    name: 'OSRM',
  },
}

// Wrap the existing Map class component to access context
function MapWithContext(props) {
  const vroomContext = useVroomContext();
  return <Map {...props} vroomContext={vroomContext} />;
}

const NOMINATIM_REVERSE_URL = 'https://nominatim.trucksapp.ir/reverse';

// this you have seen before, we define a react component
class Map extends React.Component {
  static propTypes = {
    dispatch: PropTypes.func.isRequired,
    directions: PropTypes.object,
    isochrones: PropTypes.object,
    profile: PropTypes.string,
    activeTab: PropTypes.number,
    activeDataset: PropTypes.string,
    showRestrictions: PropTypes.object,
    coordinates: PropTypes.array,
    zoomLevel: PropTypes.number,
    showDirectionsPanel: PropTypes.bool,
    showSettings: PropTypes.bool,
    vroomContext: PropTypes.object.isRequired,
  }

  constructor(props) {
    super(props)
    this.layerControl = null
    this.state = {
      showPopup: false,
      isLocateLoading: false,
      isHeightLoading: false,
      locate: [],
      selectedRouteIndex: -1,
    }
  }

  // and once the component has mounted we add everything to it
  componentDidMount() {
    // our map!
    //const { dispatch } = this.props

    this.map = L.map('map', mapParams)

    // we create a leaflet pane which will hold all isochrone polygons with a given opacity
    const isochronesPane = this.map.createPane('isochronesPane')
    isochronesPane.style.opacity = 0.9

    // our basemap and add it to the map
    const baseMaps = {
      OpenStreetMap: OSMTiles,
    }

    const overlayMaps = {
      Waypoints: routeMarkersLayer,
      'Isochrone Center': isoCenterLayer,
      Routes: routeLineStringLayer,
      Isochrones: isoPolygonLayer,
      'Isochrones (locations)': isoLocationsLayer,
    }

    this.layerControl = L.control.layers(baseMaps, overlayMaps).addTo(this.map)

    // we do want a zoom control
    L.control
      .zoom({
        position: 'topright',
      })
      .addTo(this.map)

    //and for the sake of advertising your company, you may add a logo to the map
    const brand = L.control({
      position: 'bottomleft',
    })
    brand.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'brand')
      div.innerHTML =
        '<a href="https://fossgis.de/news/2021-11-12_funding_valhalla/" target="_blank"><div class="fossgis-logo"></div></a>'
      return div
    }

    this.map.addControl(brand)

    const valhallaBrand = L.control({
      position: 'bottomleft',
    })
    valhallaBrand.onAdd = (map) => {
      const div = L.DomUtil.create('div', 'brand')
      div.innerHTML =
        '<a href="https://github.com/valhalla/valhalla" target="_blank"><div class="valhalla-logo"></div></a>'
      return div
    }

    this.map.addControl(valhallaBrand)

    const popup = L.popup({ className: 'valhalla-popup' })

    this.map.on('popupclose', (event) => {
      this.setState({ hasCopied: false, locate: [] })
    })
    this.map.on('contextmenu', (event) => {
      popup.setLatLng(event.latlng).openOn(this.map)

      setTimeout(() => {
        // as setContent needs the react dom we are setting the state here
        // to showPopup which then again renders a react portal in the render
        // return function..
        this.setState({
          showPopup: true,
          showInfoPopup: false,
          latLng: event.latlng,
        })

        popup.update()
      }, 20) //eslint-disable-line
    })

    this.map.on('click', (event) => {
      if (
        !this.map.pm.globalRemovalEnabled() &&
        !this.map.pm.globalDrawModeEnabled()
      ) {
        popup.setLatLng(event.latlng).openOn(this.map)

        this.getHeight(event.latlng)

        setTimeout(() => {
          this.setState({
            showPopup: true,
            showInfoPopup: false,
            latLng: event.latlng,
          })
          popup.update()
        }, 20)
      }
    })

    this.map.on('moveend', () => {
      const last_coords = this.map.getCenter()
      const zoom_level = this.map.getZoom()

      const last_center = JSON.stringify({
        center: [last_coords.lat, last_coords.lng],
        zoom_level: zoom_level,
      })
      localStorage.setItem('last_center', last_center)
    })

    this.map.pm.setGlobalOptions({
      layerGroup: excludePolygonsLayer,
    })

    this.map.on('pm:create', ({ layer }) => {
      layer.on('pm:edit', (e) => {
        this.updateExcludePolygons()
      })
      layer.on('pm:dragend', (e) => {
        this.updateExcludePolygons()
      })
      this.updateExcludePolygons()
    })

    this.map.on('pm:remove', (e) => {
      this.updateExcludePolygons()
    })

    const getHeightData = this.getHeightData
    const { showDirectionsPanel } = this.props
    this.hg = L.control.heightgraph({
      mappings: colorMappings,
      graphStyle: {
        opacity: 0.9,
        'fill-opacity': 1,
        'stroke-width': '0px',
      },
      translation: {
        distance: 'Distance from start',
      },
      expandCallback(expand) {
        if (expand) {
          getHeightData()
        }
      },
      expandControls: true,
      expand: false,
      highlightStyle: {
        color: 'blue',
      },
      width: showDirectionsPanel
        ? window.innerWidth * 0.75
        : window.innerWidth * 0.9,
    })
    this.hg.addTo(this.map)
    const hg = this.hg
    // Added title property to heightgraph-toggle element to show "Height Graph" tooltip
    $('.heightgraph-toggle').prop('title', 'Height Graph')
    $('.heightgraph').resizable({
      handles: 'w, n, nw',
      minWidth: 380,
      minHeight: 140,
      stop: function (event, ui) {
        // Remove the size/position of the UI element (.heightgraph .leaflet-control) because
        // it should be sized dynamically based on its contents. Giving it a fixed size causes
        // the toggle icon to be in the wrong place when the height graph is minimized.
        ui.element.css({ width: '', height: '', left: '', top: '' })
      },
      resize: function (event, ui) {
        if (
          ui.originalPosition.left !== ui.position.left ||
          ui.originalPosition.top !== ui.position.top
        ) {
          // left/upper edge was dragged => only keep size change since we're sticking to the right/bottom
          ui.position.left = 0
          ui.position.top = 0
        }
        hg.resize(ui.size)
      },
    })

    // this.map.on('moveend', () => {
    //   dispatch(doUpdateBoundingBox(this.map.getBounds()))
    // })
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (
      // we want to make sure only the addresses are compared

      !R.equals(
        this.props.directions.selectedAddresses,
        nextProps.directions.selectedAddresses
      ) ||
      !R.equals(
        this.props.isochrones.selectedAddress,
        nextProps.isochrones.selectedAddress
      )
    ) {
      return true
    }

    if (this.state.showPopup || nextState.showPopup) {
      return true
    }

    if (this.props.directions.successful !== nextProps.directions.successful) {
      return true
    }

    if (this.props.isochrones.successful !== nextProps.isochrones.successful) {
      return true
    }

    if (
      !R.equals(this.props.directions.results, nextProps.directions.results)
    ) {
      return true
    }

    if (
      !R.equals(
        this.props.directions.highlightSegment,
        nextProps.directions.highlightSegment
      )
    ) {
      return true
    }

    if (
      !R.equals(this.props.directions.zoomObj, nextProps.directions.zoomObj)
    ) {
      return true
    }

    if (
      !R.equals(this.props.isochrones.results, nextProps.isochrones.results)
    ) {
      return true
    }

    if (!R.equals(this.props.showRestrictions, nextProps.showRestrictions)) {
      return true
    }

    if (!R.equals(this.props.coordinates, nextProps.coordinates)) {
      return true
    }

    if (this.props.activeDataset !== nextProps.activeDataset) {
      return true
    }

    return false
  }

  componentDidUpdate = (prevProps, prevState) => {
    this.addWaypoints()
    this.addIsoCenter()
    this.addIsochrones()
    this.addJobs()

    if (!R.equals(this.props.coordinates, prevProps.coordinates)) {
      this.zoomToCoordinates()
    }
    if (
      prevProps.directions.zoomObj.timeNow <
      this.props.directions.zoomObj.timeNow
    ) {
      this.zoomTo(this.props.directions.zoomObj.index)
    }

    this.addRoutes()
    this.handleHighlightSegment()

    const { directions, isochrones } = this.props

    if (!directions.successful) {
      routeLineStringLayer.clearLayers()
    }
    if (!isochrones.successful) {
      isoPolygonLayer.clearLayers()
      isoLocationsLayer.clearLayers()
    }

    // Add this to update route display when solution changes
    const { vroomContext } = this.props;
    if (vroomContext.solution !== prevProps.vroomContext.solution) {
      this.displayRoute(vroomContext.solution);
    }

    // Handle traffic data updates
    if (this.props.directions.trafficData !== prevProps.directions.trafficData) {
      this.updateTrafficOverlay(this.props.directions.trafficData);
    }
  }

  zoomToCoordinates = () => {
    const { coordinates, showDirectionsPanel, showSettings, zoomLevel } =
      this.props

    const paddingTopLeft = [
      screen.width < 550 ? 50 : showDirectionsPanel ? 420 : 50,
      50,
    ]

    const paddingBottomRight = [
      screen.width < 550 ? 50 : showSettings ? 420 : 50,
      50,
    ]

    if (zoomLevel) {
      this.map.setView(coordinates[0], zoomLevel)
    } else {
      this.map.fitBounds(coordinates, {
        paddingBottomRight,
        paddingTopLeft,
        maxZoom: coordinates.length === 1 ? 11 : 18,
      })
    }
  }

  zoomTo = (idx) => {
    const { results } = this.props.directions

    const coords = results[OSRM_API_URL].data.decodedGeometry

    this.map.setView(coords[idx], 17)

    const highlightMarker = ExtraMarkers.icon({
      icon: 'fa-coffee',
      markerColor: 'blue',
      shape: 'circle',
      prefix: 'fa',
      iconColor: 'white',
    })

    L.marker(coords[idx], {
      icon: highlightMarker,
      pmIgnore: true,
    }).addTo(highlightRouteIndexLayer)

    setTimeout(() => {
      highlightRouteIndexLayer.clearLayers()
    }, 1000)
  }

  getIsoTooltip = (contour, area, provider) => {
    return `
    <div class="ui list">
        <div class="item">
        <div class="header">
            Isochrone Summary
        </div>
        </div>
        <div class="item">
          <i class="time icon"></i>
          <div class="content">
            ${contour} mins
          </div>
        </div>
        <div class="item">
          <i class="arrows alternate icon"></i>
          <div class="content">
            ${area} km2
          </div>
        </div>
      </div>
    `
  }

  getIsoLocationTooltip = () => {
    return `
    <div class="ui list">
        <div class="item">
          Snapped location
        </div>
      </div>
    `
  }

  handleHighlightSegment = () => {
    const { highlightSegment, results } = this.props.directions

    const { startIndex, endIndex, alternate } = highlightSegment

    let coords
    if (alternate == -1) {
      coords = results[OSRM_API_URL].data.decodedGeometry
    } else {
      coords = results[OSRM_API_URL].data.alternates[alternate].decodedGeometry
    }

    if (startIndex > -1 && endIndex > -1) {
      L.polyline(coords.slice(startIndex, endIndex + 1), {
        color: 'yellow',
        weight: 4,
        opacity: 1,
        pmIgnore: true,
      }).addTo(highlightRouteSegmentlayer)
    } else {
      highlightRouteSegmentlayer.clearLayers()
    }
  }

  handleCopy = () => {
    this.setState({ hasCopied: true })
    setTimeout(() => {
      this.setState({ hasCopied: false })
    }, 1000)
  }

  addIsochrones = () => {
    const { results } = this.props.isochrones
    isoPolygonLayer.clearLayers()
    isoLocationsLayer.clearLayers()

    for (const provider of [VALHALLA_OSM_URL]) {
      if (
        Object.keys(results[provider].data).length > 0 &&
        results[provider].show
      ) {
        for (const feature of results[provider].data.features) {
          const coords_reversed = []
          for (const latLng of feature.geometry.coordinates) {
            coords_reversed.push([latLng[1], latLng[0]])
          }
          if (['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
            L.geoJSON(feature, {
              style: (feat) => ({
                ...feat.properties,
                color: '#fff',
                opacity: 1,
              }),
            })
              .bindTooltip(
                this.getIsoTooltip(
                  feature.properties.contour,
                  feature.properties.area.toFixed(2),
                  provider
                ),
                {
                  permanent: false,
                  sticky: true,
                }
              )
              .addTo(isoPolygonLayer)
          } else {
            // locations

            if (feature.properties.type === 'input') {
              return
            }
            L.geoJSON(feature, {
              pointToLayer: (feat, ll) => {
                return L.circleMarker(ll, {
                  radius: 6,
                  color: '#000',
                  fillColor: '#fff',
                  fill: true,
                  fillOpacity: 1,
                }).bindTooltip(this.getIsoLocationTooltip(), {
                  permanent: false,
                  sticky: true,
                })
              },
            }).addTo(isoLocationsLayer)
          }
        }
      }
    }
  }

  getRouteToolTip = (summary, provider) => {
    return `
    <div class="ui list">
        <div class="item">
          <div class="header">
              Route Summary
          </div>
        </div>
        <div class="item">
          <i class="arrows alternate horizontal icon"></i>
          <div class="content">
            ${summary.length.toFixed(summary.length > 1000 ? 0 : 1)} km
          </div>
        </div>
        <div class="item">
          <i class="time icon"></i>
          <div class="content">
            ${formatDuration(summary.time)}
          </div>
        </div>
      </div>
    `
  }

  addRoutes = () => {
    const { results } = this.props.directions
    const { selectedRouteIndex } = this.state
    routeLineStringLayer.clearLayers()

    if (Object.keys(results[OSRM_API_URL].data).length > 0) {
      const response = results[OSRM_API_URL].data
      const routes = []
      
      // Prepare all routes first
      if (response.alternates) {
        for (let i = 0; i < response.alternates.length; i++) {
          if (!results[OSRM_API_URL].show[i]) continue;
          
          routes.push({
            coords: response.alternates[i].decodedGeometry,
            summary: response.alternates[i].trip.summary,
            index: i,
            isSelected: selectedRouteIndex === i
          });
        }
      }

      if (results[OSRM_API_URL].show[-1]) {
        routes.push({
          coords: response.decodedGeometry,
          summary: response.trip.summary,
          index: -1,
          isSelected: selectedRouteIndex === -1
        });
      }

      // Sort routes to draw selected route last (on top)
      routes.sort((a, b) => {
        if (a.isSelected) return 1;
        if (b.isSelected) return -1;
        return 0;
      });

      // Draw routes in order
      routes.forEach(route => {
        // Background line
        L.polyline(route.coords, {
          color: '#FFF',
          weight: route.isSelected ? 9 : 7,
          opacity: 1,
          pmIgnore: true,
          zIndexOffset: route.isSelected ? 1000 : 0
        }).addTo(routeLineStringLayer)

        // Colored line
        L.polyline(route.coords, {
          color: route.isSelected ? routeObjects[OSRM_API_URL].color : routeObjects[OSRM_API_URL].alternativeColor,
          weight: route.isSelected ? 5 : 3,
          opacity: route.isSelected ? 1 : 0.6,
          pmIgnore: true,
          zIndexOffset: route.isSelected ? 1000 : 0
        })
          .addTo(routeLineStringLayer)
          .bindTooltip(this.getRouteToolTip(route.summary, OSRM_API_URL), {
            permanent: false,
            sticky: true,
          })
      });

      if (this.hg._showState === true) {
        this.hg._expand()
      }

      // Re-add traffic layer on top if it exists
      if (trafficLayer && trafficLayer.getLayers().length > 0) {
        trafficLayer.bringToFront();
      }
    }
  }

  handleAddWaypoint = (data, e) => {
    this.map.closePopup()
    this.updateWaypointPosition({
      latLng: this.state.latLng,
      index: e.index,
    })
  }

  handleAddIsoWaypoint = (data, e) => {
    this.map.closePopup()
    const { latLng } = this.state
    this.updateIsoPosition(latLng)
  }

  updateExcludePolygons() {
    const excludePolygons = []
    excludePolygonsLayer.eachLayer((layer) => {
      const lngLatArray = []
      for (const coords of layer._latlngs[0]) {
        lngLatArray.push([coords.lng, coords.lat])
      }
      excludePolygons.push(lngLatArray)
    })
    const { dispatch } = this.props
    const name = 'exclude_polygons'
    const value = excludePolygons
    dispatch(
      updateSettings({
        name,
        value,
      })
    )
  }

  updateWaypointPosition(object) {
    const { dispatch } = this.props
    dispatch(fetchReverseGeocode(object))
  }

  updateIsoPosition(coord) {
    const { dispatch } = this.props
    dispatch(fetchReverseGeocodeIso(coord.lng, coord.lat))
  }

  addIsoCenter = () => {
    isoCenterLayer.clearLayers()
    const { geocodeResults } = this.props.isochrones
    for (const address of geocodeResults) {
      if (address.selected) {
        const isoMarker = ExtraMarkers.icon({
          icon: 'fa-number',
          markerColor: 'purple',
          shape: 'star',
          prefix: 'fa',
          number: '1',
        })

        L.marker([address.displaylnglat[1], address.displaylnglat[0]], {
          icon: isoMarker,
          draggable: true,
          pmIgnore: true,
        })
          .addTo(isoCenterLayer)
          .bindTooltip(address.title, { permanent: false })
          //.openTooltip()
          .on('dragend', (e) => {
            this.updateIsoPosition(e.target.getLatLng())
          })
      }
    }
  }

  getLocate(latlng) {
    const { profile } = this.props
    this.setState({ isLocateLoading: true })
    axios
      .post(VALHALLA_OSM_URL + '/locate', buildLocateRequest(latlng, profile), {
        headers: {
          'Content-Type': 'application/json',
        },
      })
      .then(({ data }) => {
        this.setState({ locate: data, isLocateLoading: false })
      })
      .catch(({ response }) => {
        console.log(response) //eslint-disable-line
      })
  }

  getHeightData = () => {
    const { results } = this.props.directions
    const { dispatch } = this.props

    const heightPayload = buildHeightRequest(
      results[OSRM_API_URL].data.decodedGeometry
    )

    if (!R.equals(this.state.heightPayload, heightPayload)) {
      this.hg._removeChart()
      this.setState({ isHeightLoading: true, heightPayload })
      axios
        .post(VALHALLA_OSM_URL + '/height', heightPayload, {
          headers: {
            'Content-Type': 'application/json',
          },
        })
        .then(({ data }) => {
          this.setState({ isHeightLoading: false })
          // lets build geojson object with steepness for the height graph
          const reversedGeometry = JSON.parse(
            JSON.stringify(results[OSRM_API_URL].data.decodedGeometry)
          ).map((pair) => {
            return [...pair.reverse()]
          })
          const heightData = buildHeightgraphData(
            reversedGeometry,
            data.range_height
          )
          const { inclineTotal, declineTotal } = heightData[0].properties
          dispatch(
            updateInclineDeclineTotal({
              inclineTotal,
              declineTotal,
            })
          )

          this.hg.addData(heightData)
        })
        .catch(({ response }) => {
          console.log(response) //eslint-disable-line
        })
    }
  }

  getHeight(latLng) {
    this.setState({ isHeightLoading: true })
    axios
      .post(
        VALHALLA_OSM_URL + '/height',
        buildHeightRequest([[latLng.lat, latLng.lng]]),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
      .then(({ data }) => {
        if ('height' in data) {
          this.setState({
            elevation: data.height[0] + ' m',
            isHeightLoading: false,
          })
        }
      })
      .catch(({ response }) => {
        console.log(response) //eslint-disable-line
      })
  }

  addWaypoints() {
    routeMarkersLayer.clearLayers()
    const { waypoints } = this.props.directions
    let index = 0
    for (const waypoint of waypoints) {
      for (const address of waypoint.geocodeResults) {
        if (address.selected) {
          const wpMarker = ExtraMarkers.icon({
            icon: 'fa-number',
            markerColor: 'green',
            //shape: 'star',
            prefix: 'fa',
            number: (index + 1).toString(),
          })

          L.marker([address.displaylnglat[1], address.displaylnglat[0]], {
            icon: wpMarker,
            draggable: true,
            index: index,
            pmIgnore: true,
          })
            .addTo(routeMarkersLayer)
            .bindTooltip(address.title, {
              permanent: false,
            })
            //.openTooltip()
            .on('dragend', (e) => {
              this.updateWaypointPosition({
                latLng: e.target.getLatLng(),
                index: e.target.options.index,
                fromDrag: true,
              })
            })
        }
      }
      index += 1
    }
  }

  handleOpenOSM = () => {
    const { map } = this
    const { lat, lng } = map.getCenter()
    const zoom = map.getZoom()
    const osmURL = `https://www.openstreetmap.org/#map=${zoom}/${lat}/${lng}`
    window.open(osmURL, '_blank')
  }

  handleRouteSelect = (index) => {
    this.setState({ selectedRouteIndex: index }, () => {
      this.addRoutes()
    })
  }

  handleReverseGeocode = async (latlng) => {
    try {
      const response = await fetch(
        `${NOMINATIM_REVERSE_URL}?lat=${latlng.lat}&lon=${latlng.lng}&format=json`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Create shorter address format
      const shortAddress = [
        data.address.road,
        data.address.suburb,
        data.address.city || data.address.town
      ].filter(Boolean).join(', ');
      
      return {
        ...data,
        shortAddress
      };
    } catch (error) {
      console.error('Error fetching reverse geocode:', error);
      return null;
    }
  };

  handleAddJob = async () => {
    const { latLng } = this.state;
    const { vroomContext } = this.props;
    
    this.map.closePopup();
    
    const geocodeData = await this.handleReverseGeocode(latLng);
    
    if (geocodeData) {
      const location = [
        parseFloat(geocodeData.lat),
        parseFloat(geocodeData.lon)
      ];
      
      const newJob = {
        id: Date.now(),
        location: location,
        address: geocodeData.shortAddress // Use shorter address
      };
      
      vroomContext.addJob(newJob);
      
      const jobMarker = L.marker(location, {
        icon: ExtraMarkers.icon({
          icon: 'fa-box',
          markerColor: 'blue',
          shape: 'square',
          prefix: 'fa',
          iconColor: 'white',
        }),
        pmIgnore: true,
      }).addTo(vroomLayer);

      jobMarker.bindPopup(`Job ${newJob.id}<br/>${geocodeData.shortAddress}`);
    }
  };

  handleSetVehiclePosition = async (vehicleId, type) => {
    const { latLng } = this.state;
    const { vroomContext } = this.props;
    
    this.map.closePopup();
    
    const geocodeData = await this.handleReverseGeocode(latLng);
    
    if (geocodeData) {
      const position = [
        parseFloat(geocodeData.lat),
        parseFloat(geocodeData.lon)
      ];
      
      const addressKey = type === 'start' ? 'startAddress' : 'endAddress';
      vroomContext.updateVehiclePosition(vehicleId, type, position, geocodeData.shortAddress);
      
      const marker = L.marker(position, {
        icon: ExtraMarkers.icon({
          icon: type === 'start' ? 'fa-play' : 'fa-stop',
          markerColor: 'green',
          shape: 'circle',
          prefix: 'fa',
          iconColor: 'white',
        }),
        pmIgnore: true,
      }).addTo(vroomLayer);

      marker.bindPopup(
        `Vehicle ${vehicleId} ${type} position<br/>${geocodeData.shortAddress}`
      );
    }
  };

  addJobs = () => {
    const { vroomContext } = this.props;
    vroomLayer.clearLayers();
    
    // Add job markers
    vroomContext.jobs.forEach(job => {
      const jobMarker = L.marker(job.location, {
        icon: ExtraMarkers.icon({
          icon: 'fa-box',
          markerColor: 'blue',
          shape: 'square',
          prefix: 'fa',
          iconColor: 'white',
        }),
        pmIgnore: true,
      }).addTo(vroomLayer);

      jobMarker.bindPopup(`Job ${job.id}`);
    });

    // Add vehicle position markers
    vroomContext.vehicles.forEach(vehicle => {
      if (vehicle.start) {
        const startMarker = L.marker(vehicle.start, {
          icon: ExtraMarkers.icon({
            icon: 'fa-play',
            markerColor: 'green',
            shape: 'circle',
            prefix: 'fa',
            iconColor: 'white',
          }),
          pmIgnore: true,
        }).addTo(vroomLayer);
        startMarker.bindPopup(`Vehicle ${vehicle.id} start position`);
      }

      if (vehicle.end) {
        const endMarker = L.marker(vehicle.end, {
          icon: ExtraMarkers.icon({
            icon: 'fa-stop',
            markerColor: 'green',
            shape: 'circle',
            prefix: 'fa',
            iconColor: 'white',
          }),
          pmIgnore: true,
        }).addTo(vroomLayer);
        endMarker.bindPopup(`Vehicle ${vehicle.id} end position`);
      }
    });
  }

  displayRoute = (solution) => {
    if (!solution || !solution.routes) return;
    
    routeLineStringLayer.clearLayers();
    
    solution.routes.forEach((route) => {
      if (route.geometry) {
        // Use polyline.decode directly
        const coordinates = polyline.decode(route.geometry);
        
        // Create the route line
        const routeLine = L.polyline(coordinates, {
          color: '#0066ff',
          weight: 5,
          opacity: 0.7
        }).addTo(routeLineStringLayer);

        // Add markers for each step with sequence numbers
        route.steps.forEach((step, index) => {
          const icon = this.getStepIcon(step.type, index + 1);
          const marker = L.marker([step.location[1], step.location[0]], { icon })
            .addTo(routeLineStringLayer);
          
          const popupContent = this.getStepPopupContent(step, index + 1);
          marker.bindPopup(popupContent);
        });
      }
    });

    // Fit map to show all route elements
    const bounds = routeLineStringLayer.getBounds();
    this.map.fitBounds(bounds, { padding: [50, 50] });
  };

  getStepIcon = (type, sequence) => {
    let icon;
    switch (type) {
      case 'start':
        icon = 'fa-play';
        break;
      case 'end':
        icon = 'fa-stop';
        break;
      case 'job':
        icon = 'fa-box';
        break;
      default:
        icon = 'fa-circle';
    }

    return ExtraMarkers.icon({
      icon,
      markerColor: type === 'job' ? 'blue' : 'green',
      shape: 'circle',
      prefix: 'fa',
      iconColor: 'white',
      number: sequence
    });
  };

  getStepPopupContent = (step, sequence) => {
    const formatDuration = (seconds) => {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} min`;
    };

    let content = `<b>${step.type.toUpperCase()}</b><br/>`;
    content += `Sequence: ${sequence}<br/>`;
    content += `Arrival: ${formatDuration(step.arrival)}<br/>`;
    if (step.type === 'job') {
      content += `Job ID: ${step.job}<br/>`;
    }
    content += `Distance: ${(step.distance / 1000).toFixed(2)} km`;
    
    return content;
  };

  renderRouteList = () => {
    const { results } = this.props.directions
    const { selectedRouteIndex } = this.state

    if (!results[OSRM_API_URL]?.data?.trip) return null

    const routes = [
      {
        summary: results[OSRM_API_URL].data.trip.summary,
        index: -1,
        isMain: true
      },
      ...(results[OSRM_API_URL].data.alternates || []).map((alt, idx) => ({
        summary: alt.trip.summary,
        index: idx,
        isMain: false
      }))
    ]

    return (
      <div className="route-list" style={{
        position: 'absolute',
        top: '80px',
        right: '10px',
        zIndex: 1000,
        backgroundColor: 'white',
        padding: '10px',
        borderRadius: '4px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
      }}>
        {routes.map((route) => (
          <div
            key={route.index}
            onClick={() => this.handleRouteSelect(route.index)}
            style={{
              padding: '8px',
              margin: '4px 0',
              cursor: 'pointer',
              backgroundColor: selectedRouteIndex === route.index ? '#e0e7ff' : 'white',
              border: selectedRouteIndex === route.index ? '2px solid #4f46e5' : '1px solid #ccc',
              borderRadius: '4px',
              transition: 'all 0.2s ease',
              transform: selectedRouteIndex === route.index ? 'scale(1.02)' : 'scale(1)',
            }}
          >
            <div style={{ 
              fontWeight: selectedRouteIndex === route.index ? 'bold' : 'normal' 
            }}>
              Route {route.isMain ? '(Main)' : route.index + 1}
            </div>
            <div>Distance: {route.summary.length.toFixed(1)} km</div>
            <div>Duration: {formatDuration(route.summary.time)}</div>
          </div>
        ))}
      </div>
    )
  }

  render() {
    const { activeTab } = this.props
    const MapPopup = (isInfo) => {
      const { vroomContext } = this.props;
      
      return (
        <React.Fragment>
          {isInfo ? (
            <React.Fragment>
              <div>
                <Button.Group basic size="tiny">
                  <Popup
                    size="tiny"
                    content="Longitude, Latitude"
                    trigger={
                      <Button
                        compact
                        content={
                          this.state.latLng.lng.toFixed(6) +
                          ', ' +
                          this.state.latLng.lat.toFixed(6)
                        }
                      />
                    }
                  />
                  <CopyToClipboard
                    text={
                      this.state.latLng.lng.toFixed(6) +
                      ',' +
                      this.state.latLng.lat.toFixed(6)
                    }
                    onCopy={this.handleCopy}
                  >
                    <Button compact icon="copy" />
                  </CopyToClipboard>
                </Button.Group>
              </div>

              <div className="mt1 flex">
                <Button.Group basic size="tiny">
                  <Popup
                    size="tiny"
                    content="Latitude, Longitude"
                    trigger={
                      <Button
                        compact
                        content={
                          this.state.latLng.lat.toFixed(6) +
                          ', ' +
                          this.state.latLng.lng.toFixed(6)
                        }
                      />
                    }
                  />
                  <CopyToClipboard
                    text={
                      this.state.latLng.lat.toFixed(6) +
                      ',' +
                      this.state.latLng.lng.toFixed(6)
                    }
                    onCopy={this.handleCopy}
                  >
                    <Button compact icon="copy" />
                  </CopyToClipboard>
                </Button.Group>
              </div>
              <div className="mt1 flex">
                <Button.Group basic size="tiny">
                  <Popup
                    size="tiny"
                    content="Latitude, Longitude"
                    trigger={
                      <Button
                        compact
                        content={
                          convertDDToDMS(this.state.latLng.lat) +
                          ' N ' +
                          convertDDToDMS(this.state.latLng.lng) +
                          ' E'
                        }
                      />
                    }
                  />
                  <CopyToClipboard
                    text={
                      convertDDToDMS(this.state.latLng.lat) +
                      ' N ' +
                      convertDDToDMS(this.state.latLng.lng) +
                      ' E'
                    }
                    onCopy={this.handleCopy}
                  >
                    <Button compact icon="copy" />
                  </CopyToClipboard>
                </Button.Group>
              </div>

              <div className="mt1">
                <Button.Group basic size="tiny">
                  <Popup
                    size="tiny"
                    content="Calls Valhalla's Locate API"
                    trigger={
                      <Button
                        onClick={() => this.getLocate(this.state.latLng)}
                        compact
                        loading={this.state.isLocateLoading}
                        icon="cogs"
                        content="Locate Point"
                      />
                    }
                  />
                  <CopyToClipboard
                    text={JSON.stringify(this.state.locate)}
                    onCopy={this.handleCopy}
                  >
                    <Button
                      disabled={this.state.locate.length === 0}
                      compact
                      icon="copy"
                    />
                  </CopyToClipboard>
                </Button.Group>
              </div>
              <div className="mt1">
                <Button.Group basic size="tiny">
                  <Popup
                    size="tiny"
                    content="Copies a Valhalla location object to clipboard which you can use for your API requests"
                    trigger={
                      <Button
                        compact
                        icon="map marker alternate"
                        content="Valhalla Location JSON"
                      />
                    }
                  />
                  <CopyToClipboard
                    text={`{
                        "lon": ${this.state.latLng.lng.toFixed(6)},
                        "lat": ${this.state.latLng.lat.toFixed(6)}
                      }`}
                    onCopy={this.handleCopy}
                  >
                    <Button compact icon="copy" />
                  </CopyToClipboard>
                </Button.Group>
              </div>
              <div className="mt1 flex justify-between">
                <Popup
                  size="tiny"
                  content="Elevation at this point"
                  trigger={
                    <Button
                      basic
                      compact
                      size="tiny"
                      loading={this.state.isHeightLoading}
                      icon="resize vertical"
                      content={this.state.elevation}
                    />
                  }
                />

                <div>
                  {this.state.hasCopied && (
                    <Label size="mini" basic color="green">
                      <Icon name="checkmark" /> copied
                    </Label>
                  )}
                </div>
              </div>
            </React.Fragment>
          ) : activeTab === 0 ? (
            <React.Fragment>
              <Button.Group size="small" basic vertical>
                <Button compact onClick={this.handleAddJob}>
                  Add Job Here
                </Button>
                {vroomContext.vehicles.map(vehicle => (
                  <React.Fragment key={vehicle.id}>
                    <Button 
                      compact 
                      onClick={() => this.handleSetVehiclePosition(vehicle.id, 'start')}
                    >
                      Set Vehicle {vehicle.id} Start
                    </Button>
                    <Button 
                      compact 
                      onClick={() => this.handleSetVehiclePosition(vehicle.id, 'end')}
                    >
                      Set Vehicle {vehicle.id} End
                    </Button>
                  </React.Fragment>
                ))}
              </Button.Group>
            </React.Fragment>
          ) : activeTab === 1 ? (
            <React.Fragment>
              <Button.Group size="small" basic vertical>
                <Button compact index={0} onClick={this.handleAddWaypoint}>
                  Directions from here
                </Button>
                <Button compact index={1} onClick={this.handleAddWaypoint}>
                  Add as via point
                </Button>
                <Button compact index={-1} onClick={this.handleAddWaypoint}>
                  Directions to here
                </Button>
              </Button.Group>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <Button.Group size="small" basic vertical>
                <Button index={0} onClick={this.handleAddIsoWaypoint}>
                  Set center here
                </Button>
              </Button.Group>
            </React.Fragment>
          )}
        </React.Fragment>
      )
    }

    const leafletPopupDiv = document.querySelector('.leaflet-popup-content')
    return (
      <React.Fragment>
        <div>
          <ToastContainer
            position="bottom-center"
            autoClose={5000}
            limit={1}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme="light"
          />
          <div id="map" className="map-style" />
          {this.renderRouteList()}
          <button
            className="ui primary button"
            id="osm-button"
            onClick={this.handleOpenOSM}
          >
            Open OSM
          </button>
        </div>
        <div>
          {this.state.showPopup && leafletPopupDiv
            ? ReactDOM.createPortal(
                MapPopup(this.state.showInfoPopup),
                leafletPopupDiv
              )
            : null}
        </div>
      </React.Fragment>
    )
  }

  updateTrafficOverlay = (trafficData) => {
    if (!trafficData) return;

    // Clear existing traffic layers
    trafficLayer.clearLayers();

    trafficData.forEach(routeTraffic => {
      routeTraffic.segments.forEach(segment => {
        // Convert WKT to GeoJSON
        const coordinates = segment.geometry
          .replace('LINESTRING(', '')
          .replace(')', '')
          .split(',')
          .map(coord => {
            const [lng, lat] = coord.trim().split(' ');
            return [parseFloat(lat), parseFloat(lng)];
          });

        // Create polyline with traffic color and higher z-index
        const trafficLine = L.polyline(coordinates, {
          color: getTrafficColor(segment.level),
          weight: 5,
          opacity: 0.7,
          zIndex: 1500, // Even higher than selected route
          pane: 'overlayPane'
        });

        trafficLayer.addLayer(trafficLine);
      });
    });

    // Add traffic layer to map if not already added
    if (!this.map.hasLayer(trafficLayer)) {
      this.map.addLayer(trafficLayer);
    }

    // Ensure traffic layer is always on top
    trafficLayer.bringToFront();
  }
}

const mapStateToProps = (state) => {
  const { directions, isochrones, common } = state
  const {
    activeTab,
    profile,
    showRestrictions,
    activeDataset,
    coordinates,
    showDirectionsPanel,
    showSettings,
    zoomLevel,
  } = common
  return {
    directions,
    isochrones,
    profile,
    coordinates,
    activeTab,
    activeDataset,
    showRestrictions,
    showDirectionsPanel,
    showSettings,
    zoomLevel,
  }
}

export default connect(mapStateToProps)(MapWithContext);
