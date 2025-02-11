/* eslint-disable */
import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { Segment, Button, Icon, Divider } from 'semantic-ui-react'
import { useVroomContext } from '../../context/VroomContext'

class OutputControl extends React.Component {
  static propTypes = {
    dispatch: PropTypes.func.isRequired,
    profile: PropTypes.string,
    activeTab: PropTypes.number,
  }

  constructor(props) {
    super(props)
    this.state = {
      showResults: false
    }
  }

  toggleResults = () => {
    this.setState(prevState => ({
      showResults: !prevState.showResults
    }))
  }

  render() {
    const { solution } = this.props

    if (!solution) {
      return null
    }

    return (
      <Segment
        style={{
          margin: '0 1rem 10px',
          display: 'block'
        }}
      >
        <div className={'flex-column'}>
          <div className={'flex justify-between'}>
            <div>
              <h4>Route Solution</h4>
              <p>Total Distance: {(solution.summary.distance / 1000).toFixed(2)} km</p>
              <p>Duration: {(solution.summary.duration / 60).toFixed(2)} minutes</p>
            </div>
            <div className={'flex'}>
              <div
                className={'flex pointer'}
                style={{ alignSelf: 'center' }}
                onClick={this.exportToJson}
              >
                <Icon circular name={'download'} />
                <div className={'pa1 b f6'}>{'JSON'}</div>
              </div>
            </div>
          </div>

          <Divider />

          <Button
            size="mini"
            toggle
            active={this.state.showResults}
            onClick={this.toggleResults}
          >
            {this.state.showResults ? 'Hide Details' : 'Show Details'}
          </Button>

          {this.state.showResults && (
            <div className={'flex-column mt3'}>
              {solution.routes.map((route, index) => (
                <div key={index} className="mb3">
                  <h5>Vehicle {route.vehicle}</h5>
                  {route.steps.map((step, stepIndex) => (
                    <div key={stepIndex} className="ml3 mb2">
                      {step.type === 'job' ? (
                        <span>Job {step.job}</span>
                      ) : (
                        <span>{step.type}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </Segment>
    )
  }
}

const mapStateToProps = (state) => {
  const { profile, activeTab } = state.common
  return {
    profile,
    activeTab
  }
}

const ConnectedOutputControl = connect(mapStateToProps)(OutputControl)

// Wrapper to access context
export default function OutputControlWrapper(props) {
  const { solution } = useVroomContext()
  return <ConnectedOutputControl {...props} solution={solution} />
} 