import { PageTitle } from '../ui.tsx'
import { TokenUsage } from './TokenUsage.tsx'

/** Token usage of the whole crew as its own page (also in the Office: Tokens button, and Panel → Stats). */
export function Usage() {
  return <><PageTitle eyebrow="HERMES INSIGHTS" title="Pemakaian token">Agent, jenis pekerjaan, dan model yang paling banyak memakai token, dari <code>hermes insights</code> setiap agent.</PageTitle>
    <div className="usage-page"><TokenUsage/></div></>
}
