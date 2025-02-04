import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import Drawer from 'react-modern-drawer'
import 'react-modern-drawer/dist/index.css'
import { toast } from 'react-toastify'
import DirectionsControl from './Directions'
import IsochronesControl from './Isochrones'
import DirectionOutputControl from './Directions/OutputControl'
import IsochronesOutputControl from './Isochrones/OutputControl'
import { Segment, Tab, Button, Icon, ButtonGroup } from 'semantic-ui-react'
import {
  updateTab,
  updateProfile,
  updatePermalink,
  zoomTo,
  resetSettings,
  toggleDirections,
} from 'actions/commonActions'
import { fetchReverseGeocodePerma } from 'actions/directionsActions'
import {
  fetchReverseGeocodeIso,
  updateIsoSettings,
} from 'actions/isochronesActions'
import { VALHALLA_OSM_URL } from 'utils/valhalla'

const pairwise = (arr, func) => {
  let cnt = 0
  for (let i = 0; i < arr.length - 1; i += 2) {
    func(arr[i], arr[i + 1], cnt)
    cnt += 1
  }
}

const COUNTRY_COORDINATES = {
  Iran: { lat: 32.4279, lng: 53.688, zoom: 6 },
  Iraq: { lat: 33.2232, lng: 43.6793, zoom: 6 },
  UAE: { lat: 23.4241, lng: 53.8478, zoom: 7 },
  'Saudi Arabia': { lat: 23.8859, lng: 45.0792, zoom: 6 },
  Oman: { lat: 21.4735, lng: 55.9754, zoom: 7 },
  Bahrain: { lat: 26.0667, lng: 50.5577, zoom: 9 },
  Qatar: { lat: 25.3548, lng: 51.1839, zoom: 8 },
}

class MainControl extends React.Component {
  static propTypes = {
    dispatch: PropTypes.func.isRequired,
    message: PropTypes.object,
    activeDataset: PropTypes.string,
    activeTab: PropTypes.number,
    showDirectionsPanel: PropTypes.bool,
    lastUpdate: PropTypes.object,
  }

  async getLastUpdate() {
    const response = await fetch(`${VALHALLA_OSM_URL}/status`)
    const data = await response.json()
    this.setState({
      lastUpdate: new Date(data.tileset_last_modified * 1000),
    })
  }

  componentDidMount = () => {
    const { dispatch } = this.props

    this.getLastUpdate()

    toast.success(
      'Welcome to Valhalla! Global Routing Service - funded by FOSSGIS e.V.',
      {
        position: 'bottom-center',
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: 'light',
      }
    )

    const params = Object.fromEntries(new URL(document.location).searchParams)

    if ('profile' in params) {
      dispatch(updateProfile({ profile: params.profile }))
    }

    let activeTab
    if (
      window.location.pathname === '/' ||
      window.location.pathname === '/directions'
    ) {
      activeTab = 0
      dispatch(updateTab({ activeTab }))
    } else if (window.location.pathname === '/isochrones') {
      activeTab = 1
      dispatch(updateTab({ activeTab }))
    }

    if ('wps' in params && params.wps.length > 0) {
      const coordinates = params.wps.split(',').map(Number)
      const processedCoords = []
      pairwise(coordinates, (current, next, i) => {
        const latLng = { lat: next, lng: current }
        const payload = {
          latLng,
          fromPerma: true,
          permaLast: i === coordinates.length / 2 - 1,
          index: i,
        }
        processedCoords.push([latLng.lat, latLng.lng])
        if (activeTab === 0) {
          dispatch(fetchReverseGeocodePerma(payload))
        } else {
          dispatch(fetchReverseGeocodeIso(current, next))

          if ('range' in params && 'interval' in params) {
            const maxRangeName = 'maxRange'
            const intervalName = 'interval'
            const maxRangeValue = params.range
            const intervalValue = params.interval

            dispatch(
              updateIsoSettings({
                maxRangeName,
                intervalName,
                value: maxRangeValue,
              })
            )
            dispatch(
              updateIsoSettings({
                undefined,
                intervalName,
                value: intervalValue,
              })
            )
          }

          if ('denoise' in params) {
            dispatch(
              updateIsoSettings({
                denoiseName: 'denoise',
                value: params.denoise,
              })
            )
          }
          if ('generalize' in params) {
            dispatch(
              updateIsoSettings({
                generalizeName: 'generalize',
                value: params.generalize,
              })
            )
          }
        }
      })
      dispatch(zoomTo(processedCoords))
      dispatch(resetSettings())
    }
  }

