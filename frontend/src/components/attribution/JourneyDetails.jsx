import { fmtN, fmtPct } from '../../utils/formatters'
import InfoTip from '../InfoTip'

/** Top conversion paths and journey statistics. */
export default function JourneyDetails({ ddaResult }) {
  return (
    <>
      {/* Top Conversion Paths */}
      {ddaResult.top_paths && ddaResult.top_paths.length > 0 && (
        <div className="dark-card">
          <div className="card-hdr">
            <span className="card-title">En Sık Dönüşüm Yolları</span>
            <span className="text-[10px] font-mono text-slate-400">
              {ddaResult.journey_stats?.total_journeys || '?'} yolculuk
            </span>
          </div>
          <div className="p-4 space-y-2">
            {ddaResult.top_paths.slice(0, 10).map((p, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-slate-400 font-mono w-6 text-right">#{i + 1}</span>
                <div className="flex items-center gap-1 flex-1 flex-wrap">
                  {p.path.map((ch, j) => (
                    <span key={j} className="flex items-center gap-1">
                      {j > 0 && <span className="text-slate-600">→</span>}
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700/50 text-slate-300"
                      >
                        {ch}
                      </span>
                    </span>
                  ))}
                </div>
                <span className="text-slate-400 font-mono">{p.total || p.count}</span>
                <span className="text-accent font-mono">{fmtPct(p.rate ?? p.conversion_rate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Journey Stats */}
      {ddaResult.journey_stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase">
              Toplam Yolculuk
              <InfoTip text="Benzersiz kullanıcı yolculuğu sayısı. Her kullanıcının tüm temas noktaları bir yolculuk oluşturur." />
            </p>
            <p className="text-sm font-mono text-slate-100">{fmtN(ddaResult.journey_stats.total_journeys)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase">
              Dönüşüm Yapan
              <InfoTip text="Dönüşüm (purchase/bağış) gerçekleştiren yolculuk sayısı." />
            </p>
            <p className="text-sm font-mono text-accent">{fmtN(ddaResult.journey_stats.converted)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase">
              Dönüşüm Oranı
              <InfoTip text="Conversion Rate = Dönüşüm Yapan / Toplam Yolculuk." />
            </p>
            <p className="text-sm font-mono text-slate-100">{fmtPct(ddaResult.journey_stats.conversion_rate)}</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase">
              Ort. Temas Noktası
              <InfoTip text="Avg. Touchpoints. Dönüşüm öncesi ortalama kanal etkileşim sayısı. 1.0 ise kullanıcılar tek adımda dönüşüyor demektir." />
            </p>
            <p className="text-sm font-mono text-slate-100">{ddaResult.journey_stats.avg_path_length?.toFixed(1) || ddaResult.journey_stats.avg_touchpoints?.toFixed(1)}</p>
          </div>
        </div>
      )}
    </>
  )
}
