import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { Overview } from '../screens/Overview'
import { Recommendations } from '../screens/Recommendations'
import { Campaigns } from '../screens/Campaigns'
import { CreativeLab } from '../screens/CreativeLab'
import { WeeklyReportScreen } from '../screens/WeeklyReportScreen'
import { ClientsDirectory } from '../screens/ClientsDirectory'
import { SettingsScreen } from '../screens/SettingsScreen'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'recommendations', element: <Recommendations /> },
      { path: 'campaigns', element: <Campaigns /> },
      { path: 'creatives', element: <CreativeLab /> },
      { path: 'report', element: <WeeklyReportScreen /> },
      { path: 'clients', element: <ClientsDirectory /> },
      { path: 'settings', element: <SettingsScreen /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