  componentDidUpdate = (prevProps) => {
    const { message } = this.props
    if (message.receivedAt > prevProps.message.receivedAt) {
      toast[message.type](message.description, {
        position: 'bottom-center',
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: 'light',
      })
    }
  }

  handleTabChange = (event, data) => {
    const { dispatch } = this.props
    const activeTab = data.activeIndex

    dispatch(updateTab({ activeTab }))
    dispatch(updatePermalink())
  }

  handleDirectionsToggle = (event, data) => {
    const { dispatch } = this.props
    const { showDirectionsPanel } = this.props
    if (!showDirectionsPanel) {
      document
        .getElementsByClassName('heightgraph-container')[0]
        .setAttribute('width', window.innerWidth * 0.75)
    } else {
      document
        .getElementsByClassName('heightgraph-container')[0]
        .setAttribute('width', window.innerWidth * 0.9)
    }
    dispatch(toggleDirections())
  }

  handleCountryClick = (country) => {
    const { dispatch } = this.props
    const coords = COUNTRY_COORDINATES[country]
    dispatch(zoomTo([[coords.lat, coords.lng]], coords.zoom))
  }

  render() {
    const { activeTab } = this.props
    const appPanes = [
      {
        menuItem: 'Directions',
        render: () => (
          <Tab.Pane style={{ padding: '0 0 0 0' }} attached={false}>
            <DirectionsControl />
          </Tab.Pane>
        ),
      },
      {
        menuItem: 'Isochrones',
        render: () => (
          <Tab.Pane style={{ padding: '0 0 0 0' }} attached={false}>
            <IsochronesControl />
          </Tab.Pane>
        ),
      },
    ]

    const ServiceTabs = () => (
      <>
        <Button
          icon
          style={{ float: 'right', marginLeft: '5px' }}
          onClick={this.handleDirectionsToggle}
        >
          <Icon name="close" />
        </Button>
        <Tab
          activeIndex={activeTab}
          onTabChange={this.handleTabChange}
          menu={{ pointing: true }}
          panes={appPanes}
        />
      </>
    )

    return (
      <>
        <Button
          primary
          style={{
            zIndex: 998,
            top: '10px',
            left: '10px',
            position: 'absolute',
          }}
          onClick={this.handleDirectionsToggle}
        >
          {activeTab === 0 ? 'Directions' : 'Isochrones'}
        </Button>

        <ButtonGroup
          style={{
            zIndex: 998,
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            position: 'absolute',
          }}
        >
          {Object.keys(COUNTRY_COORDINATES).map((country) => (
            <Button
              key={country}
              onClick={() => this.handleCountryClick(country)}
            >
              {country}
            </Button>
          ))}
        </ButtonGroup>

        <Drawer
          enableOverlay={false}
          open={this.props.showDirectionsPanel}
          direction="left"
          size="400"
          style={{
            zIndex: 1000,
            overflow: 'auto',
          }}
        >
          <div>
            <Segment basic style={{ paddingBottom: 0 }}>
              <div>
                <ServiceTabs />
              </div>
            </Segment>
            {(activeTab === 0 && <DirectionOutputControl />) || (
              <IsochronesOutputControl />
            )}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-start',
              margin: '1rem',
            }}
          >
            Last Data Update:{' '}
            {this.state
              ? `${this.state.lastUpdate
                  .toISOString()
                  .slice(0, 10)}, ${this.state.lastUpdate
                  .toISOString()
                  .slice(11, 16)}`
              : '0000-00-00, 00:00'}
          </div>
        </Drawer>
      </>
    )
  }
}

const mapStateToProps = (state) => {
  const { message, activeTab, showDirectionsPanel } = state.common
  return {
    message,
    activeTab,
    showDirectionsPanel,
  }
}

export default connect(mapStateToProps)(MainControl)
