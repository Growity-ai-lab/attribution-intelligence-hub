import InfoTip from './InfoTip'

const MOCK_TESTS = [
  { channel: 'Meta Ads', type: 'Geo-lift', lift: 12.5, pValue: 0.003, status: 'significant' },
  { channel: 'Google Ads', type: 'Holdout', lift: 8.2, pValue: 0.012, status: 'significant' },
  { channel: 'TikTok', type: 'PSA', lift: 15.8, pValue: 0.001, status: 'significant' },
  { channel: 'LinkedIn', type: 'Geo-lift', lift: 3.1, pValue: 0.142, status: 'not_significant' },
  { channel: 'YouTube', type: 'Holdout', lift: 6.7, pValue: 0.038, status: 'significant' },
  { channel: 'DV360', type: 'PSA', lift: 4.2, pValue: 0.089, status: 'marginal' },
]

const CORRECTION_FACTORS = [
  { channel: 'Meta Ads', factor: 1.0, note: 'Baseline' },
  { channel: 'Google Ads', factor: 1.0, note: 'Baseline' },
  { channel: 'TikTok', factor: 1.0, note: 'Baseline' },
  { channel: 'LinkedIn', factor: 1.0, note: 'Baseline' },
  { channel: 'YouTube', factor: 1.0, note: 'Baseline' },
  { channel: 'DV360', factor: 1.0, note: 'Baseline' },
]

export default function IncrementalityPanel() {
  return (
    <div className="space-y-6">
      <InfoTip>
        <strong>Incrementality Testing:</strong> Geo-lift, Holdout ve PSA (Public Service Announcement) testleri
        ile her kanalın gerçek incremental etkisi ölçülür. Bu sonuçlar unified skorda %15 ağırlıkla kullanılır.
      </InfoTip>

      <div className="dark-card border-t-2 border-accent">
        <div className="p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center mx-auto mb-3">
            <span className="text-accent text-xl font-bold">4</span>
          </div>
          <h3 className="text-slate-200 font-semibold mb-1">Faz 4: Incrementality Testing</h3>
          <p className="text-slate-500 text-xs max-w-md mx-auto">
            Geo-lift, holdout ve PSA test framework&apos;u bu fazda aktif olacak.
            Şimdilik aşağıda örnek test sonuçları ve düzeltme faktörleri gösterilmektedir.
          </p>
        </div>
      </div>

      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Test Sonuçları (Örnek)</span>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-amber-500/15 text-amber-400">MOCK</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Kanal</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Test Tipi</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Lift %</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">p-value</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Durum</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TESTS.map(test => (
                <tr key={test.channel} className="border-b border-dark-border/50 hover:bg-dark-hover transition-colors">
                  <td className="px-4 py-2.5 text-xs text-slate-300">{test.channel}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-400">{test.type}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-emerald-400">+{test.lift}%</td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-400">{test.pValue}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      test.status === 'significant' ? 'bg-emerald-500/15 text-emerald-400' :
                      test.status === 'marginal' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-slate-500/15 text-slate-400'
                    }`}>
                      {test.status === 'significant' ? 'Anlamlı' :
                       test.status === 'marginal' ? 'Marjinal' : 'Anlamsız'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dark-card">
        <div className="card-hdr">
          <span className="card-title">Düzeltme Faktörleri</span>
          <span className="text-xs text-slate-500">{'Inc. \u00d7 Unified skor çarpanı'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Kanal</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Çarpan</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Not</th>
              </tr>
            </thead>
            <tbody>
              {CORRECTION_FACTORS.map(cf => (
                <tr key={cf.channel} className="border-b border-dark-border/50 hover:bg-dark-hover transition-colors">
                  <td className="px-4 py-2.5 text-xs text-slate-300">{cf.channel}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">{cf.factor.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-500">{cf.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
