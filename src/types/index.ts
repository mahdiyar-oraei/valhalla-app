export interface RootState {
  common: CommonState
  directions: DirectionsState
  isochrones: IsochronesState
}

export interface CommonState {
  activeTab: number
  showSettings: boolean
  showDirectionsPanel: boolean
  coordinates: Array<[number, number]>
  zoomLevel: number | null
  loading: boolean
  message: Message
  profile: string
  settings: any // Define specific settings interface
  dateTime: DateTime
}

export interface Message {
  receivedAt: number
  type: string | null
  icon: string | null
  topic: string | null
  description: string | null
}

export interface DateTime {
  type: number
  value: string
} 