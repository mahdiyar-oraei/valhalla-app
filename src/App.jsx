import React from 'react'

import Map from './Map/Map'
import MainControl from './Controls'
import SettingsPanel from './Controls/settings-panel'
import { VroomProvider } from './context/VroomContext'

class App extends React.Component {
  render() {
    return (
      <VroomProvider>
        <div>
          <Map />
          <MainControl />
          <SettingsPanel />
        </div>
      </VroomProvider>
    )
  }
}

export default App
