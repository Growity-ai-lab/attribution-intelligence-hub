import { useMemo } from 'react'
import InfoTip from './InfoTip'
import { CHANNEL_LABELS } from '../utils/colors'

const TEST_TYPES = ['Geo-lift', 'Holdout', 'PSA']
const MOCK_RESULTS = [
  { lift: 12.5, pValue: 0.003, status: 'significant' },
  { lift: 8.2, pValue: 0.012, status: 'significant' },
  { lift: 15.8, pValue: 0.001, status: 'significant' },
  { lift: 3.1, pValue: 0.142, status: 'not_significant' },
  { lift: 6.7, pValue: 0.038, status: 'significant' },
  { lift: 4.2, pValue: 0.089, status: 'marginal' },
]

function buildMockTests(campaign) {
  const channels = campaign?.channels || []
  if (channels.length === 0) {
    return {
      tests: [
        { channel: 'Meta Ads', type: 'Geo-lift', lift: 12.5, pValue: 0.003, status: 'significant' },
        { channel: 'Google Ads', type: 'Holdout', lift: 8.2, pValue: 0.012, status: 'significant' },
        { channel: 'TikTok', type: 'PSA', lift: 15.8, pValue: 0.001, status: 'significant' },
        { channel: 'LinkedIn', type: 'Geo-lift', lift: 3.1, pValue: 0.142, status: 'not_significant' },
        { channel: 'YouTube', type: 'Holdout', lift: 6.7, pValue: 0.038, status: 'significant' },
        { channel: 'DV360', type: 'PSA', lift: 4.2, pValue: 0.089, status: 'marginal' },
      ],
      corrections: [
        { channel: 'Meta Ads', factor: 1.0, note: 'Baseline' },
        { channel: 'Google Ads', factor: 1.0, note: 'Baseline' },
        { channel: 'TikTok', factor: 1.0, note: 'Baseline' },
        { channel: 'LinkedIn', factor: 1.0, note: 'Baseline' },
        { channel: 'YouTube', factor: 1.0, note: 'Baseline' },
        { channel: 'DV360', factor: 1.0, note: 'Baseline' },
      ],
    }
  }

  const tests = channels.map((ch, i) => {
    const mock = MOCK_RESULTS[i % MOCK_RESULTS.length]
    return {
      channel: CHANNEL_LABELS[ch] || ch,
      type: TEST_TYPES[i % TEST_TYPES.length],
      lift: mock.lift,
      pValue: mock.pValue,
      status: mock.status,
    }
  })

  const corrections = channels.map((ch, i) => {
    const mock = MOCK_RESULTS[i % MOCK_RESULTS.length]
    const factor = mock.status === 'significant' ? 1.0
      : mock.status === 'marginal' ? 0.85
      : 0.70
    const note = mock.status === 'significant' ? 'Baseline'
      : mock.status === 'marginal' ? 'Marjinal düzeltme'
      : 'Düşük güven düzeltmesi'
    return { channel: CHANNEL_LABELS[ch] || ch, factor, note }
  })

  return { tests, corrections }
}

export default function IncrementalityPanel({ campaign }) {
  const { tests, corrections } = useMemo(() => buildMockTests(campaign), [campaign])

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
              {tests.map(test => (
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
        <div className="px-4 pb-4">
          <div className="p-3 bg-dark-bg rounded-lg border border-dark-border/50">
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="text-slate-300 font-medium">Nasıl yorumlanır:</span> Lift değeri, test grubundaki dönüşüm artışını kontrol grubuna kıyasla gösterir.
              p-value {'<'} 0.05 ise sonuç istatistiksel olarak anlamlıdır ve kanalın gerçek bir incremental etkisi vardır.
              p-value 0.05–0.10 arası marjinal, {'>'} 0.10 ise anlamsız kabul edilir; bu kanalların atıf skoru aşağı yönlü düzeltilir.
            </p>
          </div>
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
              {corrections.map(cf => (
                <tr key={cf.channel} className="border-b border-dark-border/50 hover:bg-dark-hover transition-colors">
                  <td className="px-4 py-2.5 text-xs text-slate-300">{cf.channel}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-300">{cf.factor.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-500">{cf.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4">
          <div className="p-3 bg-dark-bg rounded-lg border border-dark-border/50">
            <p className="text-xs text-slate-400 leading-relaxed">
              <span className="text-slate-300 font-medium">Rasyonel:</span> Düzeltme faktörü, incrementality test sonucuna göre unified skora uygulanan çarpandır.
              Test anlamlı ise çarpan 1.0 (Baseline) kalır. Anlamsız sonuç veren kanallarda çarpan {'<'} 1.0&apos;a düşürülerek,
              DDA ve MMM&apos;in o kanala atfettiği kredi aşağı yönlü kalibre edilir. Böylece gerçek incrementality yaratmayan harcamalar tespit edilir.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
