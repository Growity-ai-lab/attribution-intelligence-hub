// Central label/config map for the campaign objective modes. Keeps all
// mode-dependent UI strings in one place so components stay clean.
//
// lead and traffic are count-based (a conversion is a lead / a qualified site
// visit; the cost metric is cost per conversion). revenue is value-based.

export const OBJECTIVE_OPTIONS = [
  { value: 'lead', short: 'Lead', selectedClass: 'border-emerald-500 bg-emerald-500/10 text-emerald-400' },
  { value: 'revenue', short: 'Gelir', selectedClass: 'border-blue-500 bg-blue-500/10 text-blue-400' },
  { value: 'traffic', short: 'Trafik', selectedClass: 'border-violet-500 bg-violet-500/10 text-violet-400' },
]

const COUNT_BASE = { countBased: true, showRoas: false, showAov: false }

const LABELS = {
  lead: {
    ...COUNT_BASE,
    mode: 'lead',
    unit: 'lead',
    Unit: 'Lead',
    costName: 'CPL',
    costDescription: 'Cost Per Lead — her bir atfedilen lead için harcanan tutar.',
    convUserLabel: 'Lead (kullanıcı)',
    totalKpi: 'Toplam Lead',
    attributedChart: 'Atfedilen Lead',
    attributedCol: 'Atf. Lead',
    primaryCol: 'CPL (₺)',
    primaryKpi: 'Ort. CPL',
    section: 'Bütçe & Lead Simülasyonu',
    scenarioTotal: 'Projeksiyon Lead',
    scenarioDelta: 'Lead Farkı',
    scenarioPrimary: 'Yeni CPL',
    scenarioPrimaryDelta: 'CPL Değişim',
    badge: 'Lead Odaklı',
    badgeClass: 'bg-emerald-500/15 text-emerald-400',
  },
  traffic: {
    ...COUNT_BASE,
    mode: 'traffic',
    unit: 'ziyaret',
    Unit: 'Ziyaret',
    costName: 'Maliyet/Ziyaret',
    costDescription: 'Ziyaret başı maliyet — her bir atfedilen nitelikli ziyaret için harcanan tutar.',
    convUserLabel: 'Ziyaret eden (kullanıcı)',
    totalKpi: 'Toplam Ziyaret',
    attributedChart: 'Atfedilen Ziyaret',
    attributedCol: 'Atf. Ziyaret',
    primaryCol: 'Maliyet/Ziyaret (₺)',
    primaryKpi: 'Ort. Maliyet/Ziyaret',
    section: 'Bütçe & Trafik Simülasyonu',
    scenarioTotal: 'Projeksiyon Ziyaret',
    scenarioDelta: 'Ziyaret Farkı',
    scenarioPrimary: 'Yeni Maliyet/Ziyaret',
    scenarioPrimaryDelta: 'Maliyet/Ziyaret Değişim',
    badge: 'Erişim & Trafik',
    badgeClass: 'bg-violet-500/15 text-violet-400',
  },
  revenue: {
    countBased: false,
    mode: 'revenue',
    unit: 'dönüşüm',
    Unit: 'Dönüşüm',
    costName: 'CPA',
    costDescription: 'Cost Per Acquisition — her bir atfedilen dönüşüm için harcanan tutar.',
    convUserLabel: 'Dönüşüm (kullanıcı)',
    totalKpi: 'Toplam Gelir',
    attributedChart: 'Atfedilen Gelir (TL)',
    attributedCol: 'Atf. Gelir (₺)',
    primaryCol: 'ROAS',
    primaryKpi: 'Karma ROAS',
    section: 'Bütçe & Gelir Simülasyonu',
    scenarioTotal: 'Projeksiyon Gelir',
    scenarioDelta: 'Gelir Farkı',
    scenarioPrimary: 'Yeni ROAS',
    scenarioPrimaryDelta: 'ROAS Değişim',
    showRoas: true,
    showAov: true,
    badge: 'Gelir Odaklı',
    badgeClass: 'bg-blue-500/15 text-blue-400',
  },
}

export function objectiveLabels(objective) {
  return LABELS[objective] || LABELS.revenue
}
