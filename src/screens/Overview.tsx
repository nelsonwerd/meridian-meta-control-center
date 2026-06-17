import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { PortfolioOverview } from './PortfolioOverview'
import { ClientDashboard } from './ClientDashboard'

export function Overview() {
  const snapshot = useSnapshot()
  const scope = useStore((s) => s.scope)
  if (!snapshot) return null

  if (scope.kind === 'client') {
    const client = snapshot.clients.find((c) => c.id === scope.clientId)
    if (client) return <ClientDashboard client={client} />
  }
  return <PortfolioOverview scope={scope} />
}
