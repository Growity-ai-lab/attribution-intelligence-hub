import { useDDA } from './useDDA'
import { useMMM } from './useMMM'
import { useMediaPlanning } from './useMediaPlanning'
import { useFileOps } from './useFileOps'

export function useAttribution() {
  const dda = useDDA()
  const mmm = useMMM()
  const media = useMediaPlanning()
  const files = useFileOps()

  return { ...dda, ...mmm, ...media, ...files }
}
