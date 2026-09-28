import DataSourcePanel from './attribution/DataSourcePanel'
import DdaResults from './attribution/DdaResults'
import BudgetSimulator from './attribution/BudgetSimulator'
import JourneyDetails from './attribution/JourneyDetails'

/** Attribution tab: pick a data source and run DDA, then explore the result. */
export default function AttributionPanel({ campaign, ddaResult, setDdaResult }) {
  return (
    <div className="space-y-5">
      <DataSourcePanel campaign={campaign} ddaResult={ddaResult} setDdaResult={setDdaResult} />
      {ddaResult && (
        <>
          <DdaResults campaign={campaign} ddaResult={ddaResult} />
          <BudgetSimulator campaign={campaign} ddaResult={ddaResult} />
          <JourneyDetails ddaResult={ddaResult} />
        </>
      )}
    </div>
  )
}
