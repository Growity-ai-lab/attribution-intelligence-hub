// Central label/config map for lead-focused vs revenue-focused campaign modes.
// Keeps all mode-dependent UI strings in one place so components stay clean.

export function objectiveLabels(objective) {
  if (objective === 'lead') {
    return {
      mode: 'lead',
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
      showRoas: false,
      showAov: false,
      badge: 'Lead Odaklı',
      badgeClass: 'bg-emerald-500/15 text-emerald-400',
    }
  }
  return {
    mode: 'revenue',
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
  }
}
