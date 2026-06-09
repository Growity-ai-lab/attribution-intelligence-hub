import { useChannelConfig } from './useChannelConfig'
import { useDDA } from './useDDA'
import { useMMM } from './useMMM'
import { useMediaPlanning } from './useMediaPlanning'
import { useFileOps } from './useFileOps'

export function useAttribution() {
  const channelConfig = useChannelConfig()
  const dda = useDDA()
  const mmm = useMMM()
  const media = useMediaPlanning()
  const files = useFileOps()

  return { ...channelConfig, ...dda, ...mmm, ...media, ...files }
}
